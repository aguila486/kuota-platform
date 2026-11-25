import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { recordOutput } from '../support/log-capture.js';

/**
 * Hotfix de privacidad de logs HTTP (2026-11-23): se captura el JSON REAL que emite Kuota Core (aplicación completa,
 * pino-http y logs de la aplicación) y se comprueba que no contiene datos de red, credenciales, encabezados, query
 * strings ni cuerpos, y que conserva los campos operativos. Todos los valores sensibles son ficticios.
 *
 * Aislamiento: este archivo tiene su propia aplicación, su propia base efímera y un solo módulo de Nest; no crea ni
 * cierra un segundo módulo con `ClsModule.forRoot` (el efecto observado en `audit.spec.ts`), y cada prueba lee solo
 * las líneas con su propio `correlation_id`, así que el resultado no depende del orden de ejecución.
 */
const FICTITIOUS = {
  ipv4: '198.51.100.23',
  ipv4b: '203.0.113.77',
  ipv6: '2001:db8::cafe',
  token: 'FICTICIO-TOKEN-7f3a',
  cookie: 'FICTICIA-SESION-91c2',
  // Construido en tiempo de ejecución para que el escáner de secretos no lo confunda con una clave real (como T046).
  apiKey: ['FICTICIA', 'APIKEY', '55d0'].join('-'),
  password: 'FICTICIA-CLAVE-0042',
  email: 'persona.ficticia@example.invalid',
  unknown: 'DATO-ARBITRARIO-c0ffee',
  query: 'CONSULTA-FICTICIA-a1b2',
  body: 'CUERPO-FICTICIO-d4e5',
};
const NETWORK_HEADERS: Record<string, string> = {
  'x-forwarded-for': `${FICTITIOUS.ipv4}, ${FICTITIOUS.ipv4b}`,
  'x-real-ip': FICTITIOUS.ipv4,
  forwarded: `for="[${FICTITIOUS.ipv6}]";proto=https`,
  authorization: `Bearer ${FICTITIOUS.token}`,
  cookie: `sid=${FICTITIOUS.cookie}`,
  'x-api-key': FICTITIOUS.apiKey,
  // Encabezados que hoy no existen en Kuota: una ampliación futura no debe poder filtrarse.
  'x-encabezado-futuro': FICTITIOUS.unknown,
  'x-client-email': FICTITIOUS.email,
  'x-device-serial': FICTITIOUS.unknown,
};
const FORBIDDEN = [
  ...Object.values(FICTITIOUS),
  '127.0.0.1',
  '::1',
  'remoteAddress',
  'remotePort',
  'x-forwarded-for',
  'x-real-ip',
  'user-agent',
  'headers',
  '"url"',
  '"query"',
  '"params"',
  '"body"',
];
const ACCESS_KEYS = new Set([
  'level',
  'time',
  'service',
  'env',
  'msg',
  'req',
  'res',
  'responseTime',
  'route',
  'correlation_id',
  'err',
  // Contexto del CLS que ya registraba el logging (FR-009); lo fija el servidor, nunca el cliente.
  'tenant_id',
  'actor_id',
]);

@Controller('log-probe')
class LogProbeController {
  @Get('fail')
  fail(): never {
    throw new Error(`fallo controlado password=${FICTITIOUS.password} para ${FICTITIOUS.email}`);
  }
}
@Module({ controllers: [LogProbeController] })
class LogProbeModule {}

let output = '';
const logStream = new Writable({
  write(chunk: Buffer, _enc, done) {
    output += chunk.toString();
    recordOutput(chunk.toString()); // SC-009 · T102: captura de la suite
    done();
  },
});
let db: TestDatabase;
let app: INestApplication;
let admin: Client;
let url = '';

type Line = Record<string, unknown>;
const lines = (): Line[] =>
  output
    .split('\n')
    .filter(Boolean)
    .map((raw) => JSON.parse(raw) as Line); // lanza si alguna línea no es JSON válido
const linesOf = (correlation: string) => lines().filter((l) => l['correlation_id'] === correlation);
const accessLine = (correlation: string) =>
  linesOf(correlation).find((l) => l['msg'] === 'request completed' || l['msg'] === 'request errored');

