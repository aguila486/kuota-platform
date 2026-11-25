import { Agent, request as httpRequest } from 'node:http';
import { Writable } from 'node:stream';
import { Controller, Get, Logger, Module, Post, Query, UseGuards, type INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { DevTenantGuard } from '../../src/common/tenant-context/dev-tenant.guard.js';
import { TenantContext } from '../../src/common/tenant-context/tenant-context.js';
import { TenantPrismaService } from '../../src/common/tenant-context/tenant-prisma.service.js';
import { STRONG_TOKEN, validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { TENANT_A, TENANT_B } from '../support/tenant-data.js';
import { recordOutput } from '../support/log-capture.js';

/**
 * T038 sobre la aplicación real (createApp): `DevTenantGuard` + `TenantContext` + `withTenant`, por HTTP. El
 * controlador es SOLO de prueba (dev-probe llega en G7b).
 */
@Controller('test-context')
class ContextProbeController {
  private readonly logger = new Logger('ContextProbe');
  constructor(
    private readonly context: TenantContext,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Get()
  @UseGuards(DevTenantGuard)
  async read(@Query('delay') delay?: string) {
    await new Promise((r) => setTimeout(r, Number(delay ?? 0)));
    this.logger.log('contexto leído');
    return this.context.current();
  }

  /** Intentos de suplantación por body y query: el guard los ignora. */
  @Post()
  @UseGuards(DevTenantGuard)
  spoof() {
    // El body y la query llevan tenant_id/rol/tipo falsos: el handler ni los lee; el contexto sale del guard.
    return this.context.current();
  }

  @Get('unguarded')
  unguarded() {
    return { context: this.context.current() };
  }

  /** Defecto simulado: ruta de datos SIN el guard. */
  @Get('unguarded-db')
  unguardedDb() {
    return this.tenantPrisma.withTenant(async (tx) => tx.dev_probe_items.findMany());
  }

  /** Flujo completo: contexto → withTenant → PostgreSQL. */
  @Get('db')
  @UseGuards(DevTenantGuard)
  db(@Query('delay') delay?: string) {
    return this.tenantPrisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT pg_sleep(${Number(delay ?? 0) / 1000})::text`;
      const [row] = await tx.$queryRaw<Array<{ tenant: string; usr: string }>>`
        SELECT current_setting('app.tenant_id', true) AS tenant, current_user AS usr`;
      return { setting: row!.tenant, user: row!.usr, context: this.context.current()?.tenantId };
    });
  }
}
@Module({ controllers: [ContextProbeController] })
class ContextProbeModule {}

let db: TestDatabase;
let app: INestApplication | undefined;
let url = '';
let logs = '';
const logStream = new Writable({
  write(chunk: Buffer, _enc, done) {
    logs += chunk.toString();
    recordOutput(chunk.toString()); // SC-009 · T102: captura de la suite
    done();
  },
});

async function start(env: Record<string, string>): Promise<void> {
  await app?.close();
  logs = '';
  app = await createApp(loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, ...env })), {
    modules: [ContextProbeModule],
    logStream,
  });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
}
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { headers });

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => db?.stop());

const LOCAL = { KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'enabled' };

describe('DevTenantGuard: entornos (T038, R-05)', () => {
  for (const env of ['local', 'testing']) {
    it(`${env} + enabled: fija el contexto desde el encabezado técnico`, async () => {
      await start({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'enabled' });
      const res = await get('/v1/test-context', {
        'x-kuota-dev-tenant': TENANT_A.toUpperCase(),
        'x-kuota-dev-actor': 'dev:ana',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        tenantId: TENANT_A,
        actorId: 'dev:ana',
        actorType: 'DEV',
        actorRole: null,
        correlationId: res.headers.get('x-correlation-id'),
      });
    });
  }

  const disabled: Array<[string, Record<string, string>]> = [
    ['local con el mecanismo deshabilitado', { KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'disabled' }],
    ['testing con el mecanismo deshabilitado', { KUOTA_ENV: 'testing', KUOTA_DEV_TENANT_CONTEXT: 'disabled' }],
    ['staging', { KUOTA_ENV: 'staging', KUOTA_METRICS_TOKEN: STRONG_TOKEN }],
    ['production', { KUOTA_ENV: 'production', KUOTA_METRICS_TOKEN: STRONG_TOKEN }],
  ];
  for (const [name, env] of disabled) {
    it(`${name}: 401 tenant-context-required aunque el encabezado sea válido`, async () => {
      await start(env);
      const res = await get('/v1/test-context', { 'x-kuota-dev-tenant': TENANT_A });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('tenant-context-required');
    });
  }

  it('staging/production no pueden ni arrancar con el mecanismo habilitado', () => {
    for (const env of ['staging', 'production']) {
      expect(() =>
        loadConfig(
          validEnv({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'enabled', KUOTA_METRICS_TOKEN: STRONG_TOKEN }),
        ),
      ).toThrow();
    }
  });
});

describe('DevTenantGuard: contexto ausente o malformado (T038)', () => {
  const invalidTenants = [
    'no-es-uuid',
    '0193b6f0-0000-7000-8000-00000000000',
    '00000000-0000-0000-0000-000000000000',
    `${TENANT_A},${TENANT_B}`,
    "' OR 1=1 --",
    `${TENANT_A}'; SET ROLE kuota_migrator; --`,
  ];
  it('sin encabezado → 401', async () => {
    await start(LOCAL);
    const res = await get('/v1/test-context');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  });

  it('tenant malformado, nulo, repetido o con inyección → 401 sin reflejar el valor', async () => {
    await start(LOCAL);
    for (const value of invalidTenants) {
      const res = await get('/v1/test-context', { 'x-kuota-dev-tenant': value });
      const text = await res.text();
      expect(res.status, value).toBe(401);
      expect(text, value).not.toContain(value.trim());
    }
  });

  it('el encabezado enviado dos veces (Node los une con ", ") → 401', async () => {
    await start(LOCAL);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${url}/v1/test-context`,
        { headers: { 'x-kuota-dev-tenant': [TENANT_A, TENANT_B] } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(401);
  });

  it('actor inválido → 400 validation-error sin reflejarlo', async () => {
    await start(LOCAL);
    for (const actor of ['con espacio', 'x'.repeat(65), 'dev:<script>', "a'b"]) {
      const res = await get('/v1/test-context', { 'x-kuota-dev-tenant': TENANT_A, 'x-kuota-dev-actor': actor });
      const body = (await res.json()) as { code: string; errors: Array<{ field: string }> };
      expect(res.status, actor).toBe(400);
      expect(body.code).toBe('validation-error');
      expect(body.errors[0]?.field).toBe('X-Kuota-Dev-Actor');
      expect(JSON.stringify(body)).not.toContain(actor);
    }
  });

  it('sin actor: actorId null, actorType DEV fijado por el servidor', async () => {
    await start(LOCAL);
    const body = (await (await get('/v1/test-context', { 'x-kuota-dev-tenant': TENANT_B })).json()) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ tenantId: TENANT_B, actorId: null, actorType: 'DEV', actorRole: null });
  });
});

describe('suplantación (T038)', () => {
  const SPOOF_HEADERS = {
    'x-tenant-id': TENANT_B,
    'x-kuota-tenant': TENANT_B,
    'x-kuota-actor-role': 'admin',
    'x-kuota-actor-type': 'USER',
  };

  it('otros encabezados, query o body con tenant/rol/tipo se ignoran: manda el encabezado técnico', async () => {
    await start(LOCAL);
    const res = await fetch(`${url}/v1/test-context?tenant_id=${TENANT_B}&tenantId=${TENANT_B}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kuota-dev-tenant': TENANT_A, ...SPOOF_HEADERS },
      body: JSON.stringify({ tenant_id: TENANT_B, tenantId: TENANT_B, actorRole: 'admin', actorType: 'USER' }),
    });
    expect(await res.json()).toMatchObject({ tenantId: TENANT_A, actorType: 'DEV', actorRole: null });
  });

  it('sin el encabezado técnico, los demás no establecen contexto → 401', async () => {
    await start(LOCAL);
    expect((await get('/v1/test-context', SPOOF_HEADERS)).status).toBe(401);
  });

  it('una ruta sin el guard no tiene contexto aunque llegue el encabezado técnico', async () => {
    await start(LOCAL);
    const body = await (await get('/v1/test-context/unguarded', { 'x-kuota-dev-tenant': TENANT_A })).json();
    expect(body).toEqual({ context: null });
  });
});

