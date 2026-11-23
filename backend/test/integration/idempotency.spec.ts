import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { idempotencyLockId } from '../../src/common/idempotency/request-hash.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';

/**
 * T072 (US6-1..3; FR-023, FR-024; data-model.md `idempotency_keys`) sobre la aplicación real y PostgreSQL 18:
 * `createDevProbeItem` con `@Idempotent()`. `KUOTA_IDEMPOTENCY_REPETITIONS` fija las repeticiones del escenario
 * principal (10 en `pnpm test`; 100 en `pnpm test:idempotency`, SC-006).
 *
 * Desviación documentada: la tarea pide fijar `expires_at` en el pasado "con kuota_migrator". Con FORCE RLS y la
 * política `TO kuota_app`, el migrador no ve ni modifica filas (data-model.md, decisión de implementación de 0001), así
 * que se usa el superusuario del contenedor efímero, solo para preparar el escenario.
 */
const REPETITIONS = Number(process.env['KUOTA_IDEMPOTENCY_REPETITIONS'] ?? '10');
const PATH = '/v1/dev/probe-items';
let db: TestDatabase;
let app: INestApplication;
let url = '';
let admin: Client;

interface Res {
  status: number;
  body: Record<string, unknown>;
  replayed: string | null;
  retryAfter: string | null;
}

