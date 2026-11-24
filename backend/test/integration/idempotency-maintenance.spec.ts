import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRls } from '../../scripts/check-rls.js';
import {
  assertMaintenanceIdentity,
  MaintenanceIdentityError,
  purgeExpiredIdempotencyKeys,
} from '../../scripts/purge-idempotency.js';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';
import { applyMigrations, MigrateDeployError, startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { asTenantSql, rejection, sqlState } from '../support/tenant-data.js';
import { recordOutput } from '../support/log-capture.js';

/**
 * T079 + migración 0002 (cierre de US6, 2026-11-23): rol de mantenimiento y purga de claves de idempotencia vencidas,
 * sobre PostgreSQL 18 efímero. La purga se ejecuta SIEMPRE con la credencial real `kuota_maintenance_login`. Los datos
 * se preparan con `kuota_app_login` dentro del contexto de cada tenant; el superusuario del contenedor solo LEE
 * conteos de verificación y prepara los escenarios de migración fallida.
 */
const BACKEND_DIR = join(__dirname, '../..');
const MIGRATIONS_DIR = join(BACKEND_DIR, 'prisma/migrations');
let db: TestDatabase;
let admin: Client;

const TENANTS = [randomUUID(), randomUUID(), randomUUID()];
const hash = () => randomBytes(32).toString('hex');

/** Inserta una clave con la credencial de runtime, en el contexto de su tenant (fixture sin superusuario). */
async function seedKey(
  tenant: string,
  key: string,
  expired: boolean,
  status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED',
) {
  await asTenantSql(db.appUrl, tenant, (c) =>
    c.query(
      `INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status, response_status, response_body, created_at, expires_at)
       VALUES ($1, $2, 'POST', '/v1/dev/probe-items', $3, $4, $5,
               now() - ($6 || ' days')::interval, now() - ($6 || ' days')::interval + interval '30 days')`,
      [
        key,
        hash(),
        status,
        status === 'COMPLETED' ? 201 : null,
        status === 'COMPLETED' ? { secreto: `respuesta-${key}` } : null,
        expired ? '31' : '1',
      ],
    ),
  );
}
const count = async (sql: string, params: unknown[] = []) =>
  Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);
const expiredCount = () => count('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE expires_at <= now()');
const liveCount = () => count('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE expires_at > now()');
/** Huella de las tablas que la purga NUNCA debe tocar. */
const untouched = async () =>
  (
    await admin.query<{ f: string }>(
      `SELECT md5(coalesce((SELECT string_agg(a::text, '|' ORDER BY a.id) FROM kuota.audit_events a), '')) || ':' ||
              md5(coalesce((SELECT string_agg(d::text, '|' ORDER BY d.id) FROM kuota.dev_probe_items d), '')) AS f`,
    )
  ).rows[0]!.f;

