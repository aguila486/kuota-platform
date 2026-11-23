import { createHash, randomUUID } from 'node:crypto';
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
  type TenantTransaction,
  TenantTransactionClosedError,
  TenantTransactionRequiredError,
} from '../../src/common/tenant-context/tenant-prisma.service.js';
import { DevProbeService } from '../../src/modules/dev-probe/application/dev-probe.service.js';
import { PrismaDevProbeRepository } from '../../src/modules/dev-probe/infrastructure/prisma-dev-probe.repository.js';
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
    expect(event!['origin']).toBe('http');
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
      origin: 'http',
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
});

describe('DELETE auditado (T073, T078; contrato con 400 desde 2026-11-23)', () => {
  const rowExists = async (id: string) =>
    (await admin.query('SELECT 1 FROM kuota.dev_probe_items WHERE id = $1', [id])).rowCount === 1;
  const actionsOf = async (id: string) => (await eventsOf(id)).map((e) => e['action']);

  it('DELETE propio con actor → 204 sin cuerpo; la fila desaparece y queda dev_probe.deleted con label y version del registro borrado', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'a-borrar' })).body['id']);
    expect((await call('PATCH', `${PATH}/${id}`, { tenant, body: { label: 'a-borrar-v2', version: 1 } })).status).toBe(
      200,
    );
    const res = await call('DELETE', `${PATH}/${id}`, { tenant, actor: 'dev:carla' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await rowExists(id)).toBe(false);
    const deleted = (await eventsOf(id)).filter((e) => e['action'] === 'dev_probe.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      tenant_id: tenant,
      actor_id: 'dev:carla',
      actor_type: 'DEV',
      actor_role: null,
      entity_type: 'dev_probe',
      entity_id: id,
      changes: { label: 'a-borrar-v2', version: 2 },
      origin: 'http',
      correlation_id: res.correlation,
      idempotency_key: null,
    });
    expect(Object.keys(deleted[0]!['changes'] as Json).sort()).toEqual(['label', 'version']);
  });

  it('sin actor o con actor malformado → 400 validation-error (problem+json); la fila y los eventos no cambian', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'protegido' })).body['id']);
    for (const actor of [null, 'actor inválido!', 'x'.repeat(65)]) {
      const res = await call('DELETE', `${PATH}/${id}`, { tenant, actor });
      expect(res.status, String(actor)).toBe(400);
      expect(res.body['code']).toBe('validation-error');
      expect(res.body['errors']).toEqual([{ field: 'X-Kuota-Dev-Actor', message: expect.any(String) as unknown }]);
    }
    expect(await rowExists(id)).toBe(true);
    expect(await actionsOf(id)).toEqual(['dev_probe.created']);
  });

  it('actor válido de otro tenant → 404 sin revelar el recurso; sin borrado ni evento en ningún tenant', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const id = String((await create(A, { label: 'ajeno-delete' })).body['id']);
    const res = await call('DELETE', `${PATH}/${id}`, { tenant: B, actor: 'dev:intruso' });
    expect(res.status).toBe(404);
    expect(res.body['code']).toBe('not-found');
    expect(res.text).not.toContain('ajeno-delete');
    expect(await rowExists(id)).toBe(true);
    expect(await countAll('audit_events', B)).toBe(0);
    expect(await actionsOf(id)).toEqual(['dev_probe.created']);
  });

  it('recurso inexistente o ya borrado (reintento) → 404 sin evento', async () => {
    const tenant = randomUUID();
    expect((await call('DELETE', `${PATH}/${randomUUID()}`, { tenant })).status).toBe(404);
    const id = String((await create(tenant, { label: 'dos-veces' })).body['id']);
    expect((await call('DELETE', `${PATH}/${id}`, { tenant })).status).toBe(204);
    expect((await call('DELETE', `${PATH}/${id}`, { tenant })).status).toBe(404);
    expect(await actionsOf(id)).toEqual(['dev_probe.created', 'dev_probe.deleted']);
    expect(await countAll('audit_events', tenant)).toBe(2);
  });

  it('fallo de auditoría → 500 sin detalles internos; el DELETE se revierte; tras quitar el fallo, el reintento funciona', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'audit-delete-falla' })).body['id']);
    await admin.query(
      "ALTER TABLE kuota.audit_events ADD CONSTRAINT t078_falla CHECK (action <> 'dev_probe.deleted') NOT VALID",
    );
    try {
      const res = await call('DELETE', `${PATH}/${id}`, { tenant });
      expect(res.status).toBe(500);
      expect(res.text).not.toMatch(/t078_falla|audit_events|constraint|prisma/i);
      expect(await rowExists(id)).toBe(true);
      expect(await actionsOf(id)).toEqual(['dev_probe.created']);
    } finally {
      await admin.query('ALTER TABLE kuota.audit_events DROP CONSTRAINT t078_falla');
    }
    expect((await call('DELETE', `${PATH}/${id}`, { tenant })).status).toBe(204);
    expect(await rowExists(id)).toBe(false);
    expect(await actionsOf(id)).toEqual(['dev_probe.created', 'dev_probe.deleted']);
  });

  it('fallo de PostgreSQL en el DELETE → 500; ni borrado ni evento', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'no-se-borra' })).body['id']);
    await admin.query(`CREATE FUNCTION kuota.t078_reject() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
      BEGIN RAISE EXCEPTION 'borrado rechazado (prueba)'; END $$`);
    await admin.query(
      "CREATE TRIGGER t078_reject BEFORE DELETE ON kuota.dev_probe_items FOR EACH ROW WHEN (OLD.label = 'no-se-borra') EXECUTE FUNCTION kuota.t078_reject()",
    );
    try {
      const res = await call('DELETE', `${PATH}/${id}`, { tenant });
      expect(res.status).toBe(500);
      expect(res.text).not.toMatch(/rechazado|trigger|prisma/i);
    } finally {
      await admin.query('DROP TRIGGER t078_reject ON kuota.dev_probe_items');
      await admin.query('DROP FUNCTION kuota.t078_reject()');
    }
    expect(await rowExists(id)).toBe(true);
    expect(await actionsOf(id)).toEqual(['dev_probe.created']);
  });

  it('concurrencia: 2 tenants borran a la vez y 5 DELETE simultáneos del mismo registro → exactamente 1 borrado y 1 evento', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const ids = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const tenant = i % 2 === 0 ? A : B;
        return { tenant, id: String((await create(tenant, { label: `conc-del-${i}` })).body['id']) };
      }),
    );
    const results = await Promise.all(
      ids.map(({ tenant, id }) => call('DELETE', `${PATH}/${id}`, { tenant, actor: `dev:${tenant.slice(0, 4)}` })),
    );
    expect(results.every((r) => r.status === 204)).toBe(true);
    for (const { tenant, id } of ids) {
      const deleted = (await eventsOf(id)).filter((e) => e['action'] === 'dev_probe.deleted');
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({ tenant_id: tenant, actor_id: `dev:${tenant.slice(0, 4)}`, origin: 'http' });
    }
    const target = String((await create(A, { label: 'carrera' })).body['id']);
    const race = await Promise.all(Array.from({ length: 5 }, () => call('DELETE', `${PATH}/${target}`, { tenant: A })));
    expect(race.filter((r) => r.status === 204)).toHaveLength(1);
    expect(race.filter((r) => r.status === 404)).toHaveLength(4);
    expect((await actionsOf(target)).filter((a) => a === 'dev_probe.deleted')).toHaveLength(1);
  }, 60_000);

  it('regresión: create y update siguen auditados igual', async () => {
    const tenant = randomUUID();
    const id = String((await create(tenant, { label: 'regresion' })).body['id']);
    await call('PATCH', `${PATH}/${id}`, { tenant, body: { label: 'regresion-2', version: 1 } });
    expect(await actionsOf(id)).toEqual(['dev_probe.created', 'dev_probe.updated']);
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
      expect(event).toMatchObject({ tenant_id: r.tenant, actor_id: r.actor, origin: 'http' });
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

describe('origin lógico sin datos de red (minimización de audit_events.origin, Aprobación 5)', () => {
  // Valores de red distinguibles que un cliente o un proxy podrían enviar, más los que ve el socket en esta prueba.
  const NETWORK = {
    'x-forwarded-for': '198.51.100.23, 203.0.113.7',
    'x-real-ip': '198.51.100.24',
    forwarded: 'for="[2001:db8::cafe]";proto=https',
    'x-client-ip': '203.0.113.99',
    'true-client-ip': '2001:db8::beef',
    'x-kuota-origin': 'device:telefono-de-ana',
  };
  const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  const FORBIDDEN = [
    '198.51.100.23',
    '203.0.113.7',
    '198.51.100.24',
    '2001:db8::cafe',
    '203.0.113.99',
    '2001:db8::beef',
    'telefono-de-ana',
    '127.0.0.1',
    'ip-hash',
    'ip-hmac',
    ...['127.0.0.1', '::ffff:127.0.0.1', '::1', 'desconocida', '198.51.100.23', '203.0.113.7'].map(sha256),
  ];
  const expectNoNetworkData = (row: Json) => {
    const text = JSON.stringify(row);
    for (const value of FORBIDDEN) expect(text, value).not.toContain(value);
  };

  it('CREATE, UPDATE y DELETE por HTTP con encabezados de red/proxy → origin = "http" y ningún dato de red en el evento', async () => {
    const tenant = randomUUID();
    const created = await create(tenant, { label: 'minimizado' }, 'dev:ana', randomUUID(), NETWORK);
    expect(created.status, created.text).toBe(201);
    const id = String(created.body['id']);
    const updated = await call('PATCH', `${PATH}/${id}`, {
      tenant,
      actor: 'dev:beto',
      body: { label: 'minimizado-2', version: 1 },
      headers: NETWORK,
    });
    expect(updated.status, updated.text).toBe(200);
    const deleted = await call('DELETE', `${PATH}/${id}`, { tenant, actor: 'dev:carla', headers: NETWORK });
    expect(deleted.status, deleted.text).toBe(204);

    const all = await eventsOf(id);
    expect(all.map((e) => [e['action'], e['actor_id'], e['correlation_id']])).toEqual([
      ['dev_probe.created', 'dev:ana', created.correlation],
      ['dev_probe.updated', 'dev:beto', updated.correlation],
      ['dev_probe.deleted', 'dev:carla', deleted.correlation],
    ]);
    for (const event of all) {
      expect(event).toMatchObject({ tenant_id: tenant, actor_type: 'DEV', origin: 'http' });
      expectNoNetworkData(event);
    }
  });

  it('el origen no se puede fijar por body, query ni encabezado: siempre es el lógico del servidor', async () => {
    const tenant = randomUUID();
    const viaBody = await create(tenant, { label: 'o', origin: 'job' });
    expect(viaBody.status).toBe(400);
    expect(await countAll('audit_events', tenant)).toBe(0);
    const viaQuery = await call('POST', `${PATH}?origin=job&origin=203.0.113.7`, {
      tenant,
      actor: 'dev:ana',
      body: { label: 'via-query' },
      headers: { 'idempotency-key': randomUUID(), 'x-kuota-origin': 'job', 'x-audit-origin': '203.0.113.7' },
    });
    expect(viaQuery.status).toBe(201);
    const [event] = await eventsOf(String(viaQuery.body['id']));
    expect(event!['origin']).toBe('http');
    expectNoNetworkData(event!);
  });

  it('datos de red u origen sin actor no sirven como identidad: 400 sin escribir negocio, clave ni evento', async () => {
    const tenant = randomUUID();
    for (const method of ['POST', 'DELETE'] as const) {
      const res =
        method === 'POST'
          ? await create(tenant, { label: 'sin-actor' }, null, randomUUID(), NETWORK)
          : await call('DELETE', `${PATH}/${randomUUID()}`, { tenant, actor: null, headers: NETWORK });
      expect(res.status, method).toBe(400);
      expect(res.body['code']).toBe('validation-error');
      expect(res.text).not.toContain('198.51.100.23');
    }
    expect(await countAll('dev_probe_items', tenant)).toBe(0);
    expect(await countAll('idempotency_keys', tenant)).toBe(0);
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('reproducción idempotente con otros encabezados de red: misma respuesta, sin evento nuevo', async () => {
    const tenant = randomUUID();
    const key = randomUUID();
    const first = await create(tenant, { label: 'replay' }, 'dev:ana', key, NETWORK);
    const replay = await create(tenant, { label: 'replay' }, 'dev:ana', key, {
      'x-forwarded-for': '192.0.2.200',
    });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const all = await eventsOf(String(first.body['id']));
    expect(all).toHaveLength(1);
    expect(all[0]!['origin']).toBe('http');
    expect(JSON.stringify(all[0])).not.toContain('192.0.2.200');
  });

  it('los eventos históricos no se reescriben: un evento previo con ip-hash permanece intacto (append-only)', async () => {
    const tenant = randomUUID();
    const legacy = `ip-hash:${sha256('192.0.2.1')}`;
    await asTenantSql(db.appUrl, tenant, (c) =>
      c.query(
        "INSERT INTO kuota.audit_events (actor_type, action, entity_type, entity_id, origin) VALUES ('DEV', 'dev_probe.created', 'dev_probe', 'historico', $1)",
        [legacy],
      ),
    );
    const before = await events('tenant_id = $1', [tenant]);
    await create(tenant, { label: 'nuevo-tras-historico' });
    const after = await events('tenant_id = $1', [tenant]);
    expect(after).toHaveLength(2);
    expect(after.find((e) => e['entity_id'] === 'historico')).toEqual(before[0]);
    expect(after.filter((e) => e['entity_id'] !== 'historico').map((e) => e['origin'])).toEqual(['http']);
  });

  it('barrido: ningún evento escrito por la aplicación por HTTP en esta suite contiene IP ni hash de IP', async () => {
    const { rows } = await admin.query<{ origin: string; n: string }>(
      "SELECT origin, count(*)::text AS n FROM kuota.audit_events WHERE entity_id <> 'historico' GROUP BY origin",
    );
    // `test` y `d` son filas sembradas por SQL directo en pruebas de PostgreSQL; el resto, de la aplicación.
    expect(rows.map((r) => r.origin).sort()).toEqual(expect.arrayContaining(['http']));
    for (const { origin } of rows) expect(['http', 'test', 'd'], origin).toContain(origin);
    const leaked = await admin.query(
      `SELECT count(*)::int AS n FROM kuota.audit_events
        WHERE entity_id <> 'historico'
          AND (origin ~ '\\d{1,3}(\\.\\d{1,3}){3}' OR origin ~* '[0-9a-f]{0,4}:[0-9a-f]{0,4}:' OR origin ~* '[0-9a-f]{32}'
               OR origin LIKE 'ip-h%')`,
    );
    expect(leaked.rows[0]).toEqual({ n: 0 });
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
    origin: string | null = 'http',
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
    const inTx = (actor: string | null, e: unknown, origin: string | null = 'http') =>
      rejection(operation(tenant, actor, () => tenantPrisma.withTenant(() => audit.record(e as typeof event)), origin));
    expect((await inTx(null, event)) as Error).toMatchObject({ name: 'AuditActorRequiredError' });
    expect(await inTx('dev:svc', event, null)).toBeInstanceOf(AuditRecordError);
    // Solo orígenes lógicos de AUDIT_ORIGINS: un valor de red o derivado de él nunca llega a PostgreSQL.
    for (const origin of [
      '203.0.113.7',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      `ip-hash:${'a'.repeat(64)}`,
      `ip-hmac:v1:${'b'.repeat(64)}`,
      'HTTP',
      'http ',
      'job',
    ]) {
      const error = await inTx('dev:svc', event, origin);
      expect(error, origin).toBeInstanceOf(AuditRecordError);
      expect((error as Error).message, origin).not.toContain(origin.trim() || origin);
    }
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
      origin: 'http',
    });
  });
});

describe('DELETE a nivel de servicio: actor cambiado y cliente retenido (T078, R3)', () => {
  let moduleRef: TestingModule;
  let pool: Pool;
  let cls: ClsService;
  let tenantPrisma: TenantPrismaService;
  let service: DevProbeService;
  let repo: PrismaDevProbeRepository;

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
    repo = new PrismaDevProbeRepository(tenantPrisma);
    service = new DevProbeService(
      repo,
      tenantPrisma,
      new AuditService(tenantPrisma, moduleRef.get(TenantContext), cls),
    );
  });
  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
  });

  const operation = <T>(tenant: string, fn: () => Promise<T>) =>
    cls.run(() => {
      establishTenantContext(cls, { tenantId: tenant, actorId: 'dev:svc', actorType: 'DEV' });
      cls.set(CLS_CORRELATION_ID, randomUUID());
      cls.set(CLS_AUDIT_ORIGIN, 'http');
      return fn();
    });
  const rowExists = async (id: string) =>
    (await admin.query('SELECT 1 FROM kuota.dev_probe_items WHERE id = $1', [id])).rowCount === 1;

  it('cambiar el actor durante la transacción del DELETE → TenantContextMismatchError; el borrado se revierte', async () => {
    const tenant = randomUUID();
    const item = await operation(tenant, () => service.createDevProbeItem('actor-cambiado', null));
    const error = await rejection(
      operation(tenant, () =>
        tenantPrisma.withTenant(async () => {
          await cls.run({ ifNested: 'inherit' }, async () => {
            cls.set(CLS_ACTOR_ID, 'dev:suplantado');
            await service.deleteDevProbeItem(item.id);
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
    expect(await rowExists(item.id)).toBe(true);
    expect((await events('entity_id = $1', [item.id])).map((e) => e['action'])).toEqual(['dev_probe.created']);
  });

  it('el cliente que usó el DELETE, retenido, no sirve después: rechazado sin borrar nada', async () => {
    const tenant = randomUUID();
    const [keep, victim] = await operation(tenant, async () => [
      await service.createDevProbeItem('se-queda', null),
      await service.createDevProbeItem('victima', null),
    ]);
    let retained: TenantTransaction | undefined;
    await operation(tenant, () =>
      tenantPrisma.withTenant(async (tx) => {
        retained = tx;
        await service.deleteDevProbeItem(victim.id);
      }),
    );
    const misuse = await rejection(operation(tenant, () => retained!.dev_probe_items.deleteMany({})));
    expect(misuse).toBeInstanceOf(TenantTransactionClosedError);
    expect(await rowExists(keep.id)).toBe(true);
    expect(await rowExists(victim.id)).toBe(false);
  });

  it('DELETE concurrente (P2025): si otra transacción borró la fila tras la comprobación, responde no-encontrado sin evento', async () => {
    const tenant = randomUUID();
    const item = await operation(tenant, () => service.createDevProbeItem('carrera-p2025', null));
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => operation(tenant, () => service.deleteDevProbeItem(item.id))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(r.reason).toMatchObject({ code: 'not-found' });
    }
    expect((await events('entity_id = $1', [item.id])).filter((e) => e['action'] === 'dev_probe.deleted')).toHaveLength(
      1,
    );
  });
});
