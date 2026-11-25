import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

/** Tablas de tenant de 0001_foundation. Las pruebas comprueban que `check-rls` las encuentra todas. */
export const TENANT_TABLES = ['audit_events', 'dev_probe_items', 'idempotency_keys'] as const;

export const TENANT_A = '0193b6f0-0000-7000-8000-00000000000a';
export const TENANT_B = '0193b6f0-0000-7000-8000-00000000000b';

/** Ejecuta `fn` como kuota_app_login dentro de una transacción con el contexto de `tenant` (solo para pruebas). */
export async function asTenantSql<T>(url: string, tenant: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', 'dev:test', true), set_config('app.correlation_id', $2, true)",
      [tenant, randomUUID()],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Inserta `count` filas del tenant en cada tabla de tenant, con la credencial de runtime y su contexto. */
export async function seedTenantRows(url: string, tenant: string, count: number): Promise<void> {
  await asTenantSql(url, tenant, async (client) => {
    for (let i = 0; i < count; i++) {
      await client.query('INSERT INTO kuota.dev_probe_items (label) VALUES ($1)', [`seed-${tenant.slice(-1)}-${i}`]);
      await client.query(
        "INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status) VALUES ($1, $2, 'POST', '/v1/x', 'IN_PROGRESS')",
        [`key-${randomUUID()}`, randomBytes(32).toString('hex')],
      );
      await client.query(
        "INSERT INTO kuota.audit_events (actor_type, action, entity_type, entity_id, origin) VALUES ('DEV', 'seed', 'probe', $1, 'test')",
        [String(i)],
      );
    }
  });
}

/** SQLSTATE de un error de pg o Prisma (busca en la causa y en los metadatos). */
export function sqlState(error: unknown): string | undefined {
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
  return visit(error) ?? /\b(42501|23514|23502|22P02|42P01|0A000)\b/.exec(String(error))?.[1];
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error y la operación terminó bien');
}
