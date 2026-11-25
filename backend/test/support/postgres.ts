import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { getContainerRuntimeClient } from 'testcontainers';
import { registerSensitiveValue } from './log-capture.js';

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
  /** kuota_maintenance_login (aprovisionado por 02-maintenance-roles.sql): solo para la purga de idempotencia. */
  readonly maintenanceUrl: string;
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
const MAINTENANCE_ROLES_SQL = join(REPO_ROOT, 'infra/docker/postgres/init/02-maintenance-roles.sql');
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

/** Límite para que Docker confirme que el contenedor terminó tras el SIGKILL (ver `stopAndRemove`). */
export const CONTAINER_EXIT_TIMEOUT_MS = 120_000;

/**
 * Desmontaje sin carrera (research: "Testcontainers: 409 en el desmontaje"). `container.stop()` de testcontainers hace
 * `docker stop -t 0` y, en cuanto Docker responde, `docker rm` sin `force`. Con la VM de Docker saturada, Docker puede
 * responder al `stop` antes de que el proceso haya terminado de verdad (su espera tras el SIGKILL está acotada), y el
 * `rm` falla con 409 "container is running". Aquí se separan los pasos: stop (SIGKILL) → esperar a que Docker
 * confirme `not-running` (acotado; si no llega, error explícito con el estado) → rm con volúmenes. Sin `force`, sin
 * reintentos y sin ocultar errores.
 */
/** Pasos de Docker que necesita el desmontaje (inyectables para probar el orden sin Docker). */
export interface ContainerTeardownSteps {
  readonly id: string;
  /** `docker stop -t 0`, sin eliminar. */
  stop(): Promise<void>;
  /** `docker wait --condition not-running`: resuelve cuando Docker confirma que el proceso terminó. */
  waitNotRunning(): Promise<unknown>;
  /** Estado actual (`running`, `exited`…), solo para el diagnóstico. */
  status(): Promise<string>;
  /** `docker rm -v`, sin `force`. */
  remove(): Promise<void>;
}

export async function teardownContainer(
  steps: ContainerTeardownSteps,
  exitTimeoutMs: number = CONTAINER_EXIT_TIMEOUT_MS,
): Promise<void> {
  await steps.stop();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      steps.status().then(
        (status) =>
          reject(new Error(`El contenedor ${steps.id} sigue en estado ${status} ${exitTimeoutMs} ms después del stop`)),
        (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
      );
    }, exitTimeoutMs);
  });
  try {
    await Promise.race([steps.waitNotRunning(), timeout]);
  } finally {
    clearTimeout(timer);
  }
  await steps.remove();
}

export async function stopAndRemove(
  container: StartedPostgreSqlContainer,
  exitTimeoutMs: number = CONTAINER_EXIT_TIMEOUT_MS,
): Promise<void> {
  const runtime = await getContainerRuntimeClient();
  const handle = runtime.container.getById(container.getId());
  await teardownContainer(
    {
      id: container.getId(),
      stop: async () => void (await container.stop({ remove: false })),
      waitNotRunning: () => handle.wait({ condition: 'not-running' }),
      status: async () => (await handle.inspect()).State.Status,
      remove: () => runtime.container.remove(handle, { removeVolumes: true }),
    },
    exitTimeoutMs,
  );
}

export async function startTestDatabase(options: StartOptions = {}): Promise<TestDatabase> {
  const migratorPassword = randomPassword();
  const appLoginPassword = randomPassword();
  const maintenancePassword = randomPassword();
  const superuserPassword = randomPassword();
  // SC-009 · T102: las contraseñas de la base efímera tampoco pueden aparecer en ningún log de la suite.
  registerSensitiveValue('contraseña de kuota_migrator (base efímera)', migratorPassword);
  registerSensitiveValue('contraseña de kuota_app_login (base efímera)', appLoginPassword);
  registerSensitiveValue('contraseña de kuota_maintenance_login (base efímera)', maintenancePassword);
  registerSensitiveValue('contraseña del superusuario (base efímera)', superuserPassword);
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(postgresImage())
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword(superuserPassword)
    .withEnvironment({
      KUOTA_MIGRATOR_PASSWORD: migratorPassword,
      KUOTA_APP_LOGIN_PASSWORD: appLoginPassword,
      KUOTA_MAINTENANCE_LOGIN_PASSWORD: maintenancePassword,
    })
    .withCopyFilesToContainer([
      { source: ROLES_SQL, target: '/docker-entrypoint-initdb.d/01-roles.sql' },
      { source: MAINTENANCE_ROLES_SQL, target: '/docker-entrypoint-initdb.d/02-maintenance-roles.sql' },
    ])
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const migratorUrl = connectionUrl('kuota_migrator', migratorPassword, host, port);
  const appUrl = connectionUrl('kuota_app_login', appLoginPassword, host, port);
  const maintenanceUrl = connectionUrl('kuota_maintenance_login', maintenancePassword, host, port);

  let stopping: Promise<void> | undefined;
  try {
    const appliedMigrations = options.applyMigrations === false ? [] : await applyMigrations(migratorUrl);
    return {
      appUrl,
      migratorUrl,
      maintenanceUrl,
      appliedMigrations,
      superuserUrl: container.getConnectionUri(),
      // Idempotente, como `container.stop()` de testcontainers: algunas suites detienen la base a mitad de prueba.
      stop: () => (stopping ??= stopAndRemove(container)),
    };
  } catch (error) {
    // El error original (p. ej. de las migraciones) es el principal; un fallo del desmontaje no lo oculta.
    try {
      await stopAndRemove(container);
    } catch (teardownError) {
      throw new AggregateError(
        [error, teardownError],
        'Falló el arranque de la base de prueba y también su desmontaje',
        { cause: teardownError },
      );
    }
    throw error;
  }
}
