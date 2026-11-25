import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { startTcpProxy, type TcpProxy } from '../support/tcp-proxy.js';
import { type ContractResponse, expectToMatchContract, fromFetch } from './support/contract-matcher.js';

/**
 * T067 (US5-2, US5-4): las respuestas REALES del servicio (aplicación completa con `createApp` y PostgreSQL 18 efímero)
 * cumplen el contrato, incluidos los errores problem+json. Cubre getLiveness, getReadiness (200 y 503),
 * getCompatibility y las 5 operaciones de dev-probe con cada código que declaran, salvo 409
 * `idempotency-request-in-progress` y 422 `idempotency-key-reused` de createDevProbeItem, que prueba T095.
 *
 * La base se alcanza a través de un proxy TCP para poder simular su caída (503) sin tocar el contenedor.
 */
const PATH = '/v1/dev/probe-items';
let db: TestDatabase;
let proxy: TcpProxy;
let app: INestApplication;
let url = '';
const TENANT = randomUUID();

async function call(
  method: string,
  path: string,
  {
    headers = {},
    body,
    tenant = TENANT,
    actor = 'dev:contract',
  }: {
    headers?: Record<string, string>;
    body?: unknown;
    tenant?: string | null;
    actor?: string | null;
  } = {},
): Promise<ContractResponse> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(tenant === null ? {} : { 'x-kuota-dev-tenant': tenant }),
      ...(actor === null ? {} : { 'x-kuota-dev-actor': actor }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return fromFetch(res);
}
const create = (
  body: unknown = { label: 'contrato' },
  headers: Record<string, string> = { 'idempotency-key': randomUUID() },
) => call('POST', PATH, { body, headers });
const json = (res: ContractResponse) => JSON.parse(res.body) as Record<string, unknown>;
/** Valida contra el contrato y, en errores, el código estable esperado (US5-4). */
function expectContract(res: ContractResponse, operationId: string, status: number, code?: string): void {
  expect(res.status, res.body).toBe(status);
  expectToMatchContract(res, operationId);
  if (code) expect(json(res)['code']).toBe(code);
}

beforeAll(async () => {
  db = await startTestDatabase();
  const target = new URL(db.appUrl);
  proxy = await startTcpProxy(target.hostname, Number(target.port));
  const viaProxy = new URL(db.appUrl);
  viaProxy.hostname = '127.0.0.1';
  viaProxy.port = String(proxy.port);
  app = await createApp(
    loadConfig(
      validEnv({
        KUOTA_ENV: 'testing',
        KUOTA_DEV_TENANT_CONTEXT: 'enabled',
        DATABASE_URL_APP: viaProxy.toString(),
        LOG_LEVEL: 'silent',
      }),
    ),
  );
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await proxy?.close();
  await db?.stop();
});

describe('health y compatibilidad (T067)', () => {
  it('getLiveness 200', async () => {
    expectContract(await call('GET', '/health/live', { tenant: null, actor: null }), 'getLiveness', 200);
  });

  it('getReadiness 200 con la base disponible y 503 con la base caída', async () => {
    expectContract(await call('GET', '/health/ready', { tenant: null, actor: null }), 'getReadiness', 200);
    proxy.mode = 'refuse';
    proxy.dropConnections();
    try {
      expectContract(await call('GET', '/health/ready', { tenant: null, actor: null }), 'getReadiness', 503);
    } finally {
      proxy.mode = 'forward';
    }
  });

  it('getCompatibility 200 (sin versión, soportada y no soportada) y 400 problem+json con versión malformada', async () => {
    for (const version of [undefined, 'collector/9.9.9', 'admin/0.0.1']) {
      const res = await call('GET', '/v1/meta/compatibility', {
        tenant: null,
        actor: null,
        headers: version ? { 'x-app-version': version } : {},
      });
      expectContract(res, 'getCompatibility', 200);
    }
    const bad = await call('GET', '/v1/meta/compatibility', {
      tenant: null,
      actor: null,
      headers: { 'x-app-version': 'nope' },
    });
    expectContract(bad, 'getCompatibility', 400, 'validation-error');
  });
});

describe('dev-probe: respuestas de éxito (T067)', () => {
  it('createDevProbeItem 201 (con y sin monto) y su reproducción 201 con Idempotent-Replayed', async () => {
    expectContract(await create(), 'createDevProbeItem', 201);
    const key = randomUUID();
    const body = { label: 'con-monto', sample_amount: { amount_minor: '9223372036854775807', currency: 'BHD' } };
    expectContract(await create(body, { 'idempotency-key': key }), 'createDevProbeItem', 201);
    const replay = await create(body, { 'idempotency-key': key });
    expectContract(replay, 'createDevProbeItem', 201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
  });

  it('listDevProbeItems 200 (con página siguiente y última página), getDevProbeItem 200, updateDevProbeItem 200 y deleteDevProbeItem 204', async () => {
    const tenant = randomUUID();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        String(
          json(
            await call('POST', PATH, {
              tenant,
              body: { label: `l${i}` },
              headers: { 'idempotency-key': randomUUID() },
            }),
          )['id'],
        ),
      );
    }
    const first = await call('GET', `${PATH}?limit=2`, { tenant });
    expectContract(first, 'listDevProbeItems', 200);
    const cursor = String(json(first)['next_cursor']);
    expectContract(await call('GET', `${PATH}?limit=2&cursor=${cursor}`, { tenant }), 'listDevProbeItems', 200);
    expectContract(await call('GET', `${PATH}/${ids[0]}`, { tenant }), 'getDevProbeItem', 200);
    expectContract(
      await call('PATCH', `${PATH}/${ids[0]}`, { tenant, body: { label: 'nuevo', version: 1 } }),
      'updateDevProbeItem',
      200,
    );
    expectContract(await call('DELETE', `${PATH}/${ids[1]}`, { tenant }), 'deleteDevProbeItem', 204);
  });
});