describe('aislamiento del contexto entre solicitudes (T038)', () => {
  it('en una misma conexión keep-alive, una solicitud no hereda el tenant de la anterior', async () => {
    await start(LOCAL);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const call = (headers: Record<string, string>) =>
      new Promise<{ status: number; body: string; socket: unknown }>((resolve, reject) => {
        const req = httpRequest(`${url}/v1/test-context`, { agent, headers }, (res) => {
          let body = '';
          res.on('data', (c: Buffer) => (body += c.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body, socket: req.socket }));
        });
        req.on('error', reject);
        req.end();
      });
    const first = await call({ 'x-kuota-dev-tenant': TENANT_A });
    const second = await call({});
    const third = await call({ 'x-kuota-dev-tenant': TENANT_B });
    agent.destroy();
    expect(second.socket).toBe(first.socket);
    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect((JSON.parse(third.body) as { tenantId: string }).tenantId).toBe(TENANT_B);
  });

  it('60 solicitudes concurrentes intercaladas: cada una ve solo su tenant y su actor, también en los logs', async () => {
    await start(LOCAL);
    const calls = Array.from({ length: 60 }, (_, i) => {
      const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
      const actor = `dev:u${i}`;
      return get(`/v1/test-context?delay=${(i * 7) % 25}`, {
        'x-kuota-dev-tenant': tenant,
        'x-kuota-dev-actor': actor,
      }).then(async (res) => ({ tenant, actor, body: (await res.json()) as { tenantId: string; actorId: string } }));
    });
    const results = await Promise.all(calls);
    for (const r of results) expect(r.body).toMatchObject({ tenantId: r.tenant, actorId: r.actor });
    const logLines = logs.split('\n').filter((l) => l.includes('contexto leído'));
    expect(logLines).toHaveLength(60);
    for (const line of logLines) {
      const record = JSON.parse(line) as { tenant_id: string; actor_id: string };
      const index = Number(record.actor_id.slice('dev:u'.length));
      expect(record.tenant_id).toBe(index % 2 === 0 ? TENANT_A : TENANT_B);
    }
  });

  it('flujo completo concurrente: solicitud → contexto → withTenant → PostgreSQL (app.tenant_id = tenant de la solicitud)', async () => {
    await start(LOCAL);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
        return get(`/v1/test-context/db?delay=${(i * 3) % 20}`, { 'x-kuota-dev-tenant': tenant }).then(async (res) => ({
          tenant,
          status: res.status,
          body: (await res.json()) as { setting: string; user: string; context: string },
        }));
      }),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ setting: r.tenant, user: 'kuota_app_login', context: r.tenant });
    }
  });

  it('una ruta de datos que olvidara el guard responde 500 internal-error sin detalles y no consulta datos', async () => {
    await start(LOCAL);
    const res = await get('/v1/test-context/unguarded-db', { 'x-kuota-dev-tenant': TENANT_A });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect((JSON.parse(text) as { code: string }).code).toBe('internal-error');
    expect(text).not.toMatch(/tenant|withTenant|Operación/i);
    expect(logs).toContain('TenantContextMissingError');
  });

  // HTTP elimina los espacios alrededor del valor de un encabezado: " <uuid>" llega como un UUID válido (no se prueba).
  it('fuera de una solicitud con contexto, withTenant de la app real falla cerrado (TenantContextMissingError)', async () => {
    await start(LOCAL);
    const app2 = app!;
    const service = app2.get(TenantPrismaService);
    await expect(service.withTenant(() => Promise.resolve(1))).rejects.toThrow('Operación sin contexto de tenant');
  });
});
