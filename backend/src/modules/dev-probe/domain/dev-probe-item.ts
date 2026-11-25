import { Money } from '../../../common/money/index.js';

/**
 * Dominio de `dev-probe` (T040). Recurso técnico NO productivo (FR-017): sin reglas financieras, sin préstamos, pagos
 * ni contabilidad. Solo valida su estructura según data-model.md (`dev_probe_items`). Sin dependencias de framework.
 */

/** `dev_probe_items.label`: 1–120 caracteres (en puntos de código, como `char_length` de PostgreSQL). */
export const LABEL_MIN_LENGTH = 1;
export const LABEL_MAX_LENGTH = 120;
/** `dev_probe_items.version`: entero ≥ 1 de PostgreSQL `integer`. */
export const VERSION_MIN = 1;
export const VERSION_MAX = 2_147_483_647;

/** Violación de una regla estructural; la capa de interfaz la traduce a 400 `validation-error`. */
export class DevProbeValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'DevProbeValidationError';
  }
}

/** Datos persistidos que no cumplen las invariantes (no debería ocurrir: la base tiene los mismos CHECK). */
export class DevProbeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevProbeInvariantError';
  }
}

export function validateLabel(label: unknown, field = 'label'): string {
  if (typeof label !== 'string') throw new DevProbeValidationError(field, 'Debe ser un texto');
  const length = [...label].length;
  if (length < LABEL_MIN_LENGTH || length > LABEL_MAX_LENGTH) {
    throw new DevProbeValidationError(field, `Debe tener entre ${LABEL_MIN_LENGTH} y ${LABEL_MAX_LENGTH} caracteres`);
  }
  return label;
}

export function validateVersion(version: unknown, field = 'version'): number {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < VERSION_MIN || version > VERSION_MAX) {
    throw new DevProbeValidationError(field, `Debe ser un entero entre ${VERSION_MIN} y ${VERSION_MAX}`);
  }
  return version;
}

/** Fila tal como la entrega la persistencia (monto y moneda por separado, como en la tabla). */
export interface DevProbeItemRecord {
  readonly id: string;
  readonly label: string;
  readonly sampleAmountMinor: bigint | null;
  readonly sampleCurrency: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Registro técnico de un tenant. El tenant no forma parte del dominio: lo fija el contexto y lo aplica RLS. */
export class DevProbeItem {
  private constructor(
    readonly id: string,
    readonly label: string,
    /** Monto de ejemplo: `Money` exacto (bigint en unidades mínimas) o `null`. */
    readonly sampleAmount: Money | null,
    readonly version: number,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {
    Object.freeze(this);
  }

  /** Reconstruye desde la persistencia comprobando la consistencia monto↔moneda y el resto de invariantes. */
  static fromRecord(record: DevProbeItemRecord): DevProbeItem {
    const { sampleAmountMinor: amount, sampleCurrency: currency } = record;
    if ((amount === null) !== (currency === null)) {
      throw new DevProbeInvariantError('sample_amount_minor y sample_currency deben estar ambos presentes o ausentes');
    }
    let sampleAmount: Money | null = null;
    try {
      validateLabel(record.label);
      validateVersion(record.version);
      if (amount !== null && currency !== null) sampleAmount = Money.of(amount, currency);
    } catch (error) {
      throw new DevProbeInvariantError(`Registro persistido inválido: ${(error as Error).name}`);
    }
    return new DevProbeItem(record.id, record.label, sampleAmount, record.version, record.createdAt, record.updatedAt);
  }
}

/** Datos validados para crear un registro (el id y el tenant los asigna el servidor). */
export interface NewDevProbeItem {
  readonly label: string;
  readonly sampleAmount: Money | null;
}

export function newDevProbeItem(label: unknown, sampleAmount: Money | null): NewDevProbeItem {
  return { label: validateLabel(label), sampleAmount };
}