describe('dev-probe: errores problem+json declarados (T067, US5-4)', () => {
  it('createDevProbeItem 400 (cuerpo, Money, clave y actor) y 401', async () => {
    expectContract(await create({ label: '' }), 'createDevProbeItem', 400, 'validation-error');
    expectContract(
      await create({ label: 'x', sample_amount: { amount_minor: '1.5', currency: 'XXX' } }),
      'createDevProbeItem',
      400,
      'validation-error',
    );
    expectContract(await create({ label: 'x' }, {}), 'createDevProbeItem', 400, 'validation-error');
    expectContract(
      await call('POST', PATH, { actor: null, body: { label: 'x' }, headers: { 'idempotency-key': randomUUID() } }),
      'createDevProbeItem',
      400,
      'validation-error',
    );
    expectContract(
      await call('POST', PATH, { tenant: null, body: { label: 'x' }, headers: { 'idempotency-key': randomUUID() } }),
      'createDevProbeItem',
      401,
      'tenant-context-required',
    );
  });

  it('listDevProbeItems 400 (limit y cursor) y 401', async () => {
    expectContract(await call('GET', `${PATH}?limit=0`), 'listDevProbeItems', 400, 'validation-error');
    expectContract(await call('GET', `${PATH}?cursor=%25%25`), 'listDevProbeItems', 400, 'validation-error');
    expectContract(await call('GET', PATH, { tenant: 'no-uuid' }), 'listDevProbeItems', 401, 'tenant-context-required');
  });

  it('getDevProbeItem 401 y 404 (inexistente, malformado y de otro tenant)', async () => {
    const foreign = String(
      json(
        await call('POST', PATH, {
          tenant: randomUUID(),
          body: { label: 'ajeno' },
          headers: { 'idempotency-key': randomUUID() },
        }),
      )['id'],
    );
    expectContract(
      await call('GET', `${PATH}/${foreign}`, { tenant: null }),
      'getDevProbeItem',
      401,
      'tenant-context-required',
    );
    for (const id of [randomUUID(), 'malformado', foreign]) {
      expectContract(await call('GET', `${PATH}/${id}`), 'getDevProbeItem', 404, 'not-found');
    }
  });

  it('updateDevProbeItem 400, 401, 404 y 409 version-conflict', async () => {
    const id = String(json(await create())['id']);
    expectContract(
      await call('PATCH', `${PATH}/${id}`, { body: { label: 'x' } }),
      'updateDevProbeItem',
      400,
      'validation-error',
    );
    expectContract(
      await call('PATCH', `${PATH}/${id}`, { actor: null, body: { label: 'x', version: 1 } }),
      'updateDevProbeItem',
      400,
      'validation-error',
    );
    expectContract(
      await call('PATCH', `${PATH}/${id}`, { tenant: null, body: { label: 'x', version: 1 } }),
      'updateDevProbeItem',
      401,
      'tenant-context-required',
    );
    expectContract(
      await call('PATCH', `${PATH}/${randomUUID()}`, { body: { label: 'x', version: 1 } }),
      'updateDevProbeItem',
      404,
      'not-found',
    );
    expectContract(
      await call('PATCH', `${PATH}/${id}`, { body: { label: 'x', version: 7 } }),
      'updateDevProbeItem',
      409,
      'version-conflict',
    );
  });

  it('deleteDevProbeItem 400 (sin actor), 401 y 404', async () => {
    const id = String(json(await create())['id']);
    expectContract(
      await call('DELETE', `${PATH}/${id}`, { actor: null }),
      'deleteDevProbeItem',
      400,
      'validation-error',
    );
    expectContract(
      await call('DELETE', `${PATH}/${id}`, { tenant: null }),
      'deleteDevProbeItem',
      401,
      'tenant-context-required',
    );
    expectContract(await call('DELETE', `${PATH}/${randomUUID()}`), 'deleteDevProbeItem', 404, 'not-found');
  });

  it('todo error lleva el correlation_id de la respuesta y no expone detalles internos (US5-4)', async () => {
    const correlation = randomUUID();
    const res = await call('GET', `${PATH}/${randomUUID()}`, { headers: { 'x-correlation-id': correlation } });
    expectContract(res, 'getDevProbeItem', 404, 'not-found');
    expect(json(res)['correlation_id']).toBe(correlation);
    expect(res.headers.get('x-correlation-id')).toBe(correlation);
    expect(res.body).not.toMatch(/prisma|postgres|sql|stack/i);
  });
});
