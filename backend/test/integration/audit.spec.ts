import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { AuditRecordError, AuditService, CLS_AUDIT_ORIGIN } from '../../src/common/audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../../src/common/config/app-config.js';
import { ConfigModule } from '../../src/common/config/config.module.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { CLS_ACTOR_ID, CLS_CORRELATION_ID } from '../../src/common/logging/logger-options.js';
import { establishTenantContext } from '../../src/common/tenant-context/establish-context.js';
import { TenantContext } from '../../src/common/tenant-context/tenant-context.js';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import {
  TenantContextMismatchError,
  TenantPrismaService,
  TenantTransactionRequiredError,
} from '../../src/common/tenant-context/tenant-prisma.service.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { asTenantSql, rejection, sqlState } from '../support/tenant-data.js';

/**
 * T073 (US6-4, US6-5; FR-025; data-model.md `audit_events`; R-07) sobre la aplicación real y PostgreSQL 18, más
 * pruebas de `AuditService` a nivel de servicio. Política de actor aprobada (2026-11-22): toda operación auditada exige
 * un actor explícito; sin actor → 400 antes de escribir.
 */
const PATH = '/v1/dev/probe-items';
let db: TestDatabase;
let app: INestApplication;
let url = '';
let admin: Client;

type Json = Record<string, unknown>;
interface Res {
  status: number;
  body: Json;
  text: string;
  correlation: string | null;
}

async function call(
  method: string,
  path: string,
  {
    tenant,
    actor,
    body,
    headers = {},
  }: { tenant: string; actor?: string | null; body?: unknown; headers?: Record<string, string> },
): Promise<Res> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-kuota-dev-tenant': tenant,
      ...(actor === null ? {} : { 'x-kuota-dev-actor': actor ?? 'dev:auditor' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Json) : {},
    text,
    correlation: res.headers.get('x-correlation-id'),
  };
}
const create = (tenant: string, body: unknown, actor?: string | null, key = randomUUID(), headers = {}) =>
  call('POST', PATH, { tenant, actor, body, headers: { 'idempotency-key': key, ...headers } });

async function events(where: string, params: unknown[]): Promise<Json[]> {
  const { rows } = await admin.query<Json>(
    `SELECT id, tenant_id, actor_id, actor_type, actor_role, action, entity_type, entity_id, changes, occurred_at,
            device_time, origin, correlation_id, idempotency_key, xmin::text AS xmin
       FROM kuota.audit_events WHERE ${where} ORDER BY id`,
    params,
  );
  return rows;
}
const eventsOf = (entityId: string) => events('entity_id = $1', [entityId]);
const countAll = async (table: string, tenant: string) =>
  Number(
    (await admin.query<{ n: string }>(`SELECT count(*) AS n FROM kuota.${table} WHERE tenant_id = $1`, [tenant]))
      .rows[0]!.n,
  );

beforeAll(async () => {
  db = await startTestDatabase();
  app = await createApp(
    loadConfig(
      validEnv({
        KUOTA_ENV: 'testing',
        KUOTA_DEV_TENANT_CONTEXT: 'enabled',
        DATABASE_URL_APP: db.appUrl,
        LOG_LEVEL: 'silent',
      }),
    ),
  );
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await db?.stop();
});