async function maintenance<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.maintenanceUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Escenario: por tenant, 3 vencidas (2 COMPLETED con respuesta, 1 IN_PROGRESS) y 2 vigentes; más negocio y auditoría. */
async function seedScenario(): Promise<{ expired: number; live: number }> {
  for (const tenant of TENANTS) {
    for (let i = 0; i < 2; i++) await seedKey(tenant, `vencida-${i}-${randomUUID()}`, true);
    await seedKey(tenant, `vencida-ip-${randomUUID()}`, true, 'IN_PROGRESS');
    for (let i = 0; i < 2; i++) await seedKey(tenant, `vigente-${i}-${randomUUID()}`, false);
    await asTenantSql(db.appUrl, tenant, async (c) => {
      await c.query("INSERT INTO kuota.dev_probe_items (label) VALUES ('negocio-intacto')");
      await c.query(
        "INSERT INTO kuota.audit_events (actor_type, action, entity_type, entity_id, origin) VALUES ('DEV', 'dev_probe.created', 'dev_probe', 'x', 'test')",
      );
    });
  }
  return { expired: await expiredCount(), live: await liveCount() };
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

describe('catálogo tras 0002: roles, privilegios y políticas (T079)', () => {
  it('db:check-rls conforme con las políticas de mantenimiento y los roles de mantenimiento', async () => {
    expect(await checkRls(admin)).toEqual([]);
  });

  it('roles: sin atributos elevados; el login es miembro solo de kuota_maintenance; nadie de mantenimiento es runtime', async () => {
    const { rows } = await admin.query<Record<string, unknown>>(
      `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolcanlogin,
              pg_has_role(r.oid, 'kuota_app', 'MEMBER') AS app, pg_has_role(r.oid, 'kuota_migrator', 'MEMBER') AS migrator,
              (SELECT string_agg(g.rolname, ',') FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS member_of
         FROM pg_roles r WHERE r.rolname LIKE 'kuota_maintenance%' ORDER BY r.rolname`,
    );
    const common = {
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      app: false,
      migrator: false,
    };
    expect(rows).toEqual([
      { rolname: 'kuota_maintenance', ...common, rolcanlogin: false, member_of: null },
      { rolname: 'kuota_maintenance_login', ...common, rolcanlogin: true, member_of: 'kuota_maintenance' },
    ]);
    // El runtime no gana nada: sigue sin ser miembro de mantenimiento.
    const app = await admin.query<{ m: boolean }>(
      "SELECT pg_has_role('kuota_app_login', 'kuota_maintenance', 'MEMBER') AS m",
    );
    expect(app.rows[0]!.m).toBe(false);
  });

  it('privilegios efectivos del login: solo SELECT(tenant_id, key, expires_at) y DELETE en idempotency_keys, e INSERT en la auditoría de plataforma (T099)', async () => {
    const { rows } = await admin.query<{ grant: string }>(
      `SELECT c.relname || ':' || p.priv AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
        WHERE n.nspname = 'kuota' AND c.relkind = 'r'
          AND (has_table_privilege('kuota_maintenance_login', c.oid, p.priv)
               OR (p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('kuota_maintenance_login', c.oid, p.priv)))
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.grant)).toEqual([
      'idempotency_keys:DELETE',
      'idempotency_keys:SELECT',
      'platform_audit_events:INSERT',
    ]);
    const cols = await admin.query<{ col: string }>(
      `SELECT attname AS col FROM pg_attribute WHERE attrelid = 'kuota.idempotency_keys'::regclass AND attnum > 0
          AND has_column_privilege('kuota_maintenance_login', attrelid, attnum, 'SELECT') ORDER BY attname`,
    );
    expect(cols.rows.map((r) => r.col)).toEqual(['expires_at', 'key', 'tenant_id']);
  });
});

describe('revisión de regresión del rol de mantenimiento (Aprobación 4)', () => {
  it('membresía sin opción de administración; SET ROLE solo hacia kuota_maintenance y sin ampliar privilegios; no puede reconceder; FORCE RLS activo', async () => {
    const { rows } = await admin.query<{ admin: boolean; inherit: boolean; set: boolean }>(
      `SELECT m.admin_option AS admin, m.inherit_option AS inherit, m.set_option AS set
         FROM pg_auth_members m
        WHERE m.member = 'kuota_maintenance_login'::regrole AND m.roleid = 'kuota_maintenance'::regrole`,
    );
    expect(rows).toEqual([{ admin: false, inherit: true, set: true }]);
    const forced = await admin.query<{ rls: boolean; force: boolean }>(
      "SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE oid = 'kuota.idempotency_keys'::regclass",
    );
    expect(forced.rows[0]).toEqual({ rls: true, force: true });
    await seedKey(TENANTS[0]!, `revision-vigente-${randomUUID()}`, false);
    await maintenance(async (c) => {
      // SET ROLE al rol de privilegios: mismos permisos (siguen sin verse filas vigentes ni columnas sensibles).
      await c.query('SET ROLE kuota_maintenance');
      expect((await c.query('SELECT 1 FROM kuota.idempotency_keys WHERE expires_at > now()')).rowCount).toBe(0);
      expect(sqlState(await rejection(c.query('SELECT response_body FROM kuota.idempotency_keys')))).toBe('42501');
      await c.query('RESET ROLE');
      for (const sql of [
        'GRANT kuota_maintenance TO kuota_app_login',
        'ALTER ROLE kuota_maintenance_login BYPASSRLS',
        'ALTER TABLE kuota.idempotency_keys NO FORCE ROW LEVEL SECURITY',
        'DROP POLICY maintenance_delete_expired ON kuota.idempotency_keys',
        'SET ROLE kuota_app_login',
      ]) {
        const state = sqlState(await rejection(c.query(sql)));
        expect(['42501', '42883'], sql).toContain(state ?? 'sin-error');
      }
      // GRANT de un privilegio de tabla sin GRANT OPTION: PostgreSQL solo avisa ("no privileges were granted"); no
      // concede nada. Se verifica el efecto, no el código.
      await c.query('GRANT TRUNCATE, DELETE ON kuota.idempotency_keys TO kuota_app_login');
    });
    const effective = await admin.query<{ trunc: boolean; maint: boolean }>(
      `SELECT has_table_privilege('kuota_app_login', 'kuota.idempotency_keys', 'TRUNCATE') AS trunc,
              pg_has_role('kuota_app_login', 'kuota_maintenance', 'MEMBER') AS maint`,
    );
    expect(effective.rows[0]).toEqual({ trunc: false, maint: false });
    const grantors = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'kuota' AND grantor LIKE 'kuota_maintenance%'`,
    );
    expect(grantors.rows[0]!.n).toBe('0');
  });
});

describe('la identidad de mantenimiento con su credencial real: mínimo privilegio en la base', () => {
  it('no lee hashes ni respuestas; solo ve filas vencidas, de todos los tenants, sin fijar tenant', async () => {
    await seedScenario();
    await maintenance(async (c) => {
      for (const column of ['request_hash', 'response_body', 'status', 'method', 'path', 'created_at', '*']) {
        expect(sqlState(await rejection(c.query(`SELECT ${column} FROM kuota.idempotency_keys`))), column).toBe(
          '42501',
        );
      }
      const visible = await c.query<{ tenant_id: string; expired: boolean }>(
        'SELECT tenant_id, expires_at <= now() AS expired FROM kuota.idempotency_keys',
      );
      expect(visible.rows.every((r) => r.expired)).toBe(true);
      expect(new Set(visible.rows.map((r) => r.tenant_id)).size).toBeGreaterThanOrEqual(3);
      // Fijar un tenant no le da acceso a filas vigentes: la política de tenant no le aplica.
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [TENANTS[0]]);
      const withContext = await c.query<{ n: string }>(
        'SELECT count(*) AS n FROM kuota.idempotency_keys WHERE expires_at > now()',
      );
      await c.query('ROLLBACK');
      expect(withContext.rows[0]!.n).toBe('0');
    });
  });

  it('no puede INSERT, UPDATE ni TRUNCATE; no borra filas vigentes; no toca otras tablas ni crea objetos', async () => {
    const liveBefore = await liveCount();
    await maintenance(async (c) => {
      for (const sql of [
        "INSERT INTO kuota.idempotency_keys (tenant_id, key, request_hash, method, path, status) VALUES (gen_random_uuid(), 'x-12345678', repeat('a', 64), 'POST', '/x', 'IN_PROGRESS')",
        'UPDATE kuota.idempotency_keys SET expires_at = now()',
        'TRUNCATE kuota.idempotency_keys',
        'SELECT * FROM kuota.audit_events',
        'DELETE FROM kuota.audit_events',
        'SELECT * FROM kuota.dev_probe_items',
        'DELETE FROM kuota.dev_probe_items',
        'CREATE TABLE kuota.x (id int)',
        'CREATE TABLE public.x (id int)',
        'SET ROLE kuota_app',
        'SET ROLE kuota_migrator',
      ]) {
        const state = sqlState(await rejection(c.query(sql)));
        expect(['42501', '22023'], sql).toContain(state ?? String(state));
      }
      // DELETE dirigido a filas vigentes: 0 filas (la política solo expone las vencidas).
      const targeted = await c.query(
        "DELETE FROM kuota.idempotency_keys WHERE expires_at > now() OR key LIKE 'vigente-%'",
      );
      expect(targeted.rowCount).toBe(0);
    });
    expect(await liveCount()).toBe(liveBefore);
  });
});