async function post(tenant: string, key: string | null, body: unknown, actor = 'dev:idem'): Promise<Res> {
  const res = await fetch(`${url}${PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-kuota-dev-tenant': tenant,
      'x-kuota-dev-actor': actor,
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    replayed: res.headers.get('idempotent-replayed'),
    retryAfter: res.headers.get('retry-after'),
  };
}
const count = async (sql: string, params: unknown[]) =>
  Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);
const effects = (tenant: string, label: string) =>
  count('SELECT count(*) AS n FROM kuota.dev_probe_items WHERE tenant_id = $1 AND label = $2', [tenant, label]);
const auditEvents = (tenant: string, key: string) =>
  count('SELECT count(*) AS n FROM kuota.audit_events WHERE tenant_id = $1 AND idempotency_key = $2', [tenant, key]);
const keyRows = (tenant: string, key: string) =>
  count('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE tenant_id = $1 AND key = $2', [tenant, key]);

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

describe('idempotencia de createDevProbeItem (T072)', () => {
  it(`10 envíos con la misma clave, 5 en paralelo: 1 efecto, 1 audit_event y respuestas equivalentes (${REPETITIONS} repeticiones, US6-1)`, async () => {
    const tenant = randomUUID();
    for (let r = 0; r < REPETITIONS; r++) {
      const key = randomUUID();
      const label = `idem-${r}`;
      const body = { label, sample_amount: { amount_minor: '9007199254740993', currency: 'MXN' } };
      const parallel = await Promise.all(Array.from({ length: 5 }, () => post(tenant, key, body)));
      const sequential: Res[] = [];
      for (let i = 0; i < 5; i++) sequential.push(await post(tenant, key, body));
      const all = [...parallel, ...sequential];

      const created = all.filter((res) => res.status === 201);
      const original = created.filter((res) => res.replayed === null);
      expect(original, `repetición ${r}`).toHaveLength(1);
      for (const res of created) expect(res.body).toEqual(original[0]!.body);
      for (const res of created.filter((x) => x !== original[0])) expect(res.replayed).toBe('true');
      for (const res of all.filter((x) => x.status !== 201)) {
        expect(res.status).toBe(409);
        expect(res.body['code']).toBe('idempotency-request-in-progress');
        expect(res.retryAfter).toBe('1');
      }
      // Tras completarse, todo reintento obtiene la respuesta original reproducida.
      for (const res of sequential) expect(res).toMatchObject({ status: 201, replayed: 'true' });
      expect(await effects(tenant, label)).toBe(1);
      expect(await auditEvents(tenant, key)).toBe(1);
      expect(await keyRows(tenant, key)).toBe(1);
    }
  }, 600_000);

  it('misma clave con otro body → 422 idempotency-key-reused, sin efecto ni auditoría nuevos (US6-2)', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    expect((await post(tenant, key, { label: 'cuerpo-1' })).status).toBe(201);
    const reused = await post(tenant, key, { label: 'cuerpo-2' });
    expect(reused.status).toBe(422);
    expect(reused.body['code']).toBe('idempotency-key-reused');
    expect(JSON.stringify(reused.body)).not.toContain(key);
    expect(await effects(tenant, 'cuerpo-2')).toBe(0);
    expect(await auditEvents(tenant, key)).toBe(1);
  });

  it('solicitud en curso (bloqueo tomado desde otra conexión) → 409 con Retry-After: 1; al completarse, respuesta original reproducida', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const body = { label: 'en-curso' };
    const lock = idempotencyLockId(tenant, key);
    const holder = new Client({ connectionString: db.superuserUrl });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [lock.toString()]);
      const busy = await post(tenant, key, body);
      expect(busy).toMatchObject({ status: 409, retryAfter: '1' });
      expect(busy.body['code']).toBe('idempotency-request-in-progress');
      expect(await keyRows(tenant, key)).toBe(0);
      expect(await effects(tenant, 'en-curso')).toBe(0);
      await holder.query('SELECT pg_advisory_unlock($1)', [lock.toString()]);
    } finally {
      await holder.end();
    }
    const first = await post(tenant, key, body);
    expect(first).toMatchObject({ status: 201, replayed: null });
    const retry = await post(tenant, key, body);
    expect(retry).toMatchObject({ status: 201, replayed: 'true' });
    expect(retry.body).toEqual(first.body);
    expect(await effects(tenant, 'en-curso')).toBe(1);
  });

  it('expiración: una clave vencida no bloquea; la misma clave produce un nuevo efecto, incluso con otro body; expires_at = created_at + 30 días', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    expect((await post(tenant, key, { label: 'antes-de-expirar' })).status).toBe(201);
    const fresh = await admin.query<{ ok: boolean }>(
      "SELECT expires_at = created_at + interval '30 days' AS ok FROM kuota.idempotency_keys WHERE tenant_id = $1 AND key = $2",
      [tenant, key],
    );
    expect(fresh.rows[0]!.ok).toBe(true);
    await admin.query(
      "UPDATE kuota.idempotency_keys SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE tenant_id = $1 AND key = $2",
      [tenant, key],
    );
    const again = await post(tenant, key, { label: 'tras-expirar' });
    expect(again).toMatchObject({ status: 201, replayed: null });
    expect(await effects(tenant, 'antes-de-expirar')).toBe(1);
    expect(await effects(tenant, 'tras-expirar')).toBe(1);
    expect(await keyRows(tenant, key)).toBe(1);
    const renewed = await admin.query<{ ok: boolean; hash: string }>(
      "SELECT expires_at = created_at + interval '30 days' AND expires_at > now() AS ok, request_hash AS hash FROM kuota.idempotency_keys WHERE tenant_id = $1 AND key = $2",
      [tenant, key],
    );
    expect(renewed.rows[0]!.ok).toBe(true);
  });

  it('fallo del comando (error de PostgreSQL): la clave no queda registrada y un reintento produce el efecto', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const body = { label: 'falla-comando' };
    await admin.query(
      "ALTER TABLE kuota.dev_probe_items ADD CONSTRAINT t072_falla CHECK (label <> 'falla-comando') NOT VALID",
    );
    try {
      const failed = await post(tenant, key, body);
      expect(failed.status).toBe(500);
      expect(failed.body['code']).toBe('internal-error');
      expect(JSON.stringify(failed.body)).not.toMatch(/t072_falla|constraint|prisma|sql/i);
      expect(await keyRows(tenant, key)).toBe(0);
      expect(await auditEvents(tenant, key)).toBe(0);
    } finally {
      await admin.query('ALTER TABLE kuota.dev_probe_items DROP CONSTRAINT t072_falla');
    }
    const retry = await post(tenant, key, body);
    expect(retry).toMatchObject({ status: 201, replayed: null });
    expect(await effects(tenant, 'falla-comando')).toBe(1);
    expect(await auditEvents(tenant, key)).toBe(1);
  });

  it('un 400 del comando (body inválido) no registra la clave: el reintento corregido con la misma clave produce el efecto', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    expect((await post(tenant, key, { label: '' })).status).toBe(400);
    expect(await keyRows(tenant, key)).toBe(0);
    expect((await post(tenant, key, { label: 'corregido' })).status).toBe(201);
  });

  it('la misma clave en 2 tenants produce 2 efectos independientes (US6-3)', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const key = randomUUID();
    const a = await post(A, key, { label: 'misma-clave' });
    const b = await post(B, key, { label: 'misma-clave' });
    expect(a).toMatchObject({ status: 201, replayed: null });
    expect(b).toMatchObject({ status: 201, replayed: null });
    expect(a.body['id']).not.toBe(b.body['id']);
    expect(await effects(A, 'misma-clave')).toBe(1);
    expect(await effects(B, 'misma-clave')).toBe(1);
  });

  it('clave ausente o con formato inválido → 400 validation-error, sin efecto ni fila', async () => {
    const tenant = randomUUID();
    for (const key of [null, 'corta', 'x'.repeat(129), 'con espacio!']) {
      const res = await post(tenant, key, { label: 'clave-invalida' });
      expect(res.status).toBe(400);
      expect(res.body['code']).toBe('validation-error');
    }
    expect(await effects(tenant, 'clave-invalida')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE tenant_id = $1', [tenant])).toBe(0);
  });

  it('metadatos almacenados: method, path, hash SHA-256, COMPLETED con la respuesta 201 tal como se envió', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const res = await post(tenant, key, { label: 'metadatos' });
    const { rows } = await admin.query<Record<string, unknown>>(
      'SELECT method, path, status, response_status, response_body, request_hash FROM kuota.idempotency_keys WHERE tenant_id = $1 AND key = $2',
      [tenant, key],
    );
    expect(rows[0]).toMatchObject({
      method: 'POST',
      path: PATH,
      status: 'COMPLETED',
      response_status: 201,
      response_body: res.body,
    });
    expect(rows[0]!['request_hash']).toMatch(/^[0-9a-f]{64}$/);
  });
});
