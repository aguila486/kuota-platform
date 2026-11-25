/**
 * Purga manual de claves de idempotencia vencidas (T079; FR-024; R-16: sin job programado; migración 0002).
 *
 * - **Identidad:** SOLO `kuota_maintenance_login` (miembro de `kuota_maintenance`). Antes de tocar nada se verifica la
 *   sesión. Se rechaza un superusuario, un rol que omite RLS o cualquier miembro de `kuota_app` o `kuota_migrator`. Nunca
 *   usa las credenciales de la aplicación ni del migrador.
 * - **Qué borra:** solo filas con `expires_at <= now()`. La retención de 30 días la fija `expires_at` al crear la clave
 *   (`created_at + 30 días`). El tiempo se evalúa en PostgreSQL. Las políticas RLS de 0002 impiden además ver o borrar
 *   filas vigentes, aunque esta consulta cambiara. Recorre todos los tenants sin fijar `app.tenant_id`: el rol de
 *   mantenimiento tiene su propia política, no la de los tenants.
 * - **Lotes:** cada lote (`--batch-size`, por defecto 500, máximo 10000) es una sentencia y una transacción
 *   independiente. Si se interrumpe, lo borrado queda confirmado y lo demás intacto; volver a ejecutarlo continúa donde
 *   quedó.
 * - **Concurrencia:** dos purgas simultáneas pueden elegir las mismas filas. La segunda espera el bloqueo de fila y no
 *   borra nada de lo que ya borró la primera (0 filas). Una solicitud de la API que reutiliza una clave vencida la borra
 *   y la reinserta como nueva: esa fila nueva no es visible para la sentencia en curso y, al no estar vencida, las
 *   políticas impiden borrarla después. `lock_timeout` y `statement_timeout` acotan las esperas.
 * - **Salida:** solo conteos. Nunca claves, hashes, cuerpos ni respuestas (la identidad no puede ni leerlos).
 * - `--dry-run`: cuenta las claves vencidas sin borrar.
 * - **Auditoría de plataforma (T099; Constitución III; migración 0003):** cada ejecución queda en
 *   `kuota.platform_audit_events` con su `run_id` y `correlation_id`. El inicio (`started`) se escribe y confirma ANTES
 *   de borrar nada: si no puede escribirse, no se purga. Al terminar se escribe `succeeded` (recuentos, código `ok`) o
 *   `failed` (recuentos hasta el fallo y un código acotado, p. ej. `sqlstate-55p03`; nunca mensajes libres). Si el final
 *   no puede escribirse, la ejecución termina con error y el `started` sin final queda como evidencia de una ejecución
 *   incompleta. Solo metadatos: sin claves, tenants, hashes ni cuerpos.
 * - **Una ejecución a la vez:** un bloqueo consultivo de sesión serializa las purgas; una segunda espera (acotada por
 *   `lock_timeout`; si se agota, queda auditada como `failed`).
 *
 * Uso: `DATABASE_URL_MAINTENANCE=… pnpm --filter backend idempotency:purge [--dry-run] [--batch-size N] [--max-batches N]`.
 * Salida: 0 correcto; 1 identidad no autorizada; 2 uso o conexión.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

export interface Queryable {
  query<R extends object>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>;
}

export interface PurgeOptions {
  readonly batchSize?: number;
  readonly maxBatches?: number;
  readonly dryRun?: boolean;
  /** Identificador de la ejecución en `platform_audit_events` (por defecto, un UUID nuevo). */
  readonly runId?: string;
  /** Correlación con el proceso que lanza la purga (por defecto, un UUID nuevo). */
  readonly correlationId?: string;
}

export interface PurgeResult {
  readonly expiredBefore: number;
  readonly deleted: number;
  readonly batches: number;
  readonly dryRun: boolean;
}

export const DEFAULT_BATCH_SIZE = 500;
export const MAX_BATCH_SIZE = 10_000;
const MAINTENANCE_ROLE = 'kuota_maintenance';
export const PURGE_OPERATION = 'idempotency.purge';
/** Clave del bloqueo consultivo que serializa las purgas (constante: misma clave en todos los procesos). */
const PURGE_LOCK_KEY = 7_213_001;

/** No se pudo escribir la auditoría de plataforma. `purged` indica si ya se había borrado algo. */
export class PlatformAuditError extends Error {
  // Campos explícitos: Node ejecuta estos scripts quitando tipos y no admite propiedades en parámetros.
  readonly phase: 'started' | 'outcome';
  readonly purged: boolean;

