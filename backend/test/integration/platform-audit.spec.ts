import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRls } from '../../scripts/check-rls.js';
import {
  PlatformAuditError,
  purgeExpiredIdempotencyKeys,
  type Queryable,
  resultCodeOf,
} from '../../scripts/purge-idempotency.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { asTenantSql, rejection, sqlState } from '../support/tenant-data.js';

/**
 * T099 (Constitución III y VII; migración 0003): toda purga de idempotencia, operación cross-tenant de plataforma, deja
 * una auditoría duradera en `kuota.platform_audit_events`, separada de `audit_events` y sin tenant ficticio. El inicio
 * se confirma antes de borrar; el resultado se registra siempre que la base lo permita; nadie puede alterarla y ningún
 * rol de runtime o de tenant puede leerla. PostgreSQL 18 efímero (Testcontainers); ninguna base persistente.
 */
let db: TestDatabase;
let admin: Client;
const TENANTS = [randomUUID(), randomUUID()];
const hash = () => randomBytes(32).toString('hex');

interface AuditRow {
  run_id: string;
  operation: string;
  status: string;
  executed_by: string;
  correlation_id: string;
  dry_run: boolean;
  batch_size: number | null;
  max_batches: number | null;
  expired_before: string | null;
  affected_rows: string | null;
  batches: number | null;
  result_code: string | null;
}

async function seedKey(tenant: string, expired: boolean): Promise<string> {
  const key = `pa-${randomUUID()}`;
  await asTenantSql(db.appUrl, tenant, (c) =>
    c.query(
      `INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status, response_status, response_body, created_at, expires_at)
       VALUES ($1, $2, 'POST', '/v1/dev/probe-items', 'COMPLETED', 201, $3,
               now() - ($4 || ' days')::interval, now() - ($4 || ' days')::interval + interval '30 days')`,
      [key, hash(), { secreto: `respuesta-${key}` }, expired ? '31' : '1'],
    ),
  );
  return key;
}
const expiredCount = async () =>
  Number(
    (await admin.query<{ n: string }>('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE expires_at <= now()'))
      .rows[0]!.n,
  );
const auditOf = async (runId: string) =>
  (
    await admin.query<AuditRow>(
      `SELECT run_id, operation, status, executed_by, correlation_id, dry_run, batch_size, max_batches,
              expired_before::text, affected_rows::text, batches, result_code
         FROM kuota.platform_audit_events WHERE run_id = $1 ORDER BY occurred_at, status`,
      [runId],
    )
  ).rows;
/** Ejecuciones iniciadas sin resultado: la evidencia de una ejecución incompleta. */
const incompleteRuns = async () =>
  (
    await admin.query<{ run_id: string }>(
      `SELECT s.run_id FROM kuota.platform_audit_events s
        WHERE s.status = 'started'
          AND NOT EXISTS (SELECT 1 FROM kuota.platform_audit_events o WHERE o.run_id = s.run_id AND o.status <> 'started')`,
    )
  ).rows.map((r) => r.run_id);

async function asRole<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const maintenance = <T>(fn: (c: Client) => Promise<T>) => asRole(db.maintenanceUrl, fn);

/** Cliente de mantenimiento real que falla en la sentencia que cumpla `when` (fallos que la base no produce sola). */
function failingOn(client: Client, when: (sql: string, params?: unknown[]) => boolean, code: string): Queryable {
  let armed = true;
  return {
    query: async <R extends object>(sql: string, params?: unknown[]) => {
      if (armed && when(sql, params)) {
        armed = false;
        throw Object.assign(new Error('fallo inyectado'), { code });
      }
      return client.query<R>(sql, params) as Promise<{ rows: R[]; rowCount?: number | null }>;
    },
  };
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await db?.stop();
});

