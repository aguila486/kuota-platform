/**
 * SPIKE T014 — Prisma 7 + @prisma/adapter-pg + PostgreSQL 18 RLS (ADR-0004 §Validación, criterios S1–S8).
 *
 * Ejecución: `pnpm --filter backend spike:rls` (requiere Docker). Cada criterio produce evidencia medida y un
 * veredicto PASS/FAIL/NOT RUN; al final se imprime la tabla y la decisión según la regla de ADR-0004.
 *
 * EXPERIMENTAL: `withTenant` de este archivo es la implementación de prueba del spike, no el componente de producción
 * (T039). La decisión Prisma/Kysely la toma el responsable en T015.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { startTestDatabase, type TestDatabase } from '../test/support/postgres.js';

// --------------------------------------------------------------------------------------------------------------------
// Configuración fija y reproducible (ADR-0004 §Validación)
// --------------------------------------------------------------------------------------------------------------------
const SEED = 20261122;
const REPETITIONS = 20;
const POOL_SIZES = [2, 3, 4, 5] as const;
const REQUESTS_PER_REPETITION = 100; // 50 por tenant, intercaladas
const MAX_JITTER_MS = 15;
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;
const MIN_SWITCHES_ON_SAME_BACKEND = 10;
const LATENCY_ITERATIONS = 500;
const BACKEND_DIR = resolve(__dirname, '..');
const PRISMA_BIN = join(BACKEND_DIR, 'node_modules/.bin/prisma');
const MIGRATIONS_DIR = join(BACKEND_DIR, 'prisma/migrations');

type Verdict = 'PASS' | 'FAIL' | 'NOT RUN';
interface CriterionResult {
  readonly id: string;
  readonly verdict: Verdict;
  readonly gate: string;
  readonly evidence: Record<string, unknown>;
}
const results = new Map<string, CriterionResult>();
function record(id: string, verdict: Verdict, gate: string, evidence: Record<string, unknown>): void {
  results.set(id, { id, verdict, gate, evidence });
}

/** PRNG determinista (mulberry32) para retardos e intercalado reproducibles. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SQLSTATE de un error de Prisma/pg, buscándolo en el error, su causa y sus metadatos. */
function sqlState(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | undefined => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    for (const key of ['originalCode', 'code']) {
      const v = obj[key];
      if (typeof v === 'string' && /^[0-9A-Z]{5}$/.test(v) && !v.startsWith('P2')) return v;
    }
    for (const key of ['cause', 'meta', 'driverAdapterError']) {
      const found = visit(obj[key]);
      if (found) return found;
    }
    return undefined;
  };
  return visit(error) ?? /\b(42501|P0001|22P02|23514|23502|42P01)\b/.exec(String(error))?.[1];
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)]!.toFixed(3));
}

// --------------------------------------------------------------------------------------------------------------------
// withTenant EXPERIMENTAL (semántica de ADR-0002 C2-1): transacción interactiva, set_config local como primera
// sentencia, cliente transaccional propagado por AsyncLocalStorage, anidamiento reentrante del mismo tenant.
// --------------------------------------------------------------------------------------------------------------------
type Tx = Prisma.TransactionClient;
interface TenantStore {
  readonly tx: Tx;
  readonly tenantId: string;
  readonly backendPid: number;
  readonly settingBefore: string | null;
}
class TenantContextMismatch extends Error {
  constructor(active: string, requested: string) {
    super(`withTenant anidado con otro tenant (activo ${active}, pedido ${requested})`);
  }
}
const tenantStore = new AsyncLocalStorage<TenantStore>();

async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Tx, store: TenantStore) => Promise<T>,
): Promise<T> {
  const active = tenantStore.getStore();
  if (active) {
    if (active.tenantId !== tenantId) throw new TenantContextMismatch(active.tenantId, tenantId);
    return fn(active.tx, active);
  }
  return prisma.$transaction(async (tx) => {
    // Instrumentación del spike: valor del contexto ANTES de fijarlo (detecta fugas entre transacciones) y backend.
    const [probe] = await tx.$queryRaw<{ before: string | null; pid: number }[]>`
      SELECT current_setting('app.tenant_id', true) AS before, pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true),
                              set_config('app.actor_id', ${'dev:spike'}, true),
                              set_config('app.correlation_id', ${randomUUID()}, true)`;
    const store: TenantStore = { tx, tenantId, backendPid: Number(probe!.pid), settingBefore: probe!.before };
    return tenantStore.run(store, () => fn(tx, store));
  }, TRANSACTION_OPTIONS);
}

