import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { idempotencyLockId } from '../../src/common/idempotency/request-hash.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { type ContractResponse, expectToMatchContract, fromFetch } from './support/contract-matcher.js';

/**
 * T095 (US5-2 aplicado a US6): las respuestas de idempotencia de `createDevProbeItem` cumplen el contrato con
 * `expectToMatchContract` (T066): 201 reproducido con `Idempotent-Replayed: true`, 409
 * `idempotency-request-in-progress` con `Retry-After` (requerido por el contrato) y 422 `idempotency-key-reused`.
 * La solicitud "en curso" se simula tomando el mismo bloqueo consultivo desde otra conexión con la credencial de
 * runtime (sin privilegios elevados).
 */
const PATH = '/v1/dev/probe-items';
let db: TestDatabase;
let app: INestApplication;
let url = '';

const post = async (tenant: string, key: string, body: unknown): Promise<ContractResponse> =>
  fromFetch(
    await fetch(`${url}${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kuota-dev-tenant': tenant,
        'x-kuota-dev-actor': 'dev:contract-idem',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    }),
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
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

describe('contrato de idempotencia de createDevProbeItem (T095)', () => {
  it('201 original sin Idempotent-Replayed y 201 reproducido con Idempotent-Replayed: true, mismo cuerpo', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const body = { label: 'reproducible', sample_amount: { amount_minor: '-1', currency: 'JPY' } };
    const original = await post(tenant, key, body);
    expect(original.status).toBe(201);
    expectToMatchContract(original, 'createDevProbeItem');
    expect(original.headers.get('idempotent-replayed')).toBeNull();
    const replay = await post(tenant, key, body);
    expect(replay.status).toBe(201);
    expectToMatchContract(replay, 'createDevProbeItem');
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(JSON.parse(replay.body)).toEqual(JSON.parse(original.body));
  });

  it('409 idempotency-request-in-progress con Retry-After cumple el contrato', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const holder = new Client({ connectionString: db.appUrl });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [idempotencyLockId(tenant, key).toString()]);
      const busy = await post(tenant, key, { label: 'en-curso' });
      expect(busy.status).toBe(409);
      expectToMatchContract(busy, 'createDevProbeItem');
      expect(JSON.parse(busy.body)).toMatchObject({ code: 'idempotency-request-in-progress', status: 409 });
      expect(busy.headers.get('retry-after')).toBe('1');
    } finally {
      await holder.end();
    }
  });

  it('422 idempotency-key-reused cumple el contrato y no refleja la clave', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    expect((await post(tenant, key, { label: 'cuerpo-1' })).status).toBe(201);
    const reused = await post(tenant, key, { label: 'cuerpo-2' });
    expect(reused.status).toBe(422);
    expectToMatchContract(reused, 'createDevProbeItem');
    expect(JSON.parse(reused.body)).toMatchObject({ code: 'idempotency-key-reused', status: 422 });
    expect(JSON.stringify((JSON.parse(reused.body) as { errors?: unknown }).errors ?? null)).not.toContain(key);
  });
});
