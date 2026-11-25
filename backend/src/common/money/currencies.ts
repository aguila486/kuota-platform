import { MoneyError } from './money-error.js';

/**
 * Catálogo cerrado de monedas (ADR-0007; R-08: "catálogo ISO 4217 mínimo con minorUnits, sin asumir país").
 *
 * Contiene SOLO las monedas que nombran los documentos aprobados (ADR-0007: JPY 0, MXN y USD 2, BHD 3, CLF 4). Añadir
 * monedas es una decisión de negocio (D-LEG-01): se hace aquí y en la copia de referencia
 * `contracts/fixtures/money/currencies.json`; las pruebas fallan si divergen.
 */
export const CURRENCIES = {
  BHD: { minorUnits: 3 },
  CLF: { minorUnits: 4 },
  JPY: { minorUnits: 0 },
  MXN: { minorUnits: 2 },
  USD: { minorUnits: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

/** Moneda del catálogo o `UNSUPPORTED_CURRENCY` (incluye minúsculas, vacíos y valores que no son string). */
export function requireCurrency(value: unknown): CurrencyCode {
  if (!isCurrencyCode(value)) throw new MoneyError('UNSUPPORTED_CURRENCY');
  return value;
}

/** Escala de la moneda (unidades menores ISO 4217). Nunca viaja en el payload. */
export function minorUnits(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}
