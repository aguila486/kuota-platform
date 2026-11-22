import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * PostgreSQL efímero para pruebas de integración (T011, research R-18).
 *
 * - Usa la misma imagen fijada por digest que infra/docker/compose.yaml (se lee de ahí: una sola fuente).
 * - Aplica infra/docker/postgres/init/01-roles.sql con contraseñas aleatorias por ejecución.
 * - Aplica las migraciones con el mecanismo real del proyecto, `prisma migrate deploy` (ADR-0004, aceptado con
 *   condiciones), como kuota_migrator. Cada migración controla su propia transacción (condición P1).
 * - Entrega URLs para kuota_app_login (runtime) y kuota_migrator (migraciones).
 */
export interface TestDatabase {
  readonly appUrl: string;
  readonly migratorUrl: string;
  readonly appliedMigrations: readonly string[];
  /** Superusuario del contenedor efímero: solo para preparar escenarios de prueba (nunca lo usa la aplicación). */
  readonly superuserUrl: string;
  stop(): Promise<void>;
}

const DATABASE = 'kuota';

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('No se encontró la raíz del repositorio (pnpm-workspace.yaml)');
    dir = parent;
  }
  return dir;
}

const REPO_ROOT = findRepoRoot(process.cwd());
const COMPOSE_FILE = join(REPO_ROOT, 'infra/docker/compose.yaml');
const ROLES_SQL = join(REPO_ROOT, 'infra/docker/postgres/init/01-roles.sql');
const BACKEND_DIR = join(REPO_ROOT, 'backend');
const MIGRATIONS_DIR = join(BACKEND_DIR, 'prisma/migrations');
const PRISMA_BIN = join(BACKEND_DIR, 'node_modules/.bin/prisma');

/** Imagen `postgres:18@sha256:…` declarada en compose.yaml. */
export function postgresImage(): string {
  const match = /^\s*image:\s*(postgres:18@sha256:[0-9a-f]{64})\s*$/m.exec(readFileSync(COMPOSE_FILE, 'utf8'));
  if (!match?.[1]) throw new Error(`compose.yaml no declara postgres:18 fijado por digest (${COMPOSE_FILE})`);
  return match[1];
}

function randomPassword(): string {
  return randomBytes(18).toString('base64url');
}

function connectionUrl(user: string, password: string, host: string, port: number): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${DATABASE}`;
}

/** Carpetas de migración en orden de aplicación. */
export function migrationFolders(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

/** Error de `prisma migrate deploy`, con su código de salida y su salida para diagnóstico. */
export class MigrateDeployError extends Error {
  constructor(
    readonly exitCode: number,
    readonly output: string,
  ) {
    super(`prisma migrate deploy falló (exit ${exitCode})`);
  }
}

/**
 * Ejecuta `prisma migrate deploy` contra la URL dada y devuelve las migraciones registradas como terminadas en
 * `_prisma_migrations`. `migrationsDir` permite usar una copia temporal (p. ej. para inyectar fallos).
 */
export async function applyMigrations(url: string, migrationsDir: string = MIGRATIONS_DIR): Promise<string[]> {
  try {
    await promisify(execFile)(PRISMA_BIN, ['migrate', 'deploy'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL_MIGRATOR: url, KUOTA_PRISMA_MIGRATIONS_DIR: migrationsDir },
      timeout: 120_000,
    });
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    throw new MigrateDeployError(typeof e.code === 'number' ? e.code : 1, `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const rows = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
    );
    return rows.rows.map((r) => r.migration_name);
  } finally {
    await client.end();
  }
}

export interface StartOptions {
  /** false: deja la base sin migrar (p. ej. para probar migraciones con roles distintos). */
  readonly applyMigrations?: boolean;
}

export async function startTestDatabase(options: StartOptions = {}): Promise<TestDatabase> {
  const migratorPassword = randomPassword();
  const appLoginPassword = randomPassword();
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(postgresImage())
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword(randomPassword())
    .withEnvironment({ KUOTA_MIGRATOR_PASSWORD: migratorPassword, KUOTA_APP_LOGIN_PASSWORD: appLoginPassword })
    .withCopyFilesToContainer([{ source: ROLES_SQL, target: '/docker-entrypoint-initdb.d/01-roles.sql' }])
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const migratorUrl = connectionUrl('kuota_migrator', migratorPassword, host, port);
  const appUrl = connectionUrl('kuota_app_login', appLoginPassword, host, port);

  try {
    const appliedMigrations = options.applyMigrations === false ? [] : await applyMigrations(migratorUrl);
    return {
      appUrl,
      migratorUrl,
      appliedMigrations,
      superuserUrl: container.getConnectionUri(),
      stop: async () => void (await container.stop()),
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}