describe('eventos de dev-probe (T073, US6-4)', () => {
  it('create: un audit_event con los campos de data-model, en la MISMA transacción que la escritura', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const res = await create(
      tenant,
      { label: 'auditado', sample_amount: { amount_minor: '-9223372036854775807', currency: 'USD' } },
      'dev:ana',
      key,
    );
    expect(res.status, res.text).toBe(201);
    const id = String(res.body['id']);
    const [event, ...rest] = await eventsOf(id);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      tenant_id: tenant,
      actor_id: 'dev:ana',
      actor_type: 'DEV',
      actor_role: null,
      action: 'dev_probe.created',
      entity_type: 'dev_probe',
      entity_id: id,
      changes: {
        label: 'auditado',
        sample_amount: { amount_minor: '-9223372036854775807', currency: 'USD' },
        version: 1,
      },
      device_time: null,
      correlation_id: res.correlation,
      idempotency_key: key,
    });
    expect(String(event!['id'])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(String(event!['origin'])).toMatch(/^ip-hash:[0-9a-f]{64}$/);
    expect(String(event!['origin'])).not.toContain('127.0.0.1');
    expect(Math.abs(Date.now() - new Date(event!['occurred_at'] as string).getTime())).toBeLessThan(60_000);
    // Atomicidad (R-07): la fila de negocio y su evento tienen el mismo xmin → la misma transacción.
    const { rows } = await admin.query<{ xmin: string }>(
      'SELECT xmin::text AS xmin FROM kuota.dev_probe_items WHERE id = $1',
      [id],
    );
    expect(event!['xmin']).toBe(rows[0]!.xmin);
    const key2 = await admin.query<{ xmin: string }>(
      'SELECT xmin::text AS xmin FROM kuota.idempotency_keys WHERE tenant_id = $1 AND key = $2',
      [tenant, key],
    );
    expect(key2.rows[0]!.xmin).toBe(event!['xmin']);
  });

  it('update: dev_probe.updated con label y version antes/después; idempotency_key nulo (no es idempotente)', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'v1' })).body['id']);
    const res = await call('PATCH', `${PATH}/${id}`, { tenant, actor: 'dev:beto', body: { label: 'v2', version: 1 } });
    expect(res.status).toBe(200);
    const updated = (await eventsOf(id)).filter((e) => e['action'] === 'dev_probe.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      actor_id: 'dev:beto',
      changes: { label: { before: 'v1', after: 'v2' }, version: { before: 1, after: 2 } },
      idempotency_key: null,
      correlation_id: res.correlation,
    });
  });

  it('changes solo contiene campos de la lista permitida (sin cuerpos completos ni encabezados)', async () => {
    const tenant = randomUUID();
    const res = await create(tenant, { label: 'lista' }, 'dev:ana', randomUUID(), {
      authorization: 'Bearer secreto-123',
    });
    const [event] = await eventsOf(String(res.body['id']));
    expect(Object.keys(event!['changes'] as Json).sort()).toEqual(['label', 'sample_amount', 'version']);
    expect(JSON.stringify(event)).not.toContain('secreto-123');
  });

  it('actor_role es NULL aunque la solicitud envíe un rol por encabezado; un rol en el body se rechaza (400) sin evento', async () => {
    const tenant = randomUUID();
    const res = await create(tenant, { label: 'rol' }, 'dev:ana', randomUUID(), {
      'x-kuota-dev-role': 'admin',
      'x-kuota-actor-role': 'owner',
    });
    expect(res.status).toBe(201);
    expect((await eventsOf(String(res.body['id'])))[0]!['actor_role']).toBeNull();
    const before = await countAll('audit_events', tenant);
    const withRole = await create(tenant, { label: 'rol-body', actor_role: 'admin' });
    expect(withRole.status).toBe(400);
    expect(await countAll('audit_events', tenant)).toBe(before);
  });

  it('el actor no se puede atribuir por body ni query: sale solo del contexto', async () => {
    const tenant = randomUUID();
    const viaBody = await create(tenant, { label: 'x', actor_id: 'dev:otro' }, 'dev:real');
    expect(viaBody.status).toBe(400);
    const viaQuery = await call('POST', `${PATH}?actor_id=dev:otro&actorId=dev:otro`, {
      tenant,
      actor: 'dev:real',
      body: { label: 'via-query' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(viaQuery.status).toBe(201);
    expect((await eventsOf(String(viaQuery.body['id'])))[0]!['actor_id']).toBe('dev:real');
  });

  it('dos actores del mismo tenant y dos tenants: cada evento conserva su tenant y su actor', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const cases = [
      [A, 'dev:a1'],
      [A, 'dev:a2'],
      [B, 'dev:b1'],
    ] as const;
    for (const [tenant, actor] of cases) {
      const res = await create(tenant, { label: `${actor}-escribe` }, actor);
      expect((await eventsOf(String(res.body['id'])))[0]).toMatchObject({ tenant_id: tenant, actor_id: actor });
    }
  });

  it('rechazos (validación, 404, 409 version-conflict) y reproducciones idempotentes no generan eventos', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const created = await create(tenant, { label: 'base' }, 'dev:ana', key);
    const id = String(created.body['id']);
    const baseline = await countAll('audit_events', tenant);
    expect((await create(tenant, { label: '' })).status).toBe(400);
    expect((await call('PATCH', `${PATH}/${randomUUID()}`, { tenant, body: { label: 'x', version: 1 } })).status).toBe(
      404,
    );
    expect((await call('PATCH', `${PATH}/${id}`, { tenant, body: { label: 'x', version: 9 } })).status).toBe(409);
    expect((await create(tenant, { label: 'base' }, 'dev:ana', key)).status).toBe(201); // reproducción
    expect(await countAll('audit_events', tenant)).toBe(baseline);
  });

  it('PENDIENTE contractual: DELETE aún no se audita (el contrato no admite el 400 de la política de actor)', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'borrado' })).body['id']);
    expect((await call('DELETE', `${PATH}/${id}`, { tenant })).status).toBe(204);
    expect((await eventsOf(id)).map((e) => e['action'])).toEqual(['dev_probe.created']);
  });
});