function makeClient(url: string, max: number): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString: url, max });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), transactionOptions: TRANSACTION_OPTIONS });
  return { prisma, pool };
}

async function prismaCli(args: string[], env: Record<string, string>): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(PRISMA_BIN, args, {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...env },
      timeout: 120_000,
    });
    return { code: 0, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` };
  }
}

async function sql<T extends Record<string, unknown>>(url: string, text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

// --------------------------------------------------------------------------------------------------------------------
describe('SPIKE T014 — Prisma 7 + RLS (ADR-0004)', () => {
  let db: TestDatabase;
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase({ applyMigrations: false });
  });

  afterAll(async () => {
    await db?.stop();
    printReport();
  });

  // ------------------------------------------------------------------------------------------------------------------
  // S6 primero: la base de todos los demás criterios se migra con el mecanismo real `prisma migrate deploy`.
  // ------------------------------------------------------------------------------------------------------------------
  describe('S6 — Roles y migraciones (prisma migrate deploy)', () => {
    it('S6: solo kuota_migrator migra; historial correcto; idempotente; fallos sin efectos parciales', async () => {
      const evidence: Record<string, unknown> = {};

      // 5 + 6: el rol de runtime no puede migrar y no deja nada.
      const asApp = await prismaCli(['migrate', 'deploy'], { DATABASE_URL_MIGRATOR: db.appUrl });
      const afterApp = await sql<{ kuota: string | null; hist_public: string | null; hist_kuota: string | null }>(
        db.superuserUrl,
        "SELECT to_regnamespace('kuota')::text AS kuota, to_regclass('public._prisma_migrations')::text AS hist_public, to_regclass('kuota._prisma_migrations')::text AS hist_kuota",
      );
      evidence['runtimeRole'] = {
        exitCode: asApp.code,
        error: /P\d{4}|permission denied[^\n]*/.exec(asApp.output)?.[0] ?? asApp.output.slice(0, 200),
        objectsLeft: afterApp[0],
      };
      const runtimeRejected =
        asApp.code !== 0 &&
        afterApp[0]?.kuota === null &&
        afterApp[0]?.hist_public === null &&
        afterApp[0]?.hist_kuota === null;

      // 1 + 2 + 3 + 7: aplicación real con el migrador, historial y nombre de carpeta.
      const deploy = await prismaCli(['migrate', 'deploy'], { DATABASE_URL_MIGRATOR: db.migratorUrl });
      const historyTable = (
        await sql<{ public_t: string | null; kuota_t: string | null }>(
          db.migratorUrl,
          "SELECT to_regclass('public._prisma_migrations')::text AS public_t, to_regclass('kuota._prisma_migrations')::text AS kuota_t",
        )
      )[0];
      const historyName = historyTable?.kuota_t ?? historyTable?.public_t ?? null;
      const history = historyName
        ? await sql<{ migration_name: string; finished: boolean; rolled_back: boolean; steps: number }>(
            db.migratorUrl,
            `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back,
                    applied_steps_count AS steps FROM ${historyName} ORDER BY started_at`,
          )
        : [];
      const objects = (
        await sql<{ tables: string; forced: string; policies: string; triggers: string }>(
          db.migratorUrl,
          `SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'kuota' AND tablename <> '_prisma_migrations') AS tables,
                  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'kuota' AND c.relforcerowsecurity) AS forced,
                  (SELECT count(*) FROM pg_policies WHERE schemaname = 'kuota') AS policies,
                  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'kuota' AND NOT t.tgisinternal) AS triggers`,
        )
      )[0];
      evidence['deploy'] = { exitCode: deploy.code, historyTable: historyName, history, objects };
      const applied =
        deploy.code === 0 &&
        history.length === 1 &&
        history[0]?.migration_name === '0001_foundation' &&
        history[0]?.finished === true &&
        objects?.tables === '3' &&
        objects?.forced === '3' &&
        objects?.policies === '3' &&
        objects?.triggers === '2';

      // 4: segunda ejecución sin efectos duplicados.
      const redeploy = await prismaCli(['migrate', 'deploy'], { DATABASE_URL_MIGRATOR: db.migratorUrl });
      const historyAfter = historyName
        ? await sql<{ n: string }>(db.migratorUrl, `SELECT count(*) AS n FROM ${historyName}`)
        : [];
      evidence['redeploy'] = {
        exitCode: redeploy.code,
        message: /No pending migrations to apply\.?/.exec(redeploy.output)?.[0] ?? redeploy.output.slice(0, 200),
        historyRows: historyAfter[0]?.n,
      };
      const idempotent = redeploy.code === 0 && historyAfter[0]?.n === '1';

      // 6 + 8: semántica transaccional real ante un error, en bases aparte con copias temporales de migraciones.
      // Variante A: SQL sin BEGIN/COMMIT (como 0001). Variante B: el SQL controla su transacción explícitamente.
      const failureVariant = async (label: string, body: string): Promise<Record<string, unknown>> => {
        const failDb = await startTestDatabase({ applyMigrations: false });
        const tempMigrations = mkdtempSync(join(tmpdir(), 'kuota-spike-migrations-'));
        try {
          cpSync(MIGRATIONS_DIR, tempMigrations, { recursive: true });
          const failingDir = join(tempMigrations, '0002_spike_failure');
          cpSync(join(MIGRATIONS_DIR, '0001_foundation'), failingDir, { recursive: true });
          writeFileSync(join(failingDir, 'migration.sql'), body);
          const env = { DATABASE_URL_MIGRATOR: failDb.migratorUrl, KUOTA_PRISMA_MIGRATIONS_DIR: tempMigrations };
          const failing = await prismaCli(['migrate', 'deploy'], env);
          const failHistoryName = (
            await sql<{ t: string | null }>(
              failDb.migratorUrl,
              "SELECT coalesce(to_regclass('kuota._prisma_migrations'), to_regclass('public._prisma_migrations'))::text AS t",
            )
          )[0]?.t;
          const failState = await sql<{ migration_name: string; finished: boolean; has_logs: boolean }>(
            failDb.migratorUrl,
            `SELECT migration_name, finished_at IS NOT NULL AS finished, logs IS NOT NULL AS has_logs FROM ${failHistoryName} ORDER BY started_at`,
          );
          const partial = await sql<{ t: string | null }>(
            failDb.migratorUrl,
            "SELECT to_regclass('kuota.spike_partial')::text AS t",
          );
          const blocked = await prismaCli(['migrate', 'deploy'], env);
          return {
            variant: label,
            exitCode: failing.code,
            history: failState,
            partialTableLeft: partial[0]?.t ?? null,
            nextDeploy: {
              exitCode: blocked.code,
              error: /P3009|P\d{4}/.exec(blocked.output)?.[0] ?? blocked.output.slice(0, 200),
            },
          };
        } finally {
          rmSync(tempMigrations, { recursive: true, force: true });
          await failDb.stop();
        }
      };
      const implicitTx = await failureVariant(
        'sin BEGIN/COMMIT',
        'CREATE TABLE kuota.spike_partial (id integer);\nSELECT 1 / 0;\n',
      );
      const explicitTx = await failureVariant(
        'con BEGIN/COMMIT explícitos',
        'BEGIN;\nCREATE TABLE kuota.spike_partial (id integer);\nSELECT 1 / 0;\nCOMMIT;\n',
      );

      // S6 con su criterio ORIGINAL de ADR-0004: migrate deploy funciona con kuota_migrator y falla con kuota_app_login.
      record('S6', runtimeRejected && applied ? 'PASS' : 'FAIL', 'Sí', evidence);
      // Verificaciones adicionales pedidas por el responsable (sección 5); no redefinen S6.
      record(
        'MIG-IDEMPOTENT',
        idempotent ? 'PASS' : 'FAIL',
        'Adicional',
        evidence['redeploy'] as Record<string, unknown>,
      );
      record('MIG-TX', implicitTx['partialTableLeft'] === null ? 'PASS' : 'FAIL', 'Adicional', implicitTx);
      record('MIG-TX-EXPLICIT', explicitTx['partialTableLeft'] === null ? 'PASS' : 'FAIL', 'Adicional', explicitTx);
      expect(evidence).toBeDefined();
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('Criterios de runtime (S1–S5, S7, S8)', () => {
    beforeAll(async () => {
      // Datos base: 3 filas por tenant en cada tabla de tenant, escritas por el runtime con su contexto.
      const { prisma, pool } = makeClient(db.appUrl, 2);
      try {
        for (const tenant of [TENANT_A, TENANT_B]) {
          await withTenant(prisma, tenant, async (tx) => {
            for (let i = 0; i < 3; i += 1) {
              await tx.dev_probe_items.create({ data: { label: `${tenant}:seed:${i}` } });
              await tx.idempotency_keys.create({
                data: {
                  key: `seed-key-${i}-${tenant.slice(0, 8)}`,
                  request_hash: 'c'.repeat(64),
                  method: 'POST',
                  path: '/seed',
                  status: 'IN_PROGRESS',
                },
              });
              await tx.audit_events.create({
                data: {
                  actor_id: 'dev:spike',
                  correlation_id: randomUUID(),
                  actor_type: 'DEV',
                  action: 'dev_probe.created',
                  entity_type: 'dev_probe',
                  entity_id: `seed-${i}`,
                  origin: 'spike',
                },
              });
            }
          });
        }
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });

    it('S1: contexto ausente → 0 filas sin error, en conexión nueva y en conexión reutilizada', async () => {
      const evidence: Record<string, unknown> = {};
      const fresh = makeClient(db.appUrl, 1);
      try {
        evidence['freshConnection'] = {
          dev_probe_items: await fresh.prisma.dev_probe_items.count(),
          idempotency_keys: await fresh.prisma.idempotency_keys.count(),
          audit_events: await fresh.prisma.audit_events.count(),
        };
      } finally {
        await fresh.prisma.$disconnect();
        await fresh.pool.end();
      }
      const reused = makeClient(db.appUrl, 1); // pool = 1: la consulta posterior usa el MISMO backend
      try {
        const inTx = await withTenant(reused.prisma, TENANT_A, async (tx, store) => ({
          pid: store.backendPid,
          rows: await tx.dev_probe_items.count(),
        }));
        const [after] = await reused.prisma.$queryRaw<{ pid: number; setting: string | null }[]>`
          SELECT pg_backend_pid() AS pid, current_setting('app.tenant_id', true) AS setting`;
        evidence['reusedConnection'] = {
          withTenantPid: inTx.pid,
          rowsInsideWithTenant: inTx.rows,
          afterPid: Number(after!.pid),
          settingAfter: after!.setting,
          dev_probe_items: await reused.prisma.dev_probe_items.count(),
          idempotency_keys: await reused.prisma.idempotency_keys.count(),
          audit_events: await reused.prisma.audit_events.count(),
        };
      } finally {
        await reused.prisma.$disconnect();
        await reused.pool.end();
      }
      const f = evidence['freshConnection'] as Record<string, number>;
      const r = evidence['reusedConnection'] as Record<string, unknown>;
      const pass =
        Object.values(f).every((n) => n === 0) &&
        r['withTenantPid'] === r['afterPid'] &&
        r['rowsInsideWithTenant'] === 3 &&
        r['settingAfter'] === '' &&
        r['dev_probe_items'] === 0 &&
        r['idempotency_keys'] === 0 &&
        r['audit_events'] === 0;
      record('S1', pass ? 'PASS' : 'FAIL', 'Sí', evidence);
    });

    it(`S2: ${REPETITIONS} repeticiones × ${REQUESTS_PER_REPETITION} solicitudes de 2 tenants, pool 2–5`, async () => {
      const random = prng(SEED);
      let crossRows = 0;
      let leakedContexts = 0;
      let switchesOnSameBackend = 0;
      let totalRequests = 0;
      const perRepetition: Record<string, unknown>[] = [];
      for (let rep = 0; rep < REPETITIONS; rep += 1) {
        const poolSize = POOL_SIZES[rep % POOL_SIZES.length]!;
        const { prisma, pool } = makeClient(db.appUrl, poolSize);
        const order = Array.from({ length: REQUESTS_PER_REPETITION }, (_, i) => (i % 2 === 0 ? TENANT_A : TENANT_B));
        for (let i = order.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        const delays = order.map(() => Math.floor(random() * (MAX_JITTER_MS + 1)));
        const completions: { pid: number; tenant: string; seq: number }[] = [];
        let seq = 0;
        try {
          const outcomes = await Promise.all(
            order.map((tenant, i) =>
              withTenant(prisma, tenant, async (tx, store) => {
                await tx.dev_probe_items.create({ data: { label: `${tenant}:r${rep}:${i}` } });
                await tx.$executeRaw`SELECT pg_sleep(${delays[i]! / 1000})`;
                const visible = await tx.dev_probe_items.findMany({ select: { tenant_id: true, label: true } });
                completions.push({ pid: store.backendPid, tenant, seq: (seq += 1) });
                return {
                  cross: visible.filter((row) => row.tenant_id !== tenant || !row.label.startsWith(tenant)).length,
                  leaked: store.settingBefore !== null && store.settingBefore !== '',
                };
              }),
            ),
          );
          const repCross = outcomes.reduce((n, o) => n + o.cross, 0);
          const repLeaks = outcomes.filter((o) => o.leaked).length;
          const byPid = new Map<number, string[]>();
          for (const c of completions.sort((a, b) => a.seq - b.seq))
            byPid.set(c.pid, [...(byPid.get(c.pid) ?? []), c.tenant]);
          let repSwitches = 0;
          for (const tenants of byPid.values())
            for (let k = 1; k < tenants.length; k += 1) if (tenants[k] !== tenants[k - 1]) repSwitches += 1;
          crossRows += repCross;
          leakedContexts += repLeaks;
          switchesOnSameBackend += repSwitches;
          totalRequests += outcomes.length;
          perRepetition.push({
            rep,
            poolSize,
            backends: byPid.size,
            crossRows: repCross,
            leaks: repLeaks,
            switches: repSwitches,
          });
        } finally {
          await prisma.$disconnect();
          await pool.end();
        }
      }
      const pass = crossRows === 0 && leakedContexts === 0 && switchesOnSameBackend >= MIN_SWITCHES_ON_SAME_BACKEND;
      record('S2', pass ? 'PASS' : 'FAIL', 'Sí', {
        seed: SEED,
        totalRequests,
        crossRows,
        leakedContexts,
        switchesOnSameBackend,
        minimumRequired: MIN_SWITCHES_ON_SAME_BACKEND,
        perRepetition,
      });
    });

    it('S3: privilegios del runtime (sin UPDATE/DELETE en auditoría, sin DDL) y WITH CHECK en INSERT', async () => {
      const { prisma, pool } = makeClient(db.appUrl, 2);
      try {
        const checks = {
          updateAudit: sqlState(
            await captureError(
              withTenant(prisma, TENANT_A, (tx) => tx.$executeRaw`UPDATE kuota.audit_events SET action = 'x'`),
            ),
          ),
          deleteAudit: sqlState(
            await captureError(withTenant(prisma, TENANT_A, (tx) => tx.$executeRaw`DELETE FROM kuota.audit_events`)),
          ),
          alterTable: sqlState(
            await captureError(
              prisma.$executeRawUnsafe('ALTER TABLE kuota.dev_probe_items DISABLE ROW LEVEL SECURITY'),
            ),
          ),
          createTable: sqlState(
            await captureError(prisma.$executeRawUnsafe('CREATE TABLE kuota.spike_x (id integer)')),
          ),
          insertOtherTenant: sqlState(
            await captureError(
              withTenant(prisma, TENANT_A, (tx) =>
                tx.dev_probe_items.create({ data: { label: 'inyectada', tenant_id: TENANT_B } }),
              ),
            ),
          ),
          updateAuditViaModel: sqlState(
            await captureError(
              withTenant(prisma, TENANT_A, (tx) => tx.audit_events.updateMany({ data: { action: 'x' } })),
            ),
          ),
        };
        const pass = Object.values(checks).every((code) => code === '42501');
        record('S3', pass ? 'PASS' : 'FAIL', 'Sí', { sqlstateByCheck: checks, expected: '42501' });
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });

    it('S4: excepción dentro de withTenant → ROLLBACK y conexión limpia en el mismo backend', async () => {
      const { prisma, pool } = makeClient(db.appUrl, 1);
      try {
        const marker = `rollback-${randomUUID()}`;
        let failedPid = -1;
        const thrown = await captureError(
          withTenant(prisma, TENANT_A, async (tx, store) => {
            failedPid = store.backendPid;
            await tx.dev_probe_items.create({ data: { label: marker } });
            throw new Error('fallo simulado del caso de uso');
          }),
        );
        const persisted = await withTenant(prisma, TENANT_A, (tx) =>
          tx.dev_probe_items.count({ where: { label: marker } }),
        );
        // Error de base de datos dentro de la transacción (CHECK) → la conexión sigue utilizable.
        const dbError = sqlState(
          await captureError(withTenant(prisma, TENANT_A, (tx) => tx.dev_probe_items.create({ data: { label: '' } }))),
        );
        const [after] = await prisma.$queryRaw<{ pid: number; setting: string | null }[]>`
          SELECT pg_backend_pid() AS pid, current_setting('app.tenant_id', true) AS setting`;
        const rowsWithoutContext = await prisma.dev_probe_items.count();
        const evidence = {
          applicationErrorPropagated: thrown instanceof Error && thrown.message === 'fallo simulado del caso de uso',
          rowPersistedAfterRollback: persisted,
          databaseErrorSqlstate: dbError,
          failedTxPid: failedPid,
          nextQueryPid: Number(after!.pid),
          settingAfter: after!.setting,
          rowsWithoutContext,
        };
        const pass =
          evidence.applicationErrorPropagated &&
          persisted === 0 &&
          dbError === '23514' &&
          evidence.failedTxPid === evidence.nextQueryPid &&
          evidence.settingAfter === '' &&
          rowsWithoutContext === 0;
        record('S4', pass ? 'PASS' : 'FAIL', 'Sí', evidence);
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });

    it('S5: anidamiento — mismo tenant reutiliza la transacción; otro tenant lanza error y revierte todo', async () => {
      const { prisma, pool } = makeClient(db.appUrl, 2);
      try {
        const sameTenant = await withTenant(prisma, TENANT_A, async (tx) => {
          const [outer] = await tx.$queryRaw<{ txid: bigint }[]>`SELECT txid_current() AS txid`;
          const inner = await withTenant(prisma, TENANT_A, async (innerTx) => {
            const [row] = await innerTx.$queryRaw<{ txid: bigint }[]>`SELECT txid_current() AS txid`;
            return row!.txid;
          });
          return { outer: outer!.txid.toString(), inner: inner.toString() };
        });
        const marker = `nested-${randomUUID()}`;
        const mismatch = await captureError(
          withTenant(prisma, TENANT_A, async (tx) => {
            await tx.dev_probe_items.create({ data: { label: marker } });
            await withTenant(prisma, TENANT_B, () => Promise.resolve(undefined));
          }),
        );
        const persisted = await withTenant(prisma, TENANT_A, (tx) =>
          tx.dev_probe_items.count({ where: { label: marker } }),
        );
        // Riesgo documentado: un set_config crudo dentro de la transacción SÍ cambia el tenant efectivo.
        const rawSwitch = await withTenant(prisma, TENANT_A, async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
          return tx.dev_probe_items.count({ where: { label: { startsWith: TENANT_B } } });
        });
        const evidence = {
          sameTenantTxids: sameTenant,
          mismatchError: mismatch instanceof TenantContextMismatch,
          outerWritePersistedAfterMismatch: persisted,
          rawSetConfigInsideTxSeesOtherTenantRows: rawSwitch,
        };
        const pass = sameTenant.outer === sameTenant.inner && evidence.mismatchError && persisted === 0;
        record('S5', pass ? 'PASS' : 'FAIL', 'Sí', evidence);
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });

    it('S7: SQL crudo ($queryRaw) dentro de withTenant respeta RLS; TypedSQL no evaluado', async () => {
      const { prisma, pool } = makeClient(db.appUrl, 2);
      try {
        const inside = await withTenant(
          prisma,
          TENANT_A,
          (tx) => tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id::text AS tenant_id FROM kuota.dev_probe_items`,
        );
        const outside = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM kuota.dev_probe_items`;
        const unsafe = await withTenant(prisma, TENANT_B, (tx) =>
          tx.$queryRawUnsafe<{ n: bigint }[]>(
            'SELECT count(*) AS n FROM kuota.dev_probe_items WHERE tenant_id = $1',
            TENANT_A,
          ),
        );
        const evidence = {
          rowsInsideForA: inside.length,
          allRowsBelongToA: inside.every((r) => r.tenant_id === TENANT_A),
          rowsOutsideWithTenant: Number(outside[0]!.n),
          tenantBQueryingRowsOfAViaRawUnsafe: Number(unsafe[0]!.n),
          typedSql:
            'NOT RUN: no se propone adoptar TypedSQL en 001 (ADR-0004: S7 es gate de TypedSQL solo si se adopta)',
        };
        const pass =
          inside.length > 0 &&
          evidence.allRowsBelongToA &&
          evidence.rowsOutsideWithTenant === 0 &&
          evidence.tenantBQueryingRowsOfAViaRawUnsafe === 0;
        record('S7', pass ? 'PASS' : 'FAIL', 'Sí ($queryRaw); TypedSQL solo si se adopta', evidence);
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });

    it(`S8: latencia del sobrecosto de transacción + set_config (${LATENCY_ITERATIONS} iteraciones, referencia)`, async () => {
      const { prisma, pool } = makeClient(db.appUrl, 5);
      try {
        const measure = async (fn: () => Promise<unknown>): Promise<number[]> => {
          for (let i = 0; i < 50; i += 1) await fn(); // calentamiento
          const samples: number[] = [];
          for (let i = 0; i < LATENCY_ITERATIONS; i += 1) {
            const start = process.hrtime.bigint();
            await fn();
            samples.push(Number(process.hrtime.bigint() - start) / 1e6);
          }
          return samples.sort((a, b) => a - b);
        };
        const baseline = await measure(() => prisma.dev_probe_items.findFirst({ select: { id: true } }));
        const withContext = await measure(() =>
          withTenant(prisma, TENANT_A, (tx) => tx.dev_probe_items.findFirst({ select: { id: true } })),
        );
        const evidence = {
          iterations: LATENCY_ITERATIONS,
          baselineMs: { p50: percentile(baseline, 50), p95: percentile(baseline, 95) },
          withTenantMs: { p50: percentile(withContext, 50), p95: percentile(withContext, 95) },
          overheadMs: {
            p50: Number((percentile(withContext, 50) - percentile(baseline, 50)).toFixed(3)),
            p95: Number((percentile(withContext, 95) - percentile(baseline, 95)).toFixed(3)),
          },
          note: 'Referencia (no gate). Umbral de reevaluación propuesto p95 > 10 ms, pendiente de aprobación.',
          environment: 'Docker Desktop local, PostgreSQL 18.7, Node 26.13.1',
        };
        record('S8', 'PASS', 'No (referencia)', evidence);
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  // Sección 7 del encargo: capacidades reales de kuota_migrator y herencia para un futuro kuota_worker.
  // ------------------------------------------------------------------------------------------------------------------
  describe('Roles (análisis complementario, no es criterio S)', () => {
    it('kuota_migrator: DDL sí; DML sobre filas de tenant no (FORCE RLS sin política para él)', async () => {
      const client = new Client({ connectionString: db.migratorUrl });
      await client.connect();
      try {
        const run = async (text: string): Promise<string> => {
          await client.query('BEGIN');
          try {
            await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
            const r = await client.query(text);
            return `ok (${r.rowCount ?? 0} filas)`;
          } catch (error) {
            return `error ${sqlState(error) ?? String(error)}`;
          } finally {
            await client.query('ROLLBACK');
          }
        };
        const evidence = {
          ddlCreateTable: await run('CREATE TABLE kuota.spike_ddl (id integer)'),
          ddlAddColumn: await run('ALTER TABLE kuota.dev_probe_items ADD COLUMN spike_col integer'),
          selectWithContext: await run('SELECT * FROM kuota.dev_probe_items'),
          updateWithContext: await run("UPDATE kuota.dev_probe_items SET label = label || ''"),
          insertWithContext: await run("INSERT INTO kuota.dev_probe_items (label) VALUES ('desde migrador')"),
          bypassrls: (
            await client.query<{ b: boolean }>('SELECT rolbypassrls AS b FROM pg_roles WHERE rolname = current_user')
          ).rows[0]?.b,
        };
        record('ROL-MIGRATOR', 'PASS', 'Informativo', evidence);
      } finally {
        await client.end();
      }
    });

    it('kuota_worker (simulado): la membresía INHERIT en kuota_app basta; NOINHERIT no', async () => {
      const workerPassword = randomUUID();
      await sql(
        db.superuserUrl,
        `CREATE ROLE spike_worker_inherit LOGIN NOBYPASSRLS INHERIT IN ROLE kuota_app PASSWORD '${workerPassword}'`,
      );
      await sql(
        db.superuserUrl,
        `CREATE ROLE spike_worker_noinherit LOGIN NOBYPASSRLS NOINHERIT IN ROLE kuota_app PASSWORD '${workerPassword}'`,
      );
      const url = (role: string): string => {
        const u = new URL(db.appUrl);
        u.username = role;
        u.password = workerPassword;
        return u.toString();
      };
      const probe = async (role: string): Promise<Record<string, unknown>> => {
        const { prisma, pool } = makeClient(url(role), 1);
        try {
          return {
            rowsWithContextA: await withTenant(prisma, TENANT_A, (tx) => tx.dev_probe_items.count()).catch(
              (e: unknown) => `error ${sqlState(e)}`,
            ),
            rowsWithoutContext: await prisma.dev_probe_items.count().catch((e: unknown) => `error ${sqlState(e)}`),
            seesOnlyA: await withTenant(prisma, TENANT_A, async (tx) =>
              (await tx.dev_probe_items.findMany({ select: { tenant_id: true } })).every(
                (r) => r.tenant_id === TENANT_A,
              ),
            ).catch((e: unknown) => `error ${sqlState(e)}`),
          };
        } finally {
          await prisma.$disconnect();
          await pool.end();
        }
      };
      const evidence = {
        inherit: await probe('spike_worker_inherit'),
        noinherit: await probe('spike_worker_noinherit'),
      };
      record('ROL-WORKER', 'PASS', 'Informativo', evidence);
    });
  });
});

// --------------------------------------------------------------------------------------------------------------------
function printReport(): void {
  const order = [
    'S1',
    'S2',
    'S3',
    'S4',
    'S5',
    'S6',
    'S7',
    'S8',
    'MIG-IDEMPOTENT',
    'MIG-TX',
    'MIG-TX-EXPLICIT',
    'ROL-MIGRATOR',
    'ROL-WORKER',
  ];
  const verdict = (id: string): Verdict => results.get(id)?.verdict ?? 'NOT RUN';
  const blocking = ['S1', 'S2', 'S3', 'S4', 'S6'].filter((id) => verdict(id) !== 'PASS');
  const workaround = ['S5', 'S7'].filter((id) => verdict(id) !== 'PASS');
  const decision =
    blocking.length > 0
      ? `Falla ${blocking.join(', ')} → activar el fallback Kysely (ADR-0004)`
      : workaround.length > 0
        ? `Falla ${workaround.join(', ')} → documentar una solución alternativa antes de decidir (ADR-0004)`
        : 'S1–S6 en PASS → se puede proponer aceptar Prisma; requiere aprobación humana en T015';
  const lines = [
    '',
    '================ SPIKE T014 — Prisma 7 + RLS (ADR-0004) ================',
    ...order.map((id) => `${id.padEnd(16)} ${verdict(id).padEnd(8)} gate: ${results.get(id)?.gate ?? '-'}`),
    `Decisión según la regla de ADR-0004: ${decision}`,
    '------------------------------------------------------------------------',
    JSON.stringify(
      Object.fromEntries(order.map((id) => [id, results.get(id) ?? { verdict: 'NOT RUN' }])),
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  ];
  const text = lines.join('\n');
  console.log(text);
  if (process.env['KUOTA_SPIKE_REPORT']) writeFileSync(process.env['KUOTA_SPIKE_REPORT'], text);
}
