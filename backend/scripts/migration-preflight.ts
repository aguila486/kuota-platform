/**
 * Preflight de migraciones (cierre de US6, 2026-11-23): impide que `make up` intente aplicar una migración cuyos
 * prerrequisitos de plataforma faltan. Una migración fallida queda registrada en `_prisma_migrations` y bloquea
 * despliegues posteriores, y la gobernanza no permite resolverla con `migrate resolve` sin aprobación.
 *
 * SOLO LEE el catálogo y el historial: no crea roles, no concede privilegios, no toca tablas ni el historial, no
 * ejecuta scripts privilegiados y no imprime contraseñas ni cadenas de conexión.
 *
 * 1. Lee el historial (`public._prisma_migrations`). Si no existe, la base es nueva (sin migraciones). Una migración
 *    registrada como fallida bloquea: requiere un procedimiento aprobado.
 * 2. Calcula las migraciones pendientes comparando las carpetas de `prisma/migrations` con el historial.
 * 3. Para cada pendiente con prerrequisitos (`MIGRATION_PREREQUISITES`), los verifica. Hoy:
 *    `0002_idempotency_maintenance` exige que exista `kuota_maintenance` con atributos mínimos. NO exige el login de
 *    mantenimiento: ese es prerrequisito de la purga, no de la migración.
 *
 * Uso: `DATABASE_URL_MIGRATOR=… pnpm --filter backend db:migrate:preflight` (lo ejecuta `scripts/dev/up.sh`).
 * Salida: 0 se puede migrar; 1 prerrequisitos incumplidos; 2 sin conexión o sin permisos para consultar.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

export interface Queryable {
  query<R extends object>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface PreflightResult {
  /** `true` si se puede ejecutar `prisma migrate deploy`. */
  readonly ok: boolean;
  /** Base sin historial de migraciones (volumen nuevo o base vacía). */
  readonly newDatabase: boolean;
  readonly pending: readonly string[];
  /** Prerrequisitos incumplidos, con la acción administrativa requerida. */
  readonly problems: readonly string[];
}

/** No se pudo consultar el catálogo o el historial (conexión o permisos). */
export class PreflightAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightAccessError';
  }
}

const PROVISIONING_SCRIPT = 'infra/docker/postgres/init/02-maintenance-roles.sql';

/** Prerrequisito de 0002: rol de privilegios `kuota_maintenance` existente y de mínimo privilegio (sin login). */
async function maintenanceRoleProblems(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{
    exists: boolean;
    login: boolean | null;
    elevated: boolean | null;
    member_of_runtime: boolean | null;
    database: string;
  }>(
    `SELECT r.oid IS NOT NULL AS exists, r.rolcanlogin AS login,
            (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication) AS elevated,
            CASE WHEN r.oid IS NULL THEN NULL
                 ELSE pg_has_role(r.oid, 'kuota_app', 'MEMBER') OR pg_has_role(r.oid, 'kuota_migrator', 'MEMBER') END
              AS member_of_runtime,
            current_database() AS database
       FROM (SELECT 1) AS one LEFT JOIN pg_roles r ON r.rolname = 'kuota_maintenance'`,
  );
  const role = rows[0]!;
  const action = `Acción (administrador del clúster, con revisión): psql -U postgres -d ${role.database} -v ON_ERROR_STOP=1 -f ${PROVISIONING_SCRIPT}`;
  if (!role.exists) {
    return [
      `0002_idempotency_maintenance requiere el rol kuota_maintenance y no existe (aprovisionamiento de plataforma pendiente). ${action}`,
    ];
  }
  const problems: string[] = [];
  if (role.login) problems.push('kuota_maintenance tiene LOGIN: debe ser un rol de privilegios (NOLOGIN)');
  if (role.elevated)
    problems.push(
      'kuota_maintenance tiene atributos elevados (superusuario, omisión de RLS, CREATEROLE, CREATEDB o REPLICATION)',
    );
  if (role.member_of_runtime) problems.push('kuota_maintenance es miembro de kuota_app o de kuota_migrator');
  return problems.map(
    (p) => `0002_idempotency_maintenance: ${p}. Corrige el rol (revisión de plataforma) antes de migrar`,
  );
}

