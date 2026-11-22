import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * PostgreSQL efímero para pruebas de integración (T011, research R-18).
 *
 * - Usa la misma imagen fijada por digest que infra/docker/compose.yaml (se lee de ahí: una sola fuente).
 * - Aplica infra/docker/postgres/init/01-roles.sql con contraseñas aleatorias por ejecución.
 * - Aplica las migraciones SQL de backend/prisma/migrations/<carpeta>/migration.sql en orden, como kuota_migrator.
 *   En G1 no hay migraciones; la herramienta definitiva (Prisma o Kysely) se decide en el spike T014/T015.
 * - Entrega URLs para kuota_app_login (runtime) y kuota_migrator (migraciones).
 */
export interface TestDatabase {
  readonly appUrl: string;
  readonly migratorUrl: string;
  readonly appliedMigrations: readonly string[];
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
const MIGRATIONS_DIR = join(REPO_ROOT, 'backend/prisma/migrations');

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

/** Aplica cada migration.sql en su propia transacción con la URL dada (atómico por migración). */
export async function applyMigrations(url: string): Promise<string[]> {
  const folders = migrationFolders();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const folder of folders) {
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8'));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${folder}`, { cause: error });
      }
    }
  } finally {
    await client.end();
  }
  return folders;
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
    return { appUrl, migratorUrl, appliedMigrations, stop: async () => void (await container.stop()) };
  } catch (error) {
    await container.stop();
    throw error;
  }
}