describe('purga (T079): solo claves vencidas, por lotes, reanudable y segura en concurrencia', () => {
  it('la identidad se verifica: el runtime, el migrador y el superusuario se rechazan; el login de mantenimiento se acepta', async () => {
    for (const [url, reason] of [
      [db.appUrl, 'miembro de kuota_app'],
      [db.migratorUrl, 'miembro de kuota_migrator'],
      [db.superuserUrl, 'superusuario'],
    ] as const) {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        const error = await rejection(purgeExpiredIdempotencyKeys(client));
        expect(error).toBeInstanceOf(MaintenanceIdentityError);
        expect((error as Error).message).toContain(reason);
      } finally {
        await client.end();
      }
    }
    await maintenance((c) => assertMaintenanceIdentity(c));
  });

  it('modo inspección: cuenta las vencidas de todos los tenants y no borra nada', async () => {
    const before = await expiredCount();
    const result = await maintenance((c) => purgeExpiredIdempotencyKeys(c, { dryRun: true }));
    expect(result).toEqual({ expiredBefore: before, deleted: 0, batches: 0, dryRun: true });
    expect(await expiredCount()).toBe(before);
  });

  it('interrumpida tras un lote deja un estado coherente; al reanudar termina; claves vigentes, negocio y auditoría intactos', async () => {
    const expired = await expiredCount();
    const live = await liveCount();
    const fingerprint = await untouched();
    expect(expired).toBeGreaterThan(4);
    const partial = await maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 2, maxBatches: 1 }));
    expect(partial).toMatchObject({ deleted: 2, batches: 1 });
    expect(await expiredCount()).toBe(expired - 2);
    const rest = await maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 2 }));
    expect(rest.deleted).toBe(expired - 2);
    expect(rest.batches).toBeGreaterThan(1);
    expect(await expiredCount()).toBe(0);
    expect(await liveCount()).toBe(live);
    expect(await untouched()).toBe(fingerprint);
  });

  it('sin claves vencidas, una segunda ejecución es segura: 0 borradas, 1 lote', async () => {
    expect(await maintenance((c) => purgeExpiredIdempotencyKeys(c))).toEqual({
      expiredBefore: 0,
      deleted: 0,
      batches: 1,
      dryRun: false,
    });
  });

  it('dos purgas concurrentes y una reutilización concurrente de una clave vencida por la API: nada vigente se pierde', async () => {
    const { expired } = await seedScenario();
    const reusedKey = `reutilizada-${randomUUID()}`;
    await seedKey(TENANTS[1]!, reusedKey, true);
    const live = await liveCount();
    const fingerprint = await untouched();
    // La API reutiliza la clave vencida: la borra y la reinserta vigente en su transacción (mismo patrón que T075).
    const apiReuse = asTenantSql(db.appUrl, TENANTS[1]!, async (c) => {
      await c.query('DELETE FROM kuota.idempotency_keys WHERE key = $1 AND expires_at <= now()', [reusedKey]);
      await c.query(
        "INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status) VALUES ($1, $2, 'POST', '/v1/dev/probe-items', 'IN_PROGRESS')",
        [reusedKey, hash()],
      );
    });
    const [a, b] = await Promise.all([
      maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 3 })),
      maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize: 3 })),
      apiReuse,
    ]);
    expect(a.deleted + b.deleted).toBeLessThanOrEqual(expired + 1);
    expect(await expiredCount()).toBe(0);
    // Las vigentes previas siguen y la clave reutilizada existe vigente (la purga no la borró).
    expect(await liveCount()).toBe(live + 1);
    expect(
      await count('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE key = $1 AND expires_at > now()', [
        reusedKey,
      ]),
    ).toBe(1);
    expect(await untouched()).toBe(fingerprint);
  });

  it('parámetros de lote inválidos se rechazan antes de conectar con la tabla', async () => {
    for (const batchSize of [0, -1, 1.5, 10_001]) {
      await expect(maintenance((c) => purgeExpiredIdempotencyKeys(c, { batchSize }))).rejects.toBeInstanceOf(
        RangeError,
      );
    }
  });
});