  constructor(phase: 'started' | 'outcome', purged: boolean, options?: { cause?: unknown }) {
    super(
      phase === 'started'
        ? 'purge-idempotency: no se pudo registrar el inicio en la auditoría de plataforma; no se purgó nada'
        : 'purge-idempotency: no se pudo registrar el resultado en la auditoría de plataforma; el inicio sin final queda como evidencia',
      options,
    );
    this.name = 'PlatformAuditError';
    this.phase = phase;
    this.purged = purged;
  }
}

/** Código acotado para la auditoría: `sqlstate-xxxxx` o `error` (nunca el mensaje, que podría contener datos). */
export function resultCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `sqlstate-${code.toLowerCase()}` : 'error';
}

interface AuditRow {
  readonly runId: string;
  readonly correlationId: string;
  readonly status: 'started' | 'succeeded' | 'failed';
  readonly dryRun: boolean;
  readonly batchSize: number;
  readonly maxBatches: number | null;
  readonly expiredBefore?: number | null;
  readonly affectedRows?: number | null;
  readonly batches?: number | null;
  readonly resultCode?: string | null;
}

/** Inserta un evento de auditoría de plataforma (autocommit). Sin RETURNING: el mantenimiento no puede leer la tabla. */
async function recordPlatformAudit(db: Queryable, row: AuditRow): Promise<void> {
  await db.query(
    `INSERT INTO kuota.platform_audit_events
       (run_id, operation, status, correlation_id, dry_run, batch_size, max_batches, expired_before, affected_rows,
        batches, result_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.runId,
      PURGE_OPERATION,
      row.status,
      row.correlationId,
      row.dryRun,
      row.batchSize,
      row.maxBatches,
      row.expiredBefore ?? null,
      row.affectedRows ?? null,
      row.batches ?? null,
      row.resultCode ?? null,
    ],
  );
}

/** La sesión no es la identidad de mantenimiento autorizada. */
export class MaintenanceIdentityError extends Error {
  constructor(reason: string) {
    super(`purge-idempotency: identidad no autorizada (${reason})`);
    this.name = 'MaintenanceIdentityError';
  }
}

/** Verifica que la sesión sea la identidad de mantenimiento y nada más. */
export async function assertMaintenanceIdentity(db: Queryable): Promise<void> {
  const { rows } = await db.query<{
    superuser: boolean;
    bypassrls: boolean;
    maintenance: boolean;
    app: boolean;
    migrator: boolean;
  }>(
    `SELECT r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AND pg_has_role(current_user, $1, 'MEMBER') AS maintenance,
            pg_has_role(current_user, 'kuota_app', 'MEMBER') AS app,
            pg_has_role(current_user, 'kuota_migrator', 'MEMBER') AS migrator
       FROM pg_roles r WHERE r.rolname = current_user`,
    [MAINTENANCE_ROLE],
  );
  const session = rows[0];
  if (!session) throw new MaintenanceIdentityError('rol de sesión no encontrado');
  if (session.superuser) throw new MaintenanceIdentityError('superusuario');
  if (session.bypassrls) throw new MaintenanceIdentityError('omite RLS');
  if (session.app) throw new MaintenanceIdentityError('miembro de kuota_app');
  if (session.migrator) throw new MaintenanceIdentityError('miembro de kuota_migrator');
  if (!session.maintenance) throw new MaintenanceIdentityError(`no es miembro de ${MAINTENANCE_ROLE}`);
}

const countExpired = async (db: Queryable): Promise<number> =>
  Number(
    (await db.query<{ n: string }>('SELECT count(*) AS n FROM kuota.idempotency_keys WHERE expires_at <= now()'))
      .rows[0]?.n ?? 0,
  );

/**
 * Purga por lotes con auditoría de plataforma. Cada `query` es una transacción propia (autocommit). Devuelve solo
 * conteos. Orden: identidad → `started` (si falla, no se purga) → bloqueo → recuento y lotes → `succeeded`/`failed`.
 */
export async function purgeExpiredIdempotencyKeys(db: Queryable, options: PurgeOptions = {}): Promise<PurgeResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new RangeError(`batchSize debe ser un entero entre 1 y ${MAX_BATCH_SIZE}`);
  }
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  await assertMaintenanceIdentity(db);
  await db.query("SET lock_timeout = '5s'");
  await db.query("SET statement_timeout = '60s'");

  const dryRun = options.dryRun ?? false;
  const base = {
    runId: options.runId ?? randomUUID(),
    correlationId: options.correlationId ?? randomUUID(),
    dryRun,
    batchSize,
    maxBatches: Number.isFinite(maxBatches) ? maxBatches : null,
  };
  try {
    await recordPlatformAudit(db, { ...base, status: 'started' });
  } catch (error) {
    throw new PlatformAuditError('started', false, { cause: error });
  }

  let expiredBefore: number | null = null;
  let deleted = 0;
  let batches = 0;
  let locked = false;
  try {
    await db.query('SELECT pg_advisory_lock($1)', [PURGE_LOCK_KEY]);
    locked = true;
    expiredBefore = await countExpired(db);
    if (!dryRun) {
      while (batches < maxBatches) {
        const result = await db.query(
          `WITH batch AS (
             SELECT tenant_id, key FROM kuota.idempotency_keys
              WHERE expires_at <= now()
              ORDER BY expires_at, tenant_id, key
              LIMIT $1)
           DELETE FROM kuota.idempotency_keys t
            USING batch b
            WHERE t.tenant_id = b.tenant_id AND t.key = b.key AND t.expires_at <= now()`,
          [batchSize],
        );
        const count = result.rowCount ?? 0;
        batches++;
        deleted += count;
        if (count < batchSize) break;
      }
    }
  } catch (error) {
    const failure = { ...base, status: 'failed' as const, expiredBefore, affectedRows: deleted, batches };
    try {
      await recordPlatformAudit(db, { ...failure, resultCode: resultCodeOf(error) });
    } catch (auditError) {
      throw new AggregateError([error, auditError], 'purge-idempotency: falló la purga y también su auditoría', {
        cause: auditError,
      });
    }
    throw error;
  } finally {
    if (locked) await db.query('SELECT pg_advisory_unlock($1)', [PURGE_LOCK_KEY]).catch(() => undefined);
  }

  try {
    await recordPlatformAudit(db, {
      ...base,
      status: 'succeeded',
      expiredBefore,
      affectedRows: deleted,
      batches,
      resultCode: 'ok',
    });
  } catch (error) {
    throw new PlatformAuditError('outcome', deleted > 0, { cause: error });
  }
  return dryRun
    ? { expiredBefore: expiredBefore ?? 0, deleted: 0, batches: 0, dryRun: true }
    : { expiredBefore: expiredBefore ?? 0, deleted, batches, dryRun: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePositive(flag: string): number | undefined {
  const raw = argValue(flag);
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new RangeError(`${flag} debe ser un entero positivo`);
  return Number.parseInt(raw, 10);
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL_MAINTENANCE'];
  if (!url) {
    process.stderr.write('purge-idempotency: define DATABASE_URL_MAINTENANCE (identidad kuota_maintenance_login)\n');
    process.exit(2);
  }
  let options: PurgeOptions;
  try {
    const correlation = process.env['KUOTA_CORRELATION_ID'];
    if (correlation !== undefined && !UUID.test(correlation)) {
      throw new RangeError('KUOTA_CORRELATION_ID debe ser un UUID');
    }
    options = {
      dryRun: process.argv.includes('--dry-run'),
      batchSize: parsePositive('--batch-size'),
      maxBatches: parsePositive('--max-batches'),
      runId: randomUUID(),
      ...(correlation === undefined ? {} : { correlationId: correlation }),
    };
  } catch (error) {
    process.stderr.write(`purge-idempotency: ${(error as Error).message}\n`);
    process.exit(2);
  }
  const client = new Client({ connectionString: url, application_name: 'kuota-purge-idempotency' });
  try {
    await client.connect();
    const result = await purgeExpiredIdempotencyKeys(client, options);
    process.stdout.write(
      result.dryRun
        ? `purge-idempotency: inspección: ${result.expiredBefore} clave(s) vencida(s); no se borró nada (run ${options.runId})\n`
        : `purge-idempotency: ${result.deleted} clave(s) vencida(s) eliminada(s) en ${result.batches} lote(s) (vencidas al empezar: ${result.expiredBefore}; run ${options.runId})\n`,
    );
  } catch (error) {
    if (error instanceof PlatformAuditError) {
      process.stderr.write(`${error.message} (run ${options.runId})\n`);
      process.exitCode = 2;
    } else if (error instanceof MaintenanceIdentityError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      // Sin URL, claves ni detalles de conexión en la salida.
      process.stderr.write(
        `purge-idempotency: falló (${(error as { code?: string }).code ?? (error as Error).name})\n`,
      );
      process.exitCode = 2;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Entrada directa con `node scripts/purge-idempotency.ts`; al importarlo (pruebas), no se ejecuta.
if (process.argv[1]?.endsWith('purge-idempotency.ts')) void main();