describe('purga auditada (T099)', () => {
  it('1. éxito: inicio y resultado con recuentos, ejecutor del servidor y correlación; las vigentes quedan intactas', async () => {
    for (const t of TENANTS) {
      await seedKey(t, true);
      await seedKey(t, true);
    }
    const valid = await seedKey(TENANTS[0]!, false);
    const expiredBefore = await expiredCount();
    const runId = randomUUID();
    const correlationId = randomUUID();
    const result = await maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 1000, runId, correlationId }));
    expect(result).toEqual({ expiredBefore, deleted: expiredBefore, batches: 1, dryRun: false });
    const [started, outcome] = await auditOf(runId);
    expect(started).toMatchObject({
      status: 'started',
      operation: 'idempotency.purge',
      executed_by: 'kuota_maintenance_login',
      correlation_id: correlationId,
      dry_run: false,
      batch_size: 1000,
      max_batches: null,
      expired_before: null,
      affected_rows: null,
      batches: null,
      result_code: null,
    });
    expect(outcome).toMatchObject({
      status: 'succeeded',
      executed_by: 'kuota_maintenance_login',
      expired_before: String(expiredBefore),
      affected_rows: String(expiredBefore),
      batches: 1,
      result_code: 'ok',
    });
    expect(await expiredCount()).toBe(0);
    expect((await admin.query('SELECT 1 FROM kuota.idempotency_keys WHERE key = $1', [valid])).rowCount).toBe(1);
  });

  it('2. sin candidatos y modo inspección: también quedan auditados, con 0 filas', async () => {
    const empty = randomUUID();
    expect(await maintenance((c) => purgeExpiredIdempotencyKeys(c, { runId: empty }))).toEqual({
      expiredBefore: 0,
      deleted: 0,
      batches: 1,
      dryRun: false,
    });
    expect((await auditOf(empty)).map((r) => [r.status, r.affected_rows, r.result_code])).toEqual([
      ['started', null, null],
      ['succeeded', '0', 'ok'],
    ]);
    await seedKey(TENANTS[1]!, true);
    const dry = randomUUID();
    await maintenance((c) => purgeExpiredIdempotencyKeys(c, { runId: dry, dryRun: true }));
    expect((await auditOf(dry)).at(-1)).toMatchObject({
      status: 'succeeded',
      dry_run: true,
      expired_before: '1',
      affected_rows: '0',
      batches: 0,
    });
    expect(await expiredCount()).toBe(1);
  });

  it('3. fallo de la operación a mitad: `failed` con lo borrado hasta el fallo y un código acotado', async () => {
    await seedKey(TENANTS[0]!, true);
    await seedKey(TENANTS[1]!, true);
    const before = await expiredCount();
    expect(before).toBeGreaterThanOrEqual(3);
    const runId = randomUUID();
    let deletes = 0;
    const error = await maintenance((c) =>
      rejection(
        purgeExpiredIdempotencyKeys(
          failingOn(c, (sql) => sql.includes('DELETE FROM kuota.idempotency_keys') && ++deletes === 2, '57014'),
          { batchSize: 1, runId },
        ),
      ),
    );
    expect(sqlState(error)).toBe('57014');
    const outcome = (await auditOf(runId)).at(-1)!;
    expect(outcome).toMatchObject({
      status: 'failed',
      result_code: 'sqlstate-57014',
      expired_before: String(before),
      affected_rows: '1',
      batches: 1,
    });
    // Recuperación coherente: lo borrado en el lote confirmado coincide con lo auditado; el resto sigue ahí.
    expect(await expiredCount()).toBe(before - 1);
    expect(await incompleteRuns()).not.toContain(runId);
  });

  it('4a. si el inicio no puede auditarse, no se purga nada', async () => {
    await admin.query('REVOKE INSERT ON kuota.platform_audit_events FROM kuota_maintenance');
    try {
      const before = await expiredCount();
      const runId = randomUUID();
      const error = await maintenance((c) => rejection(purgeExpiredIdempotencyKeys(c, { runId })));
      expect(error).toBeInstanceOf(PlatformAuditError);
      expect(error).toMatchObject({ phase: 'started', purged: false });
      expect(await expiredCount()).toBe(before);
      expect(await auditOf(runId)).toEqual([]);
    } finally {
      await admin.query('GRANT INSERT ON kuota.platform_audit_events TO kuota_maintenance');
    }
  });

  it('4b. si el resultado no puede auditarse: error explícito y el inicio sin final queda como evidencia', async () => {
    const before = await expiredCount();
    expect(before).toBeGreaterThan(0);
    const runId = randomUUID();
    const error = await maintenance((c) =>
      rejection(
        purgeExpiredIdempotencyKeys(
          failingOn(c, (sql, params) => sql.includes('platform_audit_events') && params?.[2] === 'succeeded', '53100'),
          { runId },
        ),
      ),
    );
    expect(error).toBeInstanceOf(PlatformAuditError);
    expect(error).toMatchObject({ phase: 'outcome', purged: true });
    expect(await expiredCount()).toBe(0);
    expect((await auditOf(runId)).map((r) => r.status)).toEqual(['started']);
    expect(await incompleteRuns()).toContain(runId);
  });

  it('5. ejecución repetida: un run_id reutilizado se rechaza antes de borrar; nuevas ejecuciones son independientes', async () => {
    const runId = randomUUID();
    await maintenance((c) => purgeExpiredIdempotencyKeys(c, { runId }));
    await seedKey(TENANTS[0]!, true);
    const repeated = await maintenance((c) => rejection(purgeExpiredIdempotencyKeys(c, { runId })));
    expect(repeated).toBeInstanceOf(PlatformAuditError);
    expect(sqlState((repeated as Error).cause)).toBe('23505');
    expect(await expiredCount()).toBe(1);
    const again = randomUUID();
    await maintenance((c) => purgeExpiredIdempotencyKeys(c, { runId: again }));
    expect(await expiredCount()).toBe(0);
    expect((await auditOf(runId)).map((r) => r.status)).toEqual(['started', 'succeeded']);
    expect((await auditOf(again)).map((r) => r.status)).toEqual(['started', 'succeeded']);
  });

  it('6. concurrencia: dos purgas simultáneas se serializan; cada una audita su ejecución y nada se cuenta dos veces', async () => {
    const seeded = 12;
    for (let i = 0; i < seeded; i++) await seedKey(TENANTS[i % 2]!, true);
    const [a, b] = [randomUUID(), randomUUID()];
    const results = await Promise.all([
      maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 3, runId: a })),
      maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 3, runId: b })),
    ]);
    expect(results.reduce((sum, r) => sum + r.deleted, 0)).toBe(seeded);
    const outcomes = [...(await auditOf(a)), ...(await auditOf(b))].filter((r) => r.status === 'succeeded');
    expect(outcomes).toHaveLength(2);
    expect(outcomes.reduce((sum, r) => sum + Number(r.affected_rows), 0)).toBe(seeded);
    // Serializadas: la segunda empieza a contar cuando la primera ya terminó (vio 0 o todas, nunca un intermedio).
    expect(outcomes.map((r) => Number(r.expired_before)).sort((x, y) => x - y)).toEqual([0, seeded]);
    expect(await expiredCount()).toBe(0);
  });
});

