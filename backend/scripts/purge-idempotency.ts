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
 *
 * Uso: `DATABASE_URL_MAINTENANCE=… pnpm --filter backend idempotency:purge [--dry-run] [--batch-size N] [--max-batches N]`.
 * Salida: 0 correcto; 1 identidad no autorizada; 2 uso o conexión.
 */
import { Client } from 'pg';

export interface Queryable {
  query<R extends object>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>;
}

export interface PurgeOptions {
  readonly batchSize?: number;
  readonly maxBatches?: number;
  readonly dryRun?: boolean;
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

/** Purga por lotes. Cada `query` es una transacción propia (autocommit). Devuelve solo conteos. */
export async function purgeExpiredIdempotencyKeys(db: Queryable, options: PurgeOptions = {}): Promise<PurgeResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new RangeError(`batchSize debe ser un entero entre 1 y ${MAX_BATCH_SIZE}`);
  }
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  await assertMaintenanceIdentity(db);
  await db.query("SET lock_timeout = '5s'");
  await db.query("SET statement_timeout = '60s'");

  const expiredBefore = await countExpired(db);
  if (options.dryRun) return { expiredBefore, deleted: 0, batches: 0, dryRun: true };

  let deleted = 0;
  let batches = 0;
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
  return { expiredBefore, deleted, batches, dryRun: false };
}

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
    options = {
      dryRun: process.argv.includes('--dry-run'),
      batchSize: parsePositive('--batch-size'),
      maxBatches: parsePositive('--max-batches'),
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
        ? `purge-idempotency: inspección: ${result.expiredBefore} clave(s) vencida(s); no se borró nada\n`
        : `purge-idempotency: ${result.deleted} clave(s) vencida(s) eliminada(s) en ${result.batches} lote(s) (vencidas al empezar: ${result.expiredBefore})\n`,
    );
  } catch (error) {
    if (error instanceof MaintenanceIdentityError) {
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
