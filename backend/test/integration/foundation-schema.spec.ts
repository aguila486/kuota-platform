import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, MigrateDeployError, startTestDatabase, type TestDatabase } from '../support/postgres.js';

/**
 * G2 (T012/T013): migración 0001_foundation sobre PostgreSQL 18 real (Testcontainers).
 * Verifica estructura, privilegios, RLS forzado con comportamiento fail-closed y auditoría append-only.
 * Referencias: data-model.md, ADR-0004 (C4-1, C4-3), research R-07, Constitución III, VII.
 */

const TABLES = ['audit_events', 'dev_probe_items', 'idempotency_keys'] as const;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const BIGINT_MIN = '-9223372036854775808';

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Ejecuta fn en una transacción con el contexto de tenant fijado como hará withTenant (set_config local). */
async function inTenant<T>(client: Client, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), set_config('app.correlation_id', $3, true)",
      [tenantId, 'dev:tester', randomUUID()],
    );
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function pgCode(error: unknown): string | undefined {
  return (error as DatabaseError | undefined)?.code;
}

async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `se esperaba el error SQLSTATE ${code}`).toBeDefined();
  expect(pgCode(caught)).toBe(code);
}

describe('G2 — migración 0001_foundation', () => {
  let db: TestDatabase;
  let migrator: Client;
  let app: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    migrator = await connect(db.migratorUrl);
    app = await connect(db.appUrl);
  });

  afterAll(async () => {
    await app?.end();
    await migrator?.end();
    await db?.stop();
  });

  describe('estructura', () => {
    it('crea el esquema kuota y exactamente las 3 tablas, propiedad de kuota_migrator', async () => {
      const schema = await migrator.query<{ owner: string }>(
        "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'kuota'",
      );
      expect(schema.rows[0]?.owner).toBe('kuota_migrator');
      const tables = await migrator.query<{ tablename: string; tableowner: string }>(
        "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'kuota' ORDER BY tablename",
      );
      expect(tables.rows).toEqual(TABLES.map((tablename) => ({ tablename, tableowner: 'kuota_migrator' })));
    });

    it('define las columnas, tipos y nulabilidad de data-model.md', async () => {
      const columns = await migrator.query<{ t: string; c: string; type: string; nullable: string }>(
        `SELECT table_name AS t, column_name AS c, data_type AS type, is_nullable AS nullable
           FROM information_schema.columns WHERE table_schema = 'kuota' ORDER BY table_name, ordinal_position`,
      );
      const got = columns.rows.map((r) => `${r.t}.${r.c}:${r.type}:${r.nullable}`);
      expect(got).toEqual([
        'audit_events.id:uuid:NO',
        'audit_events.tenant_id:uuid:NO',
        'audit_events.actor_id:text:NO',
        'audit_events.actor_type:text:NO',
        'audit_events.actor_role:text:YES',
        'audit_events.action:text:NO',
        'audit_events.entity_type:text:NO',
        'audit_events.entity_id:text:NO',
        'audit_events.changes:jsonb:NO',
        'audit_events.occurred_at:timestamp with time zone:NO',
        'audit_events.device_time:timestamp with time zone:YES',
        'audit_events.origin:text:NO',
        'audit_events.correlation_id:text:NO',
        'audit_events.idempotency_key:text:YES',
        'dev_probe_items.id:uuid:NO',
        'dev_probe_items.tenant_id:uuid:NO',
        'dev_probe_items.label:text:NO',
        'dev_probe_items.sample_amount_minor:bigint:YES',
        'dev_probe_items.sample_currency:character:YES',
        'dev_probe_items.version:integer:NO',
        'dev_probe_items.created_at:timestamp with time zone:NO',
        'dev_probe_items.updated_at:timestamp with time zone:NO',
        'idempotency_keys.tenant_id:uuid:NO',
        'idempotency_keys.key:text:NO',
        'idempotency_keys.request_hash:text:NO',
        'idempotency_keys.method:text:NO',
        'idempotency_keys.path:text:NO',
        'idempotency_keys.status:text:NO',
        'idempotency_keys.response_status:integer:YES',
        'idempotency_keys.response_body:jsonb:YES',
        'idempotency_keys.created_at:timestamp with time zone:NO',
        'idempotency_keys.expires_at:timestamp with time zone:NO',
      ]);
    });

    it('define claves primarias, unicidad por tenant e índices encabezados por tenant_id', async () => {
      const indexes = await migrator.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'kuota' ORDER BY indexname",
      );
      const defs = indexes.rows.map((r) => r.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON kuota\./, '$1'));
      expect(defs).toEqual(
        expect.arrayContaining([
          'UNIQUE audit_events USING btree (id)',
          'audit_events USING btree (tenant_id, occurred_at)',
          'UNIQUE dev_probe_items USING btree (id)',
          'UNIQUE dev_probe_items USING btree (tenant_id, id)',
          'UNIQUE idempotency_keys USING btree (tenant_id, key)',
          'idempotency_keys USING btree (expires_at)',
        ]),
      );
    });

    it('tiene RLS habilitado y FORCE en las 3 tablas, con la política estándar (nullif)', async () => {
      const rls = await migrator.query<{ relname: string; enabled: boolean; forced: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'kuota' AND c.relkind = 'r' ORDER BY c.relname`,
      );
      expect(rls.rows).toEqual(TABLES.map((relname) => ({ relname, enabled: true, forced: true })));
      const policies = await migrator.query<{
        tablename: string;
        roles: string;
        cmd: string;
        qual: string;
        with_check: string;
      }>(
        `SELECT tablename, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'kuota' ORDER BY tablename`,
      );
      expect(policies.rows.map((p) => p.tablename)).toEqual([...TABLES]);
      for (const policy of policies.rows) {
        expect(policy.roles).toBe('{kuota_app}');
        expect(policy.cmd).toBe('ALL');
        for (const expr of [policy.qual, policy.with_check]) {
          expect(expr.toLowerCase()).toContain("nullif(current_setting('app.tenant_id'::text, true), ''::text))::uuid");
        }
      }
    });

    it('tiene los triggers de inmutabilidad en audit_events (UPDATE/DELETE por fila y TRUNCATE)', async () => {
      const triggers = await migrator.query<{ tgname: string; def: string }>(
        `SELECT tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'kuota' AND NOT t.tgisinternal ORDER BY tgname`,
      );
      expect(triggers.rows.map((t) => t.def)).toEqual([
        expect.stringMatching(/BEFORE DELETE OR UPDATE ON kuota\.audit_events FOR EACH ROW/),
        expect.stringMatching(/BEFORE TRUNCATE ON kuota\.audit_events FOR EACH STATEMENT/),
      ]);
    });

    it('aplica los CHECK de data-model.md y el dominio simétrico de Money (ADR-0007)', async () => {
      const insertProbe = (label: string, amount: string | null, currency: string | null) =>
        inTenant(app, TENANT_A, () =>
          app.query(
            'INSERT INTO kuota.dev_probe_items (label, sample_amount_minor, sample_currency) VALUES ($1, $2, $3)',
            [label, amount, currency],
          ),
        );
      await expectPgError(insertProbe('', null, null), '23514');
      await expectPgError(insertProbe('x'.repeat(121), null, null), '23514');
      await expectPgError(insertProbe('ok', '100', null), '23514');
      await expectPgError(insertProbe('ok', null, 'MXN'), '23514');
      await expectPgError(insertProbe('ok', '100', 'mxn'), '23514');
      await expectPgError(insertProbe('ok', BIGINT_MIN, 'MXN'), '23514');
      await insertProbe('x'.repeat(120), '-9223372036854775807', 'MXN');
      await insertProbe('sin monto', null, null);

      const insertKey = (key: string, hash: string, status: string, responseStatus: number | null) =>
        inTenant(app, TENANT_A, () =>
          app.query(
            'INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status, response_status) VALUES ($1, $2, $3, $4, $5, $6)',
            [key, hash, 'POST', '/v1/dev/probe-items', status, responseStatus],
          ),
        );
      const hash = 'a'.repeat(64);
      await expectPgError(insertKey('short77', hash, 'IN_PROGRESS', null), '23514');
      await expectPgError(insertKey('bad key with spaces', hash, 'IN_PROGRESS', null), '23514');
      await expectPgError(insertKey('k'.repeat(129), hash, 'IN_PROGRESS', null), '23514');
      await expectPgError(insertKey('valid-key-0001', 'not-a-sha256', 'IN_PROGRESS', null), '23514');
      await expectPgError(insertKey('valid-key-0002', hash, 'DONE', null), '23514');
      await expectPgError(insertKey('valid-key-0003', hash, 'COMPLETED', null), '23514');
      await expectPgError(insertKey('valid-key-0004', hash, 'COMPLETED', 500), '23514');
      await insertKey('valid-key-0005', hash, 'COMPLETED', 201);
      await insertKey('valid-key-0006', hash, 'IN_PROGRESS', null);

      await expectPgError(
        inTenant(app, TENANT_A, () =>
          app.query(
            "INSERT INTO kuota.audit_events (actor_type, action, entity_type, entity_id, origin) VALUES ('ROBOT', 'dev_probe.created', 'dev_probe', 'x', 'test')",
          ),
        ),
        '23514',
      );
    });
  });

  describe('privilegios (T013)', () => {
    it('kuota_app tiene DML en dev_probe_items e idempotency_keys y solo SELECT/INSERT en audit_events', async () => {
      const privileges = await migrator.query<{ t: string; p: string; ok: boolean }>(
        `SELECT t, p, has_table_privilege('kuota_app', 'kuota.' || t, p) AS ok
           FROM unnest(ARRAY['dev_probe_items','idempotency_keys','audit_events']) AS t,
                unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`,
      );
      const granted = privileges.rows.filter((r) => r.ok).map((r) => `${r.t}:${r.p}`);
      expect(granted.sort()).toEqual(
        [
          'audit_events:INSERT',
          'audit_events:SELECT',
          'dev_probe_items:DELETE',
          'dev_probe_items:INSERT',
          'dev_probe_items:SELECT',
          'dev_probe_items:UPDATE',
          'idempotency_keys:DELETE',
          'idempotency_keys:INSERT',
          'idempotency_keys:SELECT',
          'idempotency_keys:UPDATE',
        ].sort(),
      );
    });

    it('PUBLIC no tiene privilegios en el esquema ni en las tablas', async () => {
      const result = await migrator.query<{ usage: boolean; any_table: boolean }>(
        `SELECT has_schema_privilege('public', 'kuota', 'USAGE') AS usage,
                bool_or(has_table_privilege('public', 'kuota.' || t, 'SELECT,INSERT,UPDATE,DELETE')) AS any_table
           FROM unnest(ARRAY['dev_probe_items','idempotency_keys','audit_events']) AS t`,
      );
      expect(result.rows[0]).toEqual({ usage: false, any_table: false });
    });

    it('el runtime (kuota_app_login) no puede hacer DDL, desactivar RLS ni desactivar triggers', async () => {
      await expectPgError(app.query('CREATE TABLE kuota.x (id int)'), '42501');
      await expectPgError(app.query('ALTER TABLE kuota.dev_probe_items DISABLE ROW LEVEL SECURITY'), '42501');
      await expectPgError(app.query('ALTER TABLE kuota.dev_probe_items NO FORCE ROW LEVEL SECURITY'), '42501');
      await expectPgError(app.query('ALTER TABLE kuota.audit_events DISABLE TRIGGER USER'), '42501');
      await expectPgError(app.query('DROP POLICY tenant_isolation ON kuota.dev_probe_items'), '42501');
      await expectPgError(app.query('TRUNCATE kuota.dev_probe_items'), '42501');
    });

    it('el runtime no puede apagar row_security para saltarse las políticas', async () => {
      await app.query('BEGIN');
      try {
        await app.query('SET LOCAL row_security = off');
        await expectPgError(app.query('SELECT count(*) FROM kuota.dev_probe_items'), '42501');
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  describe('aislamiento entre tenants (RLS forzado, fail-closed)', () => {
    let itemOfA: string;

    beforeAll(async () => {
      const inserted = await inTenant(app, TENANT_A, () =>
        app.query<{ id: string; tenant_id: string }>(
          "INSERT INTO kuota.dev_probe_items (label) VALUES ('del tenant A') RETURNING id, tenant_id",
        ),
      );
      itemOfA = inserted.rows[0]!.id;
      expect(inserted.rows[0]?.tenant_id).toBe(TENANT_A);
      await inTenant(app, TENANT_B, () =>
        app.query("INSERT INTO kuota.dev_probe_items (label) VALUES ('del tenant B')"),
      );
    });

    it('el id es UUIDv7 generado por el servidor y tenant_id sale del contexto', async () => {
      const row = await inTenant(app, TENANT_A, () =>
        app.query<{ v: number }>('SELECT uuid_extract_version(id) AS v FROM kuota.dev_probe_items WHERE id = $1', [
          itemOfA,
        ]),
      );
      expect(row.rows[0]?.v).toBe(7);
    });

    it('cada tenant solo ve sus filas', async () => {
      const seenByA = await inTenant(app, TENANT_A, () =>
        app.query<{ label: string }>('SELECT label FROM kuota.dev_probe_items ORDER BY label'),
      );
      const seenByB = await inTenant(app, TENANT_B, () =>
        app.query<{ label: string }>('SELECT label FROM kuota.dev_probe_items ORDER BY label'),
      );
      expect(seenByA.rows.every((r) => r.label !== 'del tenant B')).toBe(true);
      expect(seenByA.rows.some((r) => r.label === 'del tenant A')).toBe(true);
      expect(seenByB.rows.map((r) => r.label)).toEqual(['del tenant B']);
    });

    it('sin contexto: 0 filas sin error, en conexión nueva y en una conexión que ya usó set_config local', async () => {
      const fresh = await connect(db.appUrl);
      try {
        for (const table of TABLES) {
          const count = await fresh.query<{ n: string }>(`SELECT count(*) AS n FROM kuota.${table}`);
          expect(count.rows[0]?.n, table).toBe('0');
        }
      } finally {
        await fresh.end();
      }
      // `app` ya ejecutó transacciones con set_config(..., true): fuera de ellas la variable vale '' (no NULL).
      const setting = await app.query<{ v: string | null }>("SELECT current_setting('app.tenant_id', true) AS v");
      expect(setting.rows[0]?.v).toBe('');
      for (const table of TABLES) {
        const count = await app.query<{ n: string }>(`SELECT count(*) AS n FROM kuota.${table}`);
        expect(count.rows[0]?.n, table).toBe('0');
      }
    });

    it('el tenant B no puede actualizar ni borrar filas de A (0 filas afectadas)', async () => {
      const updated = await inTenant(app, TENANT_B, () =>
        app.query("UPDATE kuota.dev_probe_items SET label = 'hackeado' WHERE id = $1", [itemOfA]),
      );
      const deleted = await inTenant(app, TENANT_B, () =>
        app.query('DELETE FROM kuota.dev_probe_items WHERE id = $1', [itemOfA]),
      );
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
      const stillThere = await inTenant(app, TENANT_A, () =>
        app.query<{ label: string }>('SELECT label FROM kuota.dev_probe_items WHERE id = $1', [itemOfA]),
      );
      expect(stillThere.rows[0]?.label).toBe('del tenant A');
    });

    it('no se puede insertar ni mover filas a otro tenant (WITH CHECK)', async () => {
      await expectPgError(
        inTenant(app, TENANT_A, () =>
          app.query("INSERT INTO kuota.dev_probe_items (tenant_id, label) VALUES ($1, 'inyectada')", [TENANT_B]),
        ),
        '42501',
      );
      await expectPgError(
        inTenant(app, TENANT_A, () =>
          app.query('UPDATE kuota.dev_probe_items SET tenant_id = $1 WHERE id = $2', [TENANT_B, itemOfA]),
        ),
        '42501',
      );
    });

    it('sin contexto no se puede insertar (WITH CHECK rechaza tenant_id NULL) y un contexto malformado falla cerrado', async () => {
      // PostgreSQL evalúa WITH CHECK de RLS antes que NOT NULL: NULL = NULL no es verdadero → 42501.
      await expectPgError(app.query("INSERT INTO kuota.dev_probe_items (label) VALUES ('sin contexto')"), '42501');
      await expectPgError(
        inTenant(app, 'no-es-un-uuid', () => app.query('SELECT count(*) FROM kuota.dev_probe_items')),
        '22P02',
      );
    });

    it('idempotency_keys: la misma clave en dos tenants son registros independientes e invisibles entre sí', async () => {
      const key = 'shared-key-123';
      const hash = 'b'.repeat(64);
      for (const tenant of [TENANT_A, TENANT_B]) {
        await inTenant(app, tenant, () =>
          app.query(
            "INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status) VALUES ($1, $2, 'POST', '/x', 'IN_PROGRESS')",
            [key, hash],
          ),
        );
      }
      const seenByA = await inTenant(app, TENANT_A, () =>
        app.query<{ tenant_id: string }>('SELECT tenant_id FROM kuota.idempotency_keys WHERE key = $1', [key]),
      );
      expect(seenByA.rows).toEqual([{ tenant_id: TENANT_A }]);
      const expires = await inTenant(app, TENANT_A, () =>
        app.query<{ days: number }>(
          'SELECT extract(day FROM expires_at - created_at)::int AS days FROM kuota.idempotency_keys WHERE key = $1',
          [key],
        ),
      );
      expect(expires.rows[0]?.days).toBe(30);
    });
  });

  describe('auditoría append-only (R-07)', () => {
    let eventId: string;

    beforeAll(async () => {
      const inserted = await inTenant(app, TENANT_A, () =>
        app.query<{ id: string; actor_id: string; correlation_id: string; actor_role: string | null }>(
          `INSERT INTO kuota.audit_events (actor_type, action, entity_type, entity_id, origin, changes)
           VALUES ('DEV', 'dev_probe.created', 'dev_probe', 'item-1', 'test', '{"label": "x"}')
           RETURNING id, actor_id, correlation_id, actor_role`,
        ),
      );
      eventId = inserted.rows[0]!.id;
      expect(inserted.rows[0]).toMatchObject({ actor_id: 'dev:tester', actor_role: null });
      expect(inserted.rows[0]?.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('el runtime puede insertar y leer, pero no actualizar ni borrar (sin privilegio)', async () => {
      await expectPgError(
        inTenant(app, TENANT_A, () => app.query("UPDATE kuota.audit_events SET action = 'x' WHERE id = $1", [eventId])),
        '42501',
      );
      await expectPgError(
        inTenant(app, TENANT_A, () => app.query('DELETE FROM kuota.audit_events WHERE id = $1', [eventId])),
        '42501',
      );
    });

    it('el propietario (kuota_migrator) no ve filas: FORCE RLS sin política para él', async () => {
      const seen = await inTenant(migrator, TENANT_A, () =>
        migrator.query<{ n: string }>('SELECT count(*) AS n FROM kuota.audit_events'),
      );
      expect(seen.rows[0]?.n).toBe('0');
    });

    it('si el propietario se saltara RLS, el trigger sigue impidiendo modificar, borrar y truncar', async () => {
      for (const sql of [
        "UPDATE kuota.audit_events SET action = 'x'",
        'DELETE FROM kuota.audit_events',
        'TRUNCATE kuota.audit_events',
      ]) {
        await migrator.query('BEGIN');
        try {
          // Simula un propietario que desactiva FORCE (solo él puede); la transacción se revierte.
          await migrator.query('ALTER TABLE kuota.audit_events NO FORCE ROW LEVEL SECURITY');
          await expectPgError(migrator.query(sql), 'P0001');
        } finally {
          await migrator.query('ROLLBACK');
        }
      }
      const forced = await migrator.query<{ f: boolean }>(
        "SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'kuota.audit_events'::regclass",
      );
      expect(forced.rows[0]?.f).toBe(true);
      const remaining = await inTenant(app, TENANT_A, () =>
        app.query<{ n: string }>('SELECT count(*) AS n FROM kuota.audit_events WHERE id = $1', [eventId]),
      );
      expect(remaining.rows[0]?.n).toBe('1');
    });

    it('otro tenant no ve el evento de auditoría', async () => {
      const seenByB = await inTenant(app, TENANT_B, () =>
        app.query<{ n: string }>('SELECT count(*) AS n FROM kuota.audit_events WHERE id = $1', [eventId]),
      );
      expect(seenByB.rows[0]?.n).toBe('0');
    });
  });
});

describe('G2/P1 — migración 0001 con prisma migrate deploy (transacción explícita)', () => {
  const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase({ applyMigrations: false });
  });

  afterAll(async () => {
    await db?.stop();
  });

  async function catalog(url: string): Promise<{ kuota: boolean; history: boolean }> {
    const client = await connect(url);
    try {
      const r = await client.query<{ kuota: boolean; history: boolean }>(
        "SELECT to_regnamespace('kuota') IS NOT NULL AS kuota, to_regclass('public._prisma_migrations') IS NOT NULL AS history",
      );
      return r.rows[0]!;
    } finally {
      await client.end();
    }
  }

  it('el rol de runtime (kuota_app_login) no puede migrar y no deja objetos', async () => {
    let caught: unknown;
    try {
      await applyMigrations(db.appUrl);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MigrateDeployError);
    expect((caught as MigrateDeployError).output).toMatch(/permission denied/i);
    expect(await catalog(db.migratorUrl)).toEqual({ kuota: false, history: false });
  });

  it('kuota_migrator la aplica desde cero, queda registrada y una segunda ejecución no tiene cambios pendientes', async () => {
    expect(await applyMigrations(db.migratorUrl)).toEqual(['0001_foundation']);
    const client = await connect(db.migratorUrl);
    try {
      const history = await client.query<{ migration_name: string; steps: number; owner: string }>(
        `SELECT migration_name, applied_steps_count AS steps,
                (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') AS owner
           FROM public._prisma_migrations`,
      );
      expect(history.rows).toEqual([{ migration_name: '0001_foundation', steps: 1, owner: 'kuota_migrator' }]);
      expect(await applyMigrations(db.migratorUrl)).toEqual(['0001_foundation']);
      const count = await client.query<{ n: string }>('SELECT count(*) AS n FROM public._prisma_migrations');
      expect(count.rows[0]?.n).toBe('1');
      const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'kuota'");
      expect(tables.rowCount).toBe(3);
    } finally {
      await client.end();
    }
  });

  it('un fallo inyectado a mitad de 0001 revierte todo: sin esquema kuota y con la migración sin terminar', async () => {
    const failing = await startTestDatabase({ applyMigrations: false });
    const temp = mkdtempSync(join(tmpdir(), 'kuota-p1-'));
    try {
      cpSync(MIGRATIONS_DIR, temp, { recursive: true });
      const file = join(temp, '0001_foundation', 'migration.sql');
      const sql = readFileSync(file, 'utf8');
      // Fallo después de crear esquema, tablas, triggers y políticas, justo antes del COMMIT final.
      writeFileSync(file, sql.replace(/\nCOMMIT;\s*$/, '\nSELECT 1 / 0;\nCOMMIT;\n'));
      expect(readFileSync(file, 'utf8')).toMatch(/SELECT 1 \/ 0;\nCOMMIT;\n$/);
      await expect(applyMigrations(failing.migratorUrl, temp)).rejects.toBeInstanceOf(MigrateDeployError);
      expect((await catalog(failing.migratorUrl)).kuota).toBe(false);
      const client = await connect(failing.migratorUrl);
      try {
        const history = await client.query<{ finished: boolean }>(
          "SELECT finished_at IS NOT NULL AS finished FROM public._prisma_migrations WHERE migration_name = '0001_foundation'",
        );
        expect(history.rows).toEqual([{ finished: false }]);
      } finally {
        await client.end();
      }
      // Prisma bloquea despliegues posteriores hasta resolver el fallo (P3009); no se usa `migrate resolve`.
      let blocked: unknown;
      try {
        await applyMigrations(failing.migratorUrl, temp);
      } catch (error) {
        blocked = error;
      }
      expect((blocked as MigrateDeployError).output).toMatch(/P3009/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
      await failing.stop();
    }
  });

  it('el archivo declara su propia transacción (BEGIN al inicio, COMMIT al final) y no contiene contraseñas', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0001_foundation', 'migration.sql'), 'utf8');
    const statements = sql.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('--'));
    expect(statements[0]?.trim()).toBe('BEGIN;');
    expect(statements.at(-1)?.trim()).toBe('COMMIT;');
    expect(sql).not.toMatch(/PASSWORD/i);
  });
});
