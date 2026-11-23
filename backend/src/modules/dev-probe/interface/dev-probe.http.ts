import { KuotaProblemError } from '../../../common/errors/problem.js';
import { type Money, type MoneyJson, moneyToJson, parseMoneyField } from '../../../common/money/index.js';
import { type DevProbeItem, DevProbeValidationError } from '../domain/dev-probe-item.js';

/**
 * Frontera HTTP de `dev-probe` (T042, T062): validación de entrada según el contrato (`DevProbeItemCreate`,
 * `DevProbeItemUpdate`, `Limit`, `Cursor`) y serialización de `DevProbeItem`. Los errores nunca reflejan el valor
 * recibido ni datos internos.
 */

/** `DevProbeItem` del contrato. `sample_amount` usa la representación canónica de Money (string exacto). */
export interface DevProbeItemJson {
  readonly id: string;
  readonly label: string;
  readonly sample_amount: MoneyJson | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DevProbeItemPageJson {
  readonly data: readonly DevProbeItemJson[];
  readonly next_cursor: string | null;
}

export interface CreateInput {
  readonly label: string;
  readonly sampleAmount: Money | null;
}

export interface UpdateInput {
  readonly label: string;
  readonly version: number;
}

const invalid = (field: string, message: string) =>
  new KuotaProblemError('validation-error', { errors: [{ field, message }] });

/** Cuerpo JSON como objeto con solo las propiedades permitidas (`additionalProperties: false`). */
function requireObject(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid('body', 'Se espera un objeto JSON');
  }
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    // `tenant_id` u otra propiedad no permitida: se rechaza (FR-012, US2-3). Se nombra el campo, no su valor.
    throw new KuotaProblemError('validation-error', {
      errors: extra.map((key) => ({ field: key.slice(0, 64), message: 'Propiedad no permitida' })),
    });
  }
  return body as Record<string, unknown>;
}

/** Traduce errores estructurales del dominio a 400 `validation-error`. */
export async function asValidationError<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DevProbeValidationError) throw invalid(error.field, error.message);
    throw error;
  }
}

export function parseCreateBody(body: unknown): CreateInput {
  const value = requireObject(body, ['label', 'sample_amount']);
  if (typeof value['label'] !== 'string') throw invalid('label', 'Obligatorio: texto de 1 a 120 caracteres');
  // Money compartido (T062): forma canónica, dominio simétrico de int64 y catálogo aprobado; bigint exacto.
  const sampleAmount = 'sample_amount' in value ? parseMoneyField(value['sample_amount'], 'sample_amount') : null;
  return { label: value['label'], sampleAmount };
}

export function parseUpdateBody(body: unknown): UpdateInput {
  const value = requireObject(body, ['label', 'version']);
  if (typeof value['label'] !== 'string') throw invalid('label', 'Obligatorio: texto de 1 a 120 caracteres');
  if (typeof value['version'] !== 'number') throw invalid('version', 'Obligatorio: entero ≥ 1');
  return { label: value['label'], version: value['version'] };
}

/** `limit`: entero 1–100, por defecto 50 (contrato `Limit`). */
export function parseLimit(raw: unknown): number {
  if (raw === undefined) return 50;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,2}$/.test(raw) || Number.parseInt(raw, 10) > 100) {
    throw invalid('limit', 'Entero entre 1 y 100');
  }
  return Number.parseInt(raw, 10);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_PREFIX = 'v1:';

/** Id del path normalizado, o `null` si no es un UUID (un recurso con ese id no puede existir → 404). */
export function normalizeId(raw: string): string | null {
  return UUID.test(raw) ? raw.toLowerCase() : null;
}

/** Cursor opaco: base64url de `v1:<id>` del último elemento entregado. */
export function encodeCursor(afterId: string | null): string | null {
  return afterId === null ? null : Buffer.from(`${CURSOR_PREFIX}${afterId}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: unknown): string | null {
  if (raw === undefined) return null;
  const fail = () => invalid('cursor', 'Cursor inválido');
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw fail();
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  if (!decoded.startsWith(CURSOR_PREFIX)) throw fail();
  const id = normalizeId(decoded.slice(CURSOR_PREFIX.length));
  if (id === null) throw fail();
  return id;
}

export function toJson(item: DevProbeItem): DevProbeItemJson {
  return {
    id: item.id,
    label: item.label,
    sample_amount: item.sampleAmount === null ? null : moneyToJson(item.sampleAmount),
    version: item.version,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}