/** Prerrequisitos por migración pendiente. Una migración futura con requisitos de plataforma se registra aquí. */
export const MIGRATION_PREREQUISITES: Readonly<Record<string, (db: Queryable) => Promise<string[]>>> = {
  '0002_idempotency_maintenance': maintenanceRoleProblems,
};

/** Carpeta de migraciones relativa a `backend/` (desde donde lo ejecutan `up.sh` y el script de pnpm). */
export const DEFAULT_MIGRATIONS_DIR = resolve(process.cwd(), 'prisma', 'migrations');

export function migrationFolders(dir: string): string[] {
  if (!existsSync(dir))
    throw new PreflightAccessError(`no existe la carpeta de migraciones (${dir}): ejecutar desde backend/`);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

export async function migrationPreflight(
  db: Queryable,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): Promise<PreflightResult> {
  const folders = migrationFolders(migrationsDir);
  let history: Array<{ name: string; finished: boolean; rolled_back: boolean }> = [];
  let newDatabase = true;
  try {
    const { rows } = await db.query<{ present: boolean }>(
      "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present",
    );
    if (rows[0]?.present) {
      history = (
        await db.query<{ name: string; finished: boolean; rolled_back: boolean }>(
          `SELECT migration_name AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
             FROM public._prisma_migrations`,
        )
      ).rows;
      newDatabase = history.length === 0;
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new PreflightAccessError(
      code === '42501'
        ? 'sin permisos para consultar el historial de migraciones: ejecuta el preflight con la identidad de migración'
        : `no se pudo consultar el historial de migraciones (${code ?? 'error'})`,
    );
  }

  const problems: string[] = [];
  for (const failed of history.filter((h) => !h.finished && !h.rolled_back)) {
    problems.push(
      `la migración ${failed.name} está registrada como fallida: Prisma no aplicará más migraciones. Requiere un procedimiento de recuperación aprobado (no usar migrate resolve sin aprobación)`,
    );
  }
  const applied = new Set(history.filter((h) => h.finished).map((h) => h.name));
  const pending = folders.filter((name) => !applied.has(name));
  for (const name of pending) {
    const check = MIGRATION_PREREQUISITES[name];
    if (check) problems.push(...(await check(db)));
  }
  return { ok: problems.length === 0, newDatabase, pending, problems };
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL_MIGRATOR'];
  if (!url) {
    process.stderr.write('migration-preflight: define DATABASE_URL_MIGRATOR\n');
    process.exit(2);
  }
  const client = new Client({ connectionString: url, application_name: 'kuota-migration-preflight' });
  try {
    await client.connect().catch((error: { code?: string }) => {
      throw new PreflightAccessError(`no se pudo conectar a PostgreSQL (${error.code ?? 'error'})`);
    });
    const result = await migrationPreflight(client);
    const state = result.newDatabase ? 'base sin historial de migraciones' : 'base con historial de migraciones';
    const pending = result.pending.length > 0 ? result.pending.join(', ') : 'ninguna';
    if (result.ok) {
      process.stdout.write(`migration-preflight: ${state}; pendientes: ${pending}; prerrequisitos cumplidos\n`);
    } else {
      process.stderr.write(`migration-preflight: ${state}; pendientes: ${pending}. NO se migra:\n`);
      for (const problem of result.problems) process.stderr.write(`  ✗ ${problem}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof PreflightAccessError ? error.message : `falló (${(error as Error).name})`;
    process.stderr.write(`migration-preflight: ${message}\n`);
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Entrada directa con `node scripts/migration-preflight.ts`; al importarlo (pruebas), no se ejecuta.
if (process.argv[1]?.endsWith('migration-preflight.ts')) void main();