describe('política de actor: operaciones auditadas sin actor (US6, 2026-11-22)', () => {
  it('create y update sin X-Kuota-Dev-Actor → 400 validation-error antes de escribir (sin negocio, sin clave, sin evento)', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const res = await create(tenant, { label: 'sin-actor' }, null, key);
    expect(res.status).toBe(400);
    expect(res.body['code']).toBe('validation-error');
    expect(res.body['errors']).toEqual([{ field: 'X-Kuota-Dev-Actor', message: expect.any(String) as unknown }]);
    expect(await countAll('dev_probe_items', tenant)).toBe(0);
    expect(await countAll('idempotency_keys', tenant)).toBe(0);
    expect(await countAll('audit_events', tenant)).toBe(0);

    const id = String((await create(tenant, { label: 'con-actor' })).body['id']);
    const patch = await call('PATCH', `${PATH}/${id}`, { tenant, actor: null, body: { label: 'cambio', version: 1 } });
    expect(patch.status).toBe(400);
    expect((await call('GET', `${PATH}/${id}`, { tenant, actor: null })).body).toMatchObject({
      label: 'con-actor',
      version: 1,
    });
    expect(await countAll('audit_events', tenant)).toBe(1);
  });

  it('lecturas no exigen actor; actor inválido → 400 sin reflejarlo; sin tenant → 401', async () => {
    const tenant = randomUUID();
    expect((await call('GET', PATH, { tenant, actor: null })).status).toBe(200);
    const invalid = await create(tenant, { label: 'x' }, 'actor con espacios <script>');
    expect(invalid.status).toBe(400);
    expect(invalid.text).not.toContain('<script>');
    const noTenant = await fetch(`${url}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kuota-dev-actor': 'dev:ana', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ label: 'x' }),
    });
    expect(noTenant.status).toBe(401);
    expect(await countAll('audit_events', tenant)).toBe(0);
  });
});

describe('integridad transaccional (R-07)', () => {
  it('si la auditoría falla, la escritura de negocio y la clave se revierten; tras quitar el fallo, el reintento funciona', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    await admin.query(
      "ALTER TABLE kuota.audit_events ADD CONSTRAINT t073_falla CHECK (entity_type <> 'dev_probe') NOT VALID",
    );
    try {
      const res = await create(tenant, { label: 'audit-falla' }, 'dev:ana', key);
      expect(res.status).toBe(500);
      expect(res.text).not.toMatch(/t073_falla|audit_events|constraint|prisma/i);
      expect(await countAll('dev_probe_items', tenant)).toBe(0);
      expect(await countAll('idempotency_keys', tenant)).toBe(0);
      expect(await countAll('audit_events', tenant)).toBe(0);
    } finally {
      await admin.query('ALTER TABLE kuota.audit_events DROP CONSTRAINT t073_falla');
    }
    const retry = await create(tenant, { label: 'audit-falla' }, 'dev:ana', key);
    expect(retry.status).toBe(201);
    expect(await countAll('dev_probe_items', tenant)).toBe(1);
    expect(await countAll('audit_events', tenant)).toBe(1);
  });

  it('un error de PostgreSQL en la escritura de negocio no deja evento de auditoría', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'pg-error' })).body['id']);
    await admin.query(
      "ALTER TABLE kuota.dev_probe_items ADD CONSTRAINT t073_upd CHECK (label <> 'prohibido') NOT VALID",
    );
    try {
      const res = await call('PATCH', `${PATH}/${id}`, { tenant, body: { label: 'prohibido', version: 1 } });
      expect(res.status).toBe(500);
    } finally {
      await admin.query('ALTER TABLE kuota.dev_probe_items DROP CONSTRAINT t073_upd');
    }
    expect((await eventsOf(id)).map((e) => e['action'])).toEqual(['dev_probe.created']);
    expect((await call('GET', `${PATH}/${id}`, { tenant })).body['version']).toBe(1);
  });

  it('40 escrituras concurrentes de 2 tenants y 4 actores: cada evento con su tenant y actor (reutilización de conexiones)', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        const tenant = i % 2 === 0 ? A : B;
        const actor = `dev:${tenant === A ? 'a' : 'b'}${i % 4}`;
        const res = await create(tenant, { label: `conc-${i}` }, actor);
        return { tenant, actor, id: String(res.body['id']), status: res.status };
      }),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    for (const r of results) {
      const [event, ...rest] = await eventsOf(r.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({ tenant_id: r.tenant, actor_id: r.actor });
    }
  }, 60_000);
});

describe('PostgreSQL: append-only y aislamiento de audit_events (US6-5)', () => {
  it('kuota_app_login no puede UPDATE ni DELETE (privilegios: 42501)', async () => {
    const tenant = randomUUID();
    await create(tenant, { label: 'inmutable' });
    for (const sql of [
      "UPDATE kuota.audit_events SET action = 'alterado'",
      'DELETE FROM kuota.audit_events',
      'TRUNCATE kuota.audit_events',
    ]) {
      const error = await rejection(asTenantSql(db.appUrl, tenant, (c) => c.query(sql)));
      expect(sqlState(error), sql).toBe('42501');
    }
  });

  it('el trigger bloquea UPDATE, DELETE y TRUNCATE incluso a una cuenta con privilegios (P0001)', async () => {
    const tenant = randomUUID();
    await create(tenant, { label: 'trigger' });
    for (const sql of [
      `UPDATE kuota.audit_events SET action = 'alterado' WHERE tenant_id = '${tenant}'`,
      `DELETE FROM kuota.audit_events WHERE tenant_id = '${tenant}'`,
      'TRUNCATE kuota.audit_events',
    ]) {
      const error = await rejection(admin.query(sql));
      expect(sqlState(error), sql).toBe('P0001');
    }
    expect(await countAll('audit_events', tenant)).toBe(1);
  });

  it('kuota_migrator (propietario) no ve filas por FORCE RLS y su TRUNCATE lo bloquea el trigger', async () => {
    const tenant = randomUUID();
    await create(tenant, { label: 'migrador' });
    const migrator = new Client({ connectionString: db.migratorUrl });
    await migrator.connect();
    try {
      expect((await migrator.query('UPDATE kuota.audit_events SET action = $1', ['alterado'])).rowCount).toBe(0);
      expect((await migrator.query('DELETE FROM kuota.audit_events')).rowCount).toBe(0);
      expect(sqlState(await rejection(migrator.query('TRUNCATE kuota.audit_events')))).toBe('P0001');
    } finally {
      await migrator.end();
    }
    expect((await events('tenant_id = $1', [tenant]))[0]!['action']).toBe('dev_probe.created');
  });

  it('RLS: un tenant no lee eventos de otro ni puede insertar un evento a nombre de otro tenant', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    await create(A, { label: 'evento-A' });
    const seenByB = await asTenantSql(
      db.appUrl,
      B,
      async (c) => (await c.query('SELECT * FROM kuota.audit_events')).rowCount,
    );
    expect(seenByB).toBe(0);
    const forged = await rejection(
      asTenantSql(db.appUrl, B, (c) =>
        c.query(
          "INSERT INTO kuota.audit_events (tenant_id, actor_type, action, entity_type, entity_id, origin) VALUES ($1, 'DEV', 'dev_probe.created', 'dev_probe', 'x', 'test')",
          [A],
        ),
      ),
    );
    expect(sqlState(forged)).toBe('42501');
    expect(await countAll('audit_events', A)).toBe(1);
  });

  it('sin actor en la sesión, PostgreSQL rechaza el evento (NOT NULL): fail-closed también en la base', async () => {
    const tenant = randomUUID();
    const client = new Client({ connectionString: db.appUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.correlation_id', 'c', true)", [
        tenant,
      ]);
      const error = await rejection(
        client.query(
          "INSERT INTO kuota.audit_events (actor_type, action, entity_type, entity_id, origin) VALUES ('DEV', 'a', 'b', 'c', 'd')",
        ),
      );
      expect(sqlState(error)).toBe('23502');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

describe('AuditService a nivel de servicio (T077)', () => {
  let moduleRef: TestingModule;
  let pool: Pool;
  let cls: ClsService;
  let tenantPrisma: TenantPrismaService;
  let audit: AuditService;
  const event = {
    action: 'dev_probe.created',
    entityType: 'dev_probe',
    entityId: 'x',
    changes: { label: 'x' },
  } as const;

  beforeAll(async () => {
    pool = new Pool({ connectionString: db.appUrl, max: 2 });
    const config = loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, LOG_LEVEL: 'silent' }));
    moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), ConfigModule.forConfig(config), TenantContextModule],
    })
      .overrideProvider(TenantPrismaService)
      .useFactory({
        factory: (c: AppConfig, ctx: TenantContext) => new TenantPrismaService(c, ctx, { pool }),
        inject: [APP_CONFIG, TenantContext],
      })
      .compile();
    cls = moduleRef.get(ClsService);
    tenantPrisma = moduleRef.get(TenantPrismaService);
    audit = new AuditService(tenantPrisma, moduleRef.get(TenantContext), cls);
  });
  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
  });

  function operation<T>(
    tenant: string,
    actor: string | null,
    fn: () => Promise<T>,
    origin: string | null = 'ip-hash:test',
  ): Promise<T> {
    return cls.run(() => {
      establishTenantContext(cls, { tenantId: tenant, actorId: actor, actorType: 'DEV' });
      cls.set(CLS_CORRELATION_ID, randomUUID());
      if (origin) cls.set(CLS_AUDIT_ORIGIN, origin);
      return fn();
    });
  }

  it('fuera de withTenant falla (no hay transacción) y no escribe', async () => {
    const tenant = randomUUID();
    expect(await rejection(operation(tenant, 'dev:svc', () => audit.record(event)))).toBeInstanceOf(
      TenantTransactionRequiredError,
    );
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('sin actor, sin origen, acción o campos no permitidos → error antes de llegar a PostgreSQL', async () => {
    const tenant = randomUUID();
    const inTx = (actor: string | null, e: unknown, origin: string | null = 'ip-hash:test') =>
      rejection(operation(tenant, actor, () => tenantPrisma.withTenant(() => audit.record(e as typeof event)), origin));
    expect((await inTx(null, event)) as Error).toMatchObject({ name: 'AuditActorRequiredError' });
    expect(await inTx('dev:svc', event, null)).toBeInstanceOf(AuditRecordError);
    expect(await inTx('dev:svc', { ...event, action: 'dev_probe.inventado' })).toBeInstanceOf(AuditRecordError);
    expect(await inTx('dev:svc', { ...event, changes: { label: 'x', password: 'secreto' } })).toBeInstanceOf(
      AuditRecordError,
    );
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('anidado: el evento usa la transacción externa y se revierte con ella', async () => {
    const tenant = randomUUID();
    const failure = new Error('fallo posterior');
    const error = await rejection(
      operation(tenant, 'dev:svc', () =>
        tenantPrisma.withTenant(async () => {
          await tenantPrisma.withTenant(() => audit.record(event));
          throw failure;
        }),
      ),
    );
    expect(error).toBe(failure);
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('cambiar el actor durante la transacción → TenantContextMismatchError y rollback (R3)', async () => {
    const tenant = randomUUID();
    const error = await rejection(
      operation(tenant, 'dev:svc', () =>
        tenantPrisma.withTenant(async () => {
          await audit.record(event);
          await cls.run({ ifNested: 'inherit' }, async () => {
            cls.set(CLS_ACTOR_ID, 'dev:suplantado');
            await audit.record(event);
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('commit correcto: el evento persiste con el actor de la operación', async () => {
    const tenant = randomUUID();
    await operation(tenant, 'dev:svc', () => tenantPrisma.withTenant(() => audit.record(event)));
    expect((await events('tenant_id = $1', [tenant]))[0]).toMatchObject({
      actor_id: 'dev:svc',
      origin: 'ip-hash:test',
    });
  });
});