describe('permisos, RLS e integridad de platform_audit_events (T099)', () => {
  it('7 y 10. sin tenant ni datos sensibles: columnas exactas y ningún valor de claves, hashes o respuestas', async () => {
    const columns = await admin.query<{ c: string }>(
      `SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = 'kuota' AND table_name = 'platform_audit_events' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((r) => r.c)).toEqual([
      'id',
      'run_id',
      'operation',
      'status',
      'executed_by',
      'occurred_at',
      'correlation_id',
      'dry_run',
      'batch_size',
      'max_batches',
      'expired_before',
      'affected_rows',
      'batches',
      'result_code',
    ]);
    const key = await seedKey(TENANTS[0]!, true);
    const runId = randomUUID();
    await maintenance((c) => purgeExpiredIdempotencyKeys(c, { runId }));
    const text = JSON.stringify(await auditOf(runId));
    for (const forbidden of [key, 'respuesta-', ...TENANTS, 'postgresql://']) expect(text).not.toContain(forbidden);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it('8. acceso denegado: runtime sin lectura ni escritura; mantenimiento solo inserta; el propietario no ve filas', async () => {
    const insert = `INSERT INTO kuota.platform_audit_events (run_id, operation, status, correlation_id, dry_run)
                    VALUES ($1, 'idempotency.purge', 'started', $1, false)`;
    for (const url of [db.appUrl]) {
      await asRole(url, async (c) => {
        expect(sqlState(await rejection(c.query('SELECT * FROM kuota.platform_audit_events')))).toBe('42501');
        expect(sqlState(await rejection(c.query(insert, [randomUUID()])))).toBe('42501');
      });
    }
    await maintenance(async (c) => {
      expect(sqlState(await rejection(c.query('SELECT * FROM kuota.platform_audit_events')))).toBe('42501');
      expect(sqlState(await rejection(c.query("UPDATE kuota.platform_audit_events SET result_code = 'x'")))).toBe(
        '42501',
      );
      expect(sqlState(await rejection(c.query('DELETE FROM kuota.platform_audit_events')))).toBe('42501');
      expect(sqlState(await rejection(c.query('TRUNCATE kuota.platform_audit_events')))).toBe('42501');
    });
    // Propietario (kuota_migrator): RLS forzada y sin política de lectura → 0 filas aunque existan.
    const total = Number(
      (await admin.query<{ n: string }>('SELECT count(*) AS n FROM kuota.platform_audit_events')).rows[0]!.n,
    );
    expect(total).toBeGreaterThan(0);
    await asRole(db.migratorUrl, async (c) => {
      expect((await c.query('SELECT * FROM kuota.platform_audit_events')).rowCount).toBe(0);
    });
  });

  it('9. integridad: append-only incluso para el superusuario; ejecutor y hora los fija el servidor; valores acotados', async () => {
    for (const sql of [
      "UPDATE kuota.platform_audit_events SET result_code = 'manipulado'",
      'DELETE FROM kuota.platform_audit_events',
      'TRUNCATE kuota.platform_audit_events',
    ]) {
      const error = await rejection(admin.query(sql));
      expect(sqlState(error), sql).toBe('P0001');
      expect((error as Error).message).toContain('append-only');
    }
    await asRole(db.migratorUrl, async (c) => {
      expect(sqlState(await rejection(c.query('TRUNCATE kuota.platform_audit_events')))).toBe('P0001');
    });

    const forged = randomUUID();
    await maintenance((c) =>
      c.query(
        `INSERT INTO kuota.platform_audit_events (run_id, operation, status, correlation_id, dry_run, executed_by, occurred_at)
         VALUES ($1, 'idempotency.purge', 'started', $1, false, 'otro_rol', '2000-01-01')`,
        [forged],
      ),
    );
    const [row] = (
      await admin.query<{ executed_by: string; recent: boolean }>(
        `SELECT executed_by, occurred_at > now() - interval '1 hour' AS recent
           FROM kuota.platform_audit_events WHERE run_id = $1`,
        [forged],
      )
    ).rows;
    expect(row).toEqual({ executed_by: 'kuota_maintenance_login', recent: true });

    const insert = (status: string, operation = 'idempotency.purge', result: string | null = null) =>
      maintenance((c) =>
        rejection(
          c.query(
            `INSERT INTO kuota.platform_audit_events (run_id, operation, status, correlation_id, dry_run, affected_rows, batches, result_code)
             VALUES ($1, $2, $3, $1, false, 0, 0, $4)`,
            [forged, operation, status, result],
          ),
        ),
      );
    expect(sqlState(await insert('otro'))).toBe('23514');
    expect(sqlState(await insert('succeeded', 'idempotency.purge', 'Mensaje libre con datos'))).toBe('23514');
    expect(['42501', '23514']).toContain(sqlState(await insert('succeeded', 'otra.operacion', 'ok')));
    expect(sqlState(await insert('started'))).toBe('23514');
    await maintenance((c) =>
      c.query(
        `INSERT INTO kuota.platform_audit_events (run_id, operation, status, correlation_id, dry_run, affected_rows, batches, result_code)
         VALUES ($1, 'idempotency.purge', 'failed', $1, false, 0, 0, 'error')`,
        [forged],
      ),
    );
    expect(sqlState(await insert('succeeded', 'idempotency.purge', 'ok'))).toBe('23505'); // un solo resultado
  });

  it('11. retención: la purga sigue sin poder borrar claves vigentes y la auditoría no tiene vía de borrado', async () => {
    const valid = await seedKey(TENANTS[1]!, false);
    await maintenance((c) => purgeExpiredIdempotencyKeys(c, { runId: randomUUID() }));
    await maintenance(async (c) => {
      expect((await c.query('DELETE FROM kuota.idempotency_keys WHERE key = $1', [valid])).rowCount).toBe(0);
    });
    expect((await admin.query('SELECT 1 FROM kuota.idempotency_keys WHERE key = $1', [valid])).rowCount).toBe(1);
    const policies = await admin.query<{ p: string }>(
      `SELECT policyname AS p FROM pg_policies
        WHERE schemaname = 'kuota' AND tablename IN ('idempotency_keys', 'platform_audit_events') ORDER BY 1`,
    );
    expect(policies.rows.map((r) => r.p)).toEqual([
      'maintenance_delete_expired',
      'maintenance_insert_audit',
      'maintenance_select_expired',
      'tenant_isolation',
    ]);
  });

  it('12. resultCodeOf solo produce códigos acotados, nunca mensajes', () => {
    expect(resultCodeOf({ code: '55P03', message: 'clave secreta' })).toBe('sqlstate-55p03');
    expect(resultCodeOf(new Error('datos sensibles'))).toBe('error');
    expect(resultCodeOf({ code: 'no válido' })).toBe('error');
    expect(resultCodeOf(null)).toBe('error');
  });
});

describe('db:check-rls sobre la auditoría de plataforma (T099)', () => {
  it('conforme tras las migraciones; cada desviación se detecta y se nombra', async () => {
    expect(await checkRls(admin)).toEqual([]);
    const cases: Array<[string, string, string, RegExp]> = [
      [
        'sin FORCE',
        'ALTER TABLE kuota.platform_audit_events NO FORCE ROW LEVEL SECURITY',
        'ALTER TABLE kuota.platform_audit_events FORCE ROW LEVEL SECURITY',
        /platform_audit_events: RLS no está forzado/,
      ],
      [
        'lectura para el runtime',
        'GRANT SELECT ON kuota.platform_audit_events TO kuota_app',
        'REVOKE SELECT ON kuota.platform_audit_events FROM kuota_app',
        /platform_audit_events: un rol de runtime tiene privilegios \(kuota_app:SELECT,kuota_app_login:SELECT\)/,
      ],
      [
        'política de lectura añadida',
        'CREATE POLICY leer ON kuota.platform_audit_events FOR SELECT TO kuota_maintenance USING (true)',
        'DROP POLICY leer ON kuota.platform_audit_events',
        /platform_audit_events: las políticas deben ser exactamente maintenance_insert_audit/,
      ],
      [
        'trigger append-only deshabilitado',
        'ALTER TABLE kuota.platform_audit_events DISABLE TRIGGER platform_audit_events_append_only',
        'ALTER TABLE kuota.platform_audit_events ENABLE TRIGGER platform_audit_events_append_only',
        /falta el trigger platform_audit_events_append_only/,
      ],
      [
        'mantenimiento con DELETE',
        'GRANT DELETE ON kuota.platform_audit_events TO kuota_maintenance',
        'REVOKE DELETE ON kuota.platform_audit_events FROM kuota_maintenance',
        /privilegio DELETE en kuota\.platform_audit_events no permitido para mantenimiento/,
      ],
    ];
    for (const [name, apply, restore, expected] of cases) {
      await admin.query(apply);
      try {
        const violations = await checkRls(admin);
        expect(violations.join('\n'), name).toMatch(expected);
      } finally {
        await admin.query(restore);
      }
    }
    expect(await checkRls(admin)).toEqual([]);
  });
});
