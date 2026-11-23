import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';

/**
 * Condiciones P3 y P4 de ADR-0004 sobre el esquema EFECTIVO tras `prisma migrate deploy` (PostgreSQL 18 real).
 * P3: propietario y privilegios de public._prisma_migrations y del esquema public.
 * P4: lo que Prisma no representa (CHECK, función, triggers, grants, propietarios) y `migrate diff` como complemento.
 */
const BACKEND_DIR = join(__dirname, '../..');

async function query<T extends Record<string, unknown>>(url: string, sql: string): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

describe('P3/P4 — esquema efectivo tras prisma migrate deploy', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    // Worker simulado (P6): miembro con herencia de kuota_app, como exigiría su futura tarea. Solo en este contenedor.
    await query(db.superuserUrl, 'CREATE ROLE spike_worker NOLOGIN NOBYPASSRLS INHERIT IN ROLE kuota_app');
  });

  afterAll(async () => {
    await db?.stop();
  });

  describe('P3 — public._prisma_migrations', () => {
    it('está en public y su propietario es kuota_migrator', async () => {
      const rows = await query<{ schemaname: string; tableowner: string }>(
        db.migratorUrl,
        "SELECT schemaname, tableowner FROM pg_tables WHERE tablename = '_prisma_migrations'",
      );
      expect(rows).toEqual([{ schemaname: 'public', tableowner: 'kuota_migrator' }]);
    });

    it('runtime, worker y PUBLIC no tienen ningún privilegio sobre ella', async () => {
      const rows = await query<{ role: string; granted: boolean }>(
        db.superuserUrl,
        `SELECT r AS role, has_table_privilege(r, 'public._prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted
           FROM unnest(ARRAY['kuota_app','kuota_app_login','spike_worker','public']) AS r`,
      );
      expect(rows.filter((r) => r.granted)).toEqual([]);
    });

    it('el runtime no puede leerla ni crear objetos en public (no puede suplantar tablas vía search_path)', async () => {
      await expect(query(db.appUrl, 'SELECT * FROM public._prisma_migrations')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(query(db.appUrl, 'CREATE TABLE public.dev_probe_items (id int)')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(query(db.appUrl, 'CREATE SCHEMA kuota_app_login')).rejects.toMatchObject({ code: '42501' });
      const rows = await query<{ role: string; can_create: boolean }>(
        db.superuserUrl,
        `SELECT r AS role, has_schema_privilege(r, 'public', 'CREATE') AS can_create
           FROM unnest(ARRAY['kuota_app','kuota_app_login','spike_worker','public']) AS r`,
      );
      expect(rows.filter((r) => r.can_create)).toEqual([]);
    });

    it('search_path del runtime: valor por defecto y ningún esquema del path es escribible por él', async () => {
      const rows = await query<{ search_path: string; user_schema: boolean }>(
        db.appUrl,
        "SELECT current_setting('search_path') AS search_path, to_regnamespace(current_user) IS NOT NULL AS user_schema",
      );
      expect(rows).toEqual([{ search_path: '"$user", public', user_schema: false }]);
    });

    it('kuota_migrator es propietario efectivo del esquema public (puede gestionar el historial)', async () => {
      const rows = await query<{ owner: string; can_create: boolean }>(
        db.migratorUrl,
        "SELECT pg_get_userbyid(nspowner) AS owner, has_schema_privilege('kuota_migrator', 'public', 'CREATE') AS can_create FROM pg_namespace WHERE nspname = 'public'",
      );
      expect(rows).toEqual([{ owner: 'pg_database_owner', can_create: true }]);
    });
  });

  describe('P4 — objetos que Prisma no representa', () => {
    // PostgreSQL 18 registra también los NOT NULL en pg_constraint (contype 'n'); la nulabilidad se verifica columna a
    // columna en foundation-schema.spec.ts, así que aquí se comparan CHECK, PK, UNIQUE y FK.
    it('existen exactamente las restricciones de la migración canónica, por nombre y tipo', async () => {
      const rows = await query<{ name: string }>(
        db.migratorUrl,
        `SELECT conrelid::regclass::text || '.' || conname || ':' || contype::text AS name
           FROM pg_constraint WHERE connamespace = 'kuota'::regnamespace AND contype <> 'n' ORDER BY 1`,
      );
      expect(rows.map((r) => r.name)).toEqual([
        'kuota.audit_events.audit_events_actor_type_values:c',
        'kuota.audit_events.audit_events_changes_object:c',
        'kuota.audit_events.audit_events_pkey:p',
        'kuota.dev_probe_items.dev_probe_items_amount_currency:c',
        'kuota.dev_probe_items.dev_probe_items_amount_domain:c',
        'kuota.dev_probe_items.dev_probe_items_currency_format:c',
        'kuota.dev_probe_items.dev_probe_items_label_length:c',
        'kuota.dev_probe_items.dev_probe_items_pkey:p',
        'kuota.dev_probe_items.dev_probe_items_tenant_id_key:u',
        'kuota.dev_probe_items.dev_probe_items_version_positive:c',
        'kuota.idempotency_keys.idempotency_keys_completed_has_response:c',
        'kuota.idempotency_keys.idempotency_keys_expiry_after_creation:c',
        'kuota.idempotency_keys.idempotency_keys_key_format:c',
        'kuota.idempotency_keys.idempotency_keys_method_format:c',
        'kuota.idempotency_keys.idempotency_keys_pkey:p',
        'kuota.idempotency_keys.idempotency_keys_request_hash_sha256:c',
        'kuota.idempotency_keys.idempotency_keys_response_status_range:c',
        'kuota.idempotency_keys.idempotency_keys_status_values:c',
        'kuota.platform_audit_events.platform_audit_events_counts_non_negative:c',
        'kuota.platform_audit_events.platform_audit_events_operation_values:c',
        'kuota.platform_audit_events.platform_audit_events_pkey:p',
        'kuota.platform_audit_events.platform_audit_events_result_by_status:c',
        'kuota.platform_audit_events.platform_audit_events_result_code_format:c',
        'kuota.platform_audit_events.platform_audit_events_run_status_unique:u',
        'kuota.platform_audit_events.platform_audit_events_status_values:c',
      ]);
    });

    it('las funciones de auditoría pertenecen al migrador, fijan search_path y PUBLIC no puede ejecutarlas', async () => {
      const rows = await query<{ owner: string; config: string[] | null; public_exec: boolean; secdef: boolean }>(
        db.migratorUrl,
        `SELECT pg_get_userbyid(proowner) AS owner, proconfig AS config, prosecdef AS secdef,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
           FROM pg_proc p WHERE pronamespace = 'kuota'::regnamespace`,
      );
      // audit_events (0001) y platform_audit_events: sello y append-only (0003, T099).
      expect(rows).toEqual(
        Array.from({ length: 3 }, () => ({
          owner: 'kuota_migrator',
          config: ['search_path=pg_catalog'],
          public_exec: false,
          secdef: false,
        })),
      );
    });

    it('tablas, triggers, políticas y grants coinciden con lo esperado', async () => {
      const [summary] = await query<{
        owners: string;
        forced: string;
        policies: string;
        triggers: string;
        grants: string;
      }>(
        db.migratorUrl,
        `SELECT (SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname = 'kuota') AS owners,
                (SELECT count(*) FROM pg_class WHERE relnamespace = 'kuota'::regnamespace AND relkind = 'r'
                    AND relrowsecurity AND relforcerowsecurity)::text AS forced,
                (SELECT string_agg(tablename || ':' || policyname || ':' || array_to_string(roles, ','), ' ' ORDER BY tablename)
                   FROM pg_policies WHERE schemaname = 'kuota') AS policies,
                (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
                  WHERE tgrelid = 'kuota.audit_events'::regclass AND NOT tgisinternal) AS triggers,
                (SELECT string_agg(table_name || ':' || privilege_type, ',' ORDER BY table_name, privilege_type)
                   FROM information_schema.role_table_grants WHERE table_schema = 'kuota' AND grantee = 'kuota_app') AS grants`,
      );
      expect(summary).toEqual({
        owners: 'kuota_migrator',
        forced: '4',
        policies:
          'audit_events:tenant_isolation:kuota_app dev_probe_items:tenant_isolation:kuota_app idempotency_keys:maintenance_delete_expired:kuota_maintenance idempotency_keys:maintenance_select_expired:kuota_maintenance idempotency_keys:tenant_isolation:kuota_app platform_audit_events:maintenance_insert_audit:kuota_maintenance',
        triggers: 'audit_events_append_only,audit_events_no_truncate',
        grants:
          'audit_events:INSERT,audit_events:SELECT,dev_probe_items:DELETE,dev_probe_items:INSERT,dev_probe_items:SELECT,dev_probe_items:UPDATE,idempotency_keys:DELETE,idempotency_keys:INSERT,idempotency_keys:SELECT,idempotency_keys:UPDATE',
      });
    });

    it('complemento: prisma migrate diff entre la base y schema.prisma no propone cambios', async () => {
      const { stdout } = await promisify(execFile)(
        join(BACKEND_DIR, 'node_modules/.bin/prisma'),
        ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'],
        { cwd: BACKEND_DIR, env: { ...process.env, DATABASE_URL_MIGRATOR: db.migratorUrl }, timeout: 120_000 },
      );
      expect(stdout).toContain('This is an empty migration.');
    });
  });
});
