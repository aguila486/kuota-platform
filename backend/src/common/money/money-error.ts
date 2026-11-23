/** Errores de dominio de Money (ADR-0007; data-model.md, Objetos de valor). Los nombres son contrato con Dart. */
export const MONEY_ERROR_CODES = [
  'CURRENCY_MISMATCH',
  'ROUNDING_REQUIRED',
  'INVALID_AMOUNT',
  'TOO_MANY_DECIMALS',
  'AMOUNT_OUT_OF_RANGE',
  'UNSUPPORTED_CURRENCY',
] as const;
export type MoneyErrorCode = (typeof MONEY_ERROR_CODES)[number];

const MESSAGES: Record<MoneyErrorCode, string> = {
  CURRENCY_MISMATCH: 'Operación entre monedas distintas',
  ROUNDING_REQUIRED: 'El resultado es inexacto y no se indicó un modo de redondeo',
  INVALID_AMOUNT: 'Monto con formato inválido',
  TOO_MANY_DECIMALS: 'El monto tiene más decimales que la escala de la moneda',
  AMOUNT_OUT_OF_RANGE: 'Monto fuera del dominio de Money (±9223372036854775807 unidades mínimas)',
  UNSUPPORTED_CURRENCY: 'Moneda no soportada',
};

/** Error tipado de Money. El mensaje es fijo: nunca incluye el valor recibido. */
export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(MESSAGES[code]);
    this.name = 'MoneyError';
  }
}
