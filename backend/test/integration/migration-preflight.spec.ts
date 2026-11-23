import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { migrationPreflight, PreflightAccessError } from '../../scripts/migration-preflight.js';
import { applyMigrations, startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { rejection } from '../support/tenant-data.js';

/**
 * Preflight de migraciones (cierre de US6, Aprobación 4): sobre PostgreSQL 18 efímero, con la identidad de migración
 * `kuota_migrator` (la misma que usa `make up` para migrar). El superusuario del contenedor solo prepara escenarios
 * (rol ausente o con atributos inválidos) y lee el estado para comprobar que el preflight no cambió nada.
 */
const BACKEND_DIR = join(__dirname, '../..');
const REPO_ROOT = join(BACKEND_DIR, '..');
const MIGRATIONS_DIR = join(BACKEND_DIR, 'prisma/migrations');
const ALL = ['0001_foundation', '0002_idempotency_maintenance'];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function database(applyAll = false): Promise<TestDatabase> {
  const db = await startTestDatabase({ applyMigrations: applyAll });
  cleanups.push(() => db.stop());
  return db;
}
async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  cleanups.push(() => client.end());
  return client;
}
/** Simula un volumen inicializado antes de 0002: solo 0001 aplicada. */
async function onlyFoundation(db: TestDatabase): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'kuota-0001-'));
  try {
    cpSync(MIGRATIONS_DIR, dir, { recursive: true, filter: (src) => !src.includes('0002_idempotency_maintenance') });
    expect(await applyMigrations(db.migratorUrl, dir)).toEqual(['0001_foundation']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Estado que el preflight nunca debe alterar. */
async function snapshot(superuser: Client): Promise<string> {
  const { rows } = await superuser.query<{ s: string }>(
    `SELECT concat_ws('|',
       (SELECT string_agg(migration_name || ':' || (finished_at IS NOT NULL), ',' ORDER BY migration_name) FROM public._prisma_migrations),
       (SELECT string_agg(rolname || ':' || rolcanlogin, ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'kuota%'),
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'kuota')::text,
       (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'kuota')::text) AS s`,
  );
  return rows[0]!.s;
}
async function cli(env: Record<string, string>) {
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/migration-preflight.ts'],
      { cwd: BACKEND_DIR, env: { PATH: process.env['PATH'], ...env } },
    );
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

describe('preflight de migraciones (0002)', () => {
  it('base nueva correctamente aprovisionada: sin historial, 0001 y 0002 pendientes, se puede migrar', async () => {
    const db = await database();
    const migrator = await connect(db.migratorUrl);
    expect(await migrationPreflight(migrator)).toEqual({ ok: true, newDatabase: true, pending: ALL, problems: [] });
    expect(await applyMigrations(db.migratorUrl)).toEqual(ALL);
  }, 180_000);

  it('0002 ya aplicada: nada pendiente y no se verifica el rol de nuevo', async () => {
    const db = await database(true);
    const migrator = await connect(db.migratorUrl);
    expect(await migrationPreflight(migrator)).toEqual({ ok: true, newDatabase: false, pending: [], problems: [] });
  }, 180_000);

  it('base existente (0001 aplicada) con el rol correcto y 0002 pendiente: se puede migrar, aunque no exista el login de mantenimiento', async () => {
    const db = await database();
    await onlyFoundation(db);
    const superuser = await connect(db.superuserUrl);
    await superuser.query('DROP ROLE kuota_maintenance_login');
    const migrator = await connect(db.migratorUrl);
    expect(await migrationPreflight(migrator)).toEqual({
      ok: true,
      newDatabase: false,
      pending: ['0002_idempotency_maintenance'],
      problems: [],
    });
  }, 180_000);

  it('base existente sin el rol de mantenimiento: bloquea con la acción administrativa y no cambia nada; el CLI sale con 1 sin credenciales', async () => {
    const db = await database();
    await onlyFoundation(db);
    const superuser = await connect(db.superuserUrl);
    await superuser.query(
      'REVOKE CONNECT ON DATABASE kuota FROM kuota_maintenance; DROP ROLE kuota_maintenance_login; DROP ROLE kuota_maintenance',
    );
    const before = await snapshot(superuser);
    const migrator = await connect(db.migratorUrl);
    const result = await migrationPreflight(migrator);
    expect(result).toMatchObject({ ok: false, newDatabase: false, pending: ['0002_idempotency_maintenance'] });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('kuota_maintenance y no existe');
    expect(result.problems[0]).toContain('infra/docker/postgres/init/02-maintenance-roles.sql');
    const run = await cli({ DATABASE_URL_MIGRATOR: db.migratorUrl });
    expect(run.code).toBe(1);
    expect(run.out).toContain('NO se migra');
    const password = new URL(db.migratorUrl).password;
    expect(run.out).not.toContain(password);
    expect(run.out).not.toContain('postgresql://');
    // El preflight no migró, no aprovisionó y no tocó el historial.
    expect(await snapshot(superuser)).toBe(before);
    expect(before.startsWith('0001_foundation:true|')).toBe(true);
  }, 180_000);

  for (const [name, setup, expected] of [
    ['con LOGIN', 'ALTER ROLE kuota_maintenance LOGIN', 'tiene LOGIN'],
    ['con BYPASSRLS', 'ALTER ROLE kuota_maintenance BYPASSRLS', 'atributos elevados'],
    ['miembro de kuota_app', 'GRANT kuota_app TO kuota_maintenance', 'miembro de kuota_app'],
  ] as const) {
    it(`rol de mantenimiento ${name}: bloquea antes de migrar`, async () => {
      const db = await database();
      await onlyFoundation(db);
      const superuser = await connect(db.superuserUrl);
      await superuser.query(setup);
      const before = await snapshot(superuser);
      const result = await migrationPreflight(await connect(db.migratorUrl));
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toContain(expected);
      expect(await snapshot(superuser)).toBe(before);
    }, 180_000);
  }

  it('una migración registrada como fallida bloquea y pide un procedimiento aprobado (sin migrate resolve)', async () => {
    const db = await database(true);
    const migrator = await connect(db.migratorUrl);
    // Simulación en la base efímera: fila de historial sin finished_at (lo que deja un deploy fallido).
    await migrator.query(
      `INSERT INTO public._prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, repeat('0', 64), '0003_simulada_fallida', now(), 0)`,
    );
    const result = await migrationPreflight(migrator);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('0003_simulada_fallida está registrada como fallida');
    expect(result.problems.join(' ')).toContain('no usar migrate resolve');
  }, 180_000);

  it('sin permisos para consultar el historial (credencial de runtime): error de acceso, exit 2', async () => {
    const db = await database(true);
    const app = await connect(db.appUrl);
    const error = await rejection(migrationPreflight(app));
    expect(error).toBeInstanceOf(PreflightAccessError);
    expect((error as Error).message).toContain('sin permisos');
    const run = await cli({ DATABASE_URL_MIGRATOR: db.appUrl });
    expect(run.code).toBe(2);
    expect(run.out).not.toContain(new URL(db.appUrl).password);
  }, 180_000);

  it('error de conexión o sin URL: exit 2 sin imprimir la cadena de conexión', async () => {
    const unreachable = 'postgresql://kuota_migrator:ficticio-no-imprimir@127.0.0.1:9/kuota';
    const run = await cli({ DATABASE_URL_MIGRATOR: unreachable });
    expect(run.code).toBe(2);
    expect(run.out).toContain('no se pudo conectar');
    expect(run.out).not.toContain('ficticio-no-imprimir');
    expect(run.out).not.toContain('postgresql://');
    expect((await cli({})).code).toBe(2);
  });
});

describe('make up ejecuta el preflight antes de migrar y se detiene si falla', () => {
  it('en scripts/dev/up.sh el preflight va después de PostgreSQL sano y antes de prisma migrate deploy, con die', () => {
    const upSh = readFileSync(join(REPO_ROOT, 'scripts/dev/up.sh'), 'utf8');
    const postgres = upSh.indexOf('kuota_compose up -d --wait');
    const preflight = upSh.indexOf('scripts/migration-preflight.ts');
    const deploy = upSh.indexOf('prisma migrate deploy)');
    expect(postgres).toBeGreaterThan(0);
    expect(preflight).toBeGreaterThan(postgres);
    expect(deploy).toBeGreaterThan(preflight);
    expect(upSh.slice(preflight, deploy)).toMatch(/\|\|\s*\n\s*die /);
    expect(upSh).toMatch(/set -euo pipefail/);
  });
});