async function request(
  method: string,
  path: string,
  { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; correlation: string }> {
  const correlation = randomUUID();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlation, ...NETWORK_HEADERS, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await res.text();
  expect(res.headers.get('x-correlation-id')).toBe(correlation);
  return { status: res.status, correlation };
}

/** Espera la línea de acceso (pino-http la escribe al terminar la respuesta). */
async function access(correlation: string): Promise<Line> {
  for (let i = 0; i < 50; i++) {
    const line = accessLine(correlation);
    if (line) return line;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`sin línea de acceso para ${correlation}`);
}

function expectPrivate(correlation: string): void {
  const own = linesOf(correlation);
  expect(own.length).toBeGreaterThan(0);
  const text = JSON.stringify(own);
  for (const value of FORBIDDEN) expect(text, value).not.toContain(value);
}

function expectAccessShape(line: Line, method: string, status: number, route: string): void {
  for (const key of Object.keys(line)) expect(ACCESS_KEYS, key).toContain(key);
  expect(line).toMatchObject({ req: { method }, res: { statusCode: status }, route });
  expect(line['req']).toEqual({ method });
  expect(line['res']).toEqual({ statusCode: status });
  expect(typeof line['responseTime']).toBe('number');
  expect(typeof line['time']).toBe('string');
}

beforeAll(async () => {
  db = await startTestDatabase();
  app = await createApp(
    loadConfig(
      validEnv({
        KUOTA_ENV: 'testing',
        KUOTA_DEV_TENANT_CONTEXT: 'enabled',
        DATABASE_URL_APP: db.appUrl,
        LOG_LEVEL: 'debug',
      }),
    ),
    { modules: [LogProbeModule], logStream },
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

beforeEach(() => {
  // Las líneas se filtran por correlación; vaciar evita además falsos positivos de pruebas anteriores.
  output = '';
});

describe('logs HTTP mínimos: JSON real de la aplicación (hotfix de privacidad)', () => {
  it('solicitud exitosa con query sensible: método, plantilla, estado, latencia y correlación; nada más', async () => {
    const { status, correlation } = await request(
      'GET',
      `/health/live?email=${FICTITIOUS.email}&q=${FICTITIOUS.query}&token=${FICTITIOUS.token}`,
    );
    expect(status).toBe(200);
    const line = await access(correlation);
    expectAccessShape(line, 'GET', 200, '/health/live');
    expect(line).toMatchObject({ level: 'info', msg: 'request completed', correlation_id: correlation });
    expectPrivate(correlation);
  });

  it('400 con cuerpo sensible: el cuerpo, la contraseña y el correo no aparecen en ninguna línea', async () => {
    const tenant = randomUUID();
    const { status, correlation } = await request('POST', '/v1/dev/probe-items', {
      headers: { 'x-kuota-dev-tenant': tenant, 'x-kuota-dev-actor': 'dev:ana', 'idempotency-key': randomUUID() },
      body: { label: '', password: FICTITIOUS.password, email: FICTITIOUS.email, nota: FICTITIOUS.body },
    });
    expect(status).toBe(400);
    expectAccessShape(await access(correlation), 'POST', 400, '/v1/dev/probe-items');
    expectPrivate(correlation);
  });

  it('401 sin contexto de tenant: ruta como plantilla (sin el identificador del recurso)', async () => {
    const id = '0193b6f0-0000-7000-8000-0000000000aa';
    const { status, correlation } = await request('GET', `/v1/dev/probe-items/${id}?q=${FICTITIOUS.query}`);
    expect(status).toBe(401);
    const line = await access(correlation);
    expectAccessShape(line, 'GET', 401, '/v1/dev/probe-items/:id');
    expect(JSON.stringify(linesOf(correlation))).not.toContain(id);
    expectPrivate(correlation);
  });

  it('404 de una ruta inexistente con identificadores en la URL: route = unmatched', async () => {
    const { status, correlation } = await request('GET', `/v1/clientes/${FICTITIOUS.email}/cuentas/123456789`);
    expect(status).toBe(404);
    const line = await access(correlation);
    expectAccessShape(line, 'GET', 404, 'unmatched');
    expect(JSON.stringify(linesOf(correlation))).not.toMatch(/clientes|123456789/);
    expectPrivate(correlation);
  });

  it('500 controlado: el log de acceso lleva solo la categoría del error; el log del filtro, el detalle saneado', async () => {
    const { status, correlation } = await request('GET', '/v1/log-probe/fail');
    expect(status).toBe(500);
    const line = await access(correlation);
    expectAccessShape(line, 'GET', 500, '/v1/log-probe/fail');
    // Nivel del log de acceso: `info` (comportamiento previo de pino-http sin `customLogLevel`; no lo cambia este
    // hotfix). El error se registra con nivel `error` en la línea de ProblemDetailsFilter.
    expect(line).toMatchObject({ msg: 'request errored', err: { type: 'Error' } });
    const filter = linesOf(correlation).find((l) => l['msg'] === 'Error no controlado');
    expect(filter).toMatchObject({
      level: 'error',
      module: 'ProblemDetails',
      code: 'internal-error',
      req: { method: 'GET' },
    });
    expect(JSON.stringify(filter)).toContain('fallo controlado'); // diagnóstico conservado…
    expectPrivate(correlation); // …sin la contraseña, el correo ni datos de red
  });

  it('error dentro de una operación auditada (fallo de auditoría → rollback y 500): sin datos sensibles', async () => {
    const tenant = randomUUID();
    await admin.query(
      "ALTER TABLE kuota.audit_events ADD CONSTRAINT log_privacy_falla CHECK (changes->>'label' IS DISTINCT FROM 'falla-log')",
    );
    try {
      const { status, correlation } = await request('POST', '/v1/dev/probe-items', {
        headers: { 'x-kuota-dev-tenant': tenant, 'x-kuota-dev-actor': 'dev:ana', 'idempotency-key': randomUUID() },
        body: { label: 'falla-log' },
      });
      expect(status).toBe(500);
      const line = await access(correlation);
      expectAccessShape(line, 'POST', 500, '/v1/dev/probe-items');
      expect(line).toMatchObject({ err: { type: 'Error' } });
      expectPrivate(correlation);
      const rows = await admin.query('SELECT count(*)::int AS n FROM kuota.dev_probe_items WHERE tenant_id = $1', [
        tenant,
      ]);
      expect(rows.rows[0]).toEqual({ n: 0 }); // la auditoría transaccional sigue revirtiendo el comando
    } finally {
      await admin.query('ALTER TABLE kuota.audit_events DROP CONSTRAINT log_privacy_falla');
    }
  });

  it('operación auditada correcta: el log no registra tenant ni actor inventados, solo los del contexto del servidor', async () => {
    const tenant = randomUUID();
    const { status, correlation } = await request('POST', '/v1/dev/probe-items', {
      headers: { 'x-kuota-dev-tenant': tenant, 'x-kuota-dev-actor': 'dev:ana', 'idempotency-key': randomUUID() },
      body: { label: 'registro-normal' },
    });
    expect(status).toBe(201);
    const line = await access(correlation);
    expectAccessShape(line, 'POST', 201, '/v1/dev/probe-items');
    for (const l of linesOf(correlation)) {
      if ('tenant_id' in l) expect(l['tenant_id']).toBe(tenant);
      if ('actor_id' in l) expect(l['actor_id']).toBe('dev:ana');
    }
    expectPrivate(correlation);
  });

  it('30 solicitudes concurrentes con correlaciones distintas: cada una tiene su línea, su estado y ningún dato sensible', async () => {
    const calls = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0
        ? request('GET', `/health/live?n=${i}&q=${FICTITIOUS.query}`)
        : i % 3 === 1
          ? request('GET', `/v1/no-existe/${i}`)
          : request('GET', `/v1/dev/probe-items/${randomUUID()}`),
    );
    const results = await Promise.all(calls);
    expect(new Set(results.map((r) => r.correlation)).size).toBe(30);
    for (const [i, r] of results.entries()) {
      const line = await access(r.correlation);
      const expected: [string, number] =
        i % 3 === 0 ? ['/health/live', 200] : i % 3 === 1 ? ['unmatched', 404] : ['/v1/dev/probe-items/:id', 401];
      const [route, status] = expected;
      expect(r.status).toBe(status);
      expectAccessShape(line, 'GET', status, route);
      expect(linesOf(r.correlation).filter((l) => l['msg'] === 'request completed')).toHaveLength(1);
      expectPrivate(r.correlation);
    }
  }, 60_000);

  it('todas las líneas emitidas son JSON válido y ninguna contiene datos sensibles (barrido global)', async () => {
    await request('GET', `/health/live?q=${FICTITIOUS.query}`);
    await request('GET', '/v1/log-probe/fail');
    const all = lines();
    expect(all.length).toBeGreaterThan(0);
    for (const value of FORBIDDEN) expect(output, value).not.toContain(value);
  });
});