describe('CLI `idempotency:purge` (proceso real)', () => {
  async function cli(env: Record<string, string>, args: string[] = []) {
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/purge-idempotency.ts', ...args],
        { cwd: BACKEND_DIR, env: { PATH: process.env['PATH'], ...env } },
      );
      recordOutput(stdout + stderr); // SC-009 · T102
      return { code: 0, out: stdout + stderr };
    } catch (error) {
      const e = error as { code: number; stdout: string; stderr: string };
      recordOutput(e.stdout + e.stderr); // SC-009 · T102
      return { code: e.code, out: e.stdout + e.stderr };
    }
  }

  it('con la credencial de mantenimiento: exit 0 y solo conteos; inspección; sin URL → 2; credencial de runtime → 1', async () => {
    const key = `cli-${randomUUID()}`;
    await seedKey(TENANTS[2]!, key, true);
    const dry = await cli({ DATABASE_URL_MAINTENANCE: db.maintenanceUrl }, ['--dry-run']);
    expect(dry).toMatchObject({ code: 0 });
    expect(dry.out).toContain('inspección: 1 clave(s) vencida(s)');
    const run = await cli({ DATABASE_URL_MAINTENANCE: db.maintenanceUrl }, ['--batch-size', '50']);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/1 clave\(s\) vencida\(s\) eliminada\(s\) en 1 lote\(s\)/);
    for (const output of [dry.out, run.out]) {
      expect(output).not.toContain(key);
      expect(output).not.toMatch(/respuesta-|[0-9a-f]{64}|postgresql:\/\//);
    }
    expect((await cli({})).code).toBe(2);
    expect((await cli({ DATABASE_URL_MAINTENANCE: db.maintenanceUrl }, ['--batch-size', 'x'])).code).toBe(2);
    const asApp = await cli({ DATABASE_URL_MAINTENANCE: db.appUrl });
    expect(asApp.code).toBe(1);
    expect(asApp.out).toContain('miembro de kuota_app');
  });
});

