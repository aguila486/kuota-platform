import { createHash } from 'node:crypto';

/**
 * Funciones puras de idempotencia (data-model.md `idempotency_keys`; T074, T075).
 */

/** JSON canónico: claves de objeto ordenadas recursivamente; los arreglos conservan su orden. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // `undefined` (sin body) se representa como `null` para que el hash esté siempre definido.
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * `idempotency_keys.request_hash`: SHA-256 (hex) de `method + path + JSON canónico del body`. Las partes se separan con
 * `\n` para que no haya ambigüedad entre ellas (el método y la ruta no contienen saltos de línea).
 */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`, 'utf8')
    .digest('hex');
}

/**
 * Identificador del `pg_advisory_xact_lock` de una clave: los primeros 8 bytes de SHA-256(`tenant_id` + ":" + `key`)
 * como entero de 64 bits con signo. Exportado para las pruebas (T072), que toman el mismo bloqueo desde otra conexión.
 * Una colisión entre claves distintas solo provoca un 409 reintentable: la decisión final usa la fila con PK
 * `(tenant_id, key)`.
 */
export function idempotencyLockId(tenantId: string, key: string): bigint {
  const digest = createHash('sha256').update(`${tenantId}:${key}`, 'utf8').digest();
  return digest.readBigInt64BE(0);
}