describe('T072 reconciliado: expiración con fixture del runtime (sin superusuario) y retirada por mantenimiento', () => {
  let app: INestApplication;
  beforeAll(async () => {
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
  });
  afterAll(async () => app?.close());

  it('una clave vencida no bloquea: la API produce un efecto nuevo; antes, mantenimiento la ve como vencida', async () => {
    const tenant = TENANTS[0]!;
    const key = `t072-${randomUUID()}`;
    await seedKey(tenant, key, true);
    const visible = await maintenance((c) =>
      c.query<{ n: string }>('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE key = $1', [key]),
    );
    expect(visible.rows[0]!.n).toBe('1');
    const res = await fetch(`${await app.getUrl()}/v1/dev/probe-items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kuota-dev-tenant': tenant,
        'x-kuota-dev-actor': 'dev:t072',
        'idempotency-key': key,
      },
      body: JSON.stringify({ label: 't072-otro-body' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('idempotent-replayed')).toBeNull();
    const renewed = await admin.query<{ ok: boolean }>(
      "SELECT expires_at = created_at + interval '30 days' AND expires_at > now() AS ok FROM kuota.idempotency_keys WHERE tenant_id = $1 AND key = $2",
      [tenant, key],
    );
    expect(renewed.rows[0]!.ok).toBe(true);
    // Renovada, deja de ser visible y borrable para mantenimiento.
    const after = await maintenance((c) => c.query('DELETE FROM kuota.idempotency_keys WHERE key = $1', [key]));
    expect(after.rowCount).toBe(0);
  });
});

describe('migración 0002: precondiciones de aprovisionamiento (fallo seguro, sin cambios parciales)', () => {
  function onlyFoundation(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kuota-0001-'));
    cpSync(MIGRATIONS_DIR, dir, {
      recursive: true,
      filter: (src) => !/0002_idempotency_maintenance|0003_platform_audit/.test(src),
    });
    return dir;
  }

  for (const [name, setup, message] of [
    [
      'sin el rol kuota_maintenance',
      'REVOKE CONNECT ON DATABASE kuota FROM kuota_maintenance; DROP ROLE kuota_maintenance_login; DROP ROLE kuota_maintenance',
      'Falta el rol kuota_maintenance',
    ],
    ['con un rol de mantenimiento con LOGIN', 'ALTER ROLE kuota_maintenance LOGIN', 'atributos no permitidos'],
    [
      'con un rol de mantenimiento miembro de kuota_app',
      'GRANT kuota_app TO kuota_maintenance',
      'no puede ser miembro',
    ],
  ] as const) {
    it(`${name}: 0002 aborta con un mensaje accionable y no deja grants ni políticas`, async () => {
      const fresh = await startTestDatabase({ applyMigrations: false });
      const dir = onlyFoundation();
      const superuser = new Client({ connectionString: fresh.superuserUrl });
      await superuser.connect();
      try {
        expect(await applyMigrations(fresh.migratorUrl, dir)).toEqual(['0001_foundation']);
        await superuser.query(setup);
        // Directo como kuota_migrator: el mismo migration.sql aborta con el mensaje accionable (y revierte por su BEGIN).
        const migrator = new Client({ connectionString: fresh.migratorUrl });
        await migrator.connect();
        try {
          const sql = readFileSync(join(MIGRATIONS_DIR, '0002_idempotency_maintenance/migration.sql'), 'utf8');
          const direct = await rejection(migrator.query(sql));
          expect((direct as Error).message).toContain(message);
        } finally {
          await migrator.end();
        }
        // Con Prisma Migrate también falla (su salida muestra «current transaction is aborted», no el RAISE): el
        // aprovisionamiento previo es condición de despliegue y se verifica antes (research.md, US6).
        expect(await rejection(applyMigrations(fresh.migratorUrl))).toBeInstanceOf(MigrateDeployError);
        const state = await superuser.query<{ policies: string; grants: string }>(
          `SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'kuota' AND policyname LIKE 'maintenance_%')::text AS policies,
                  (SELECT count(*) FROM information_schema.role_table_grants
                    WHERE table_schema = 'kuota' AND grantee LIKE 'kuota_maintenance%')::text AS grants`,
        );
        expect(state.rows[0]).toEqual({ policies: '0', grants: '0' });
      } finally {
        await superuser.end();
        rmSync(dir, { recursive: true, force: true });
        await fresh.stop();
      }
    }, 180_000);
  }
});
