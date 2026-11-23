import { KuotaProblemError } from '../errors/problem.js';
import { requireCurrency } from './currencies.js';
import { Money } from './money.js';
import { MoneyError } from './money-error.js';

/** Forma JSON de Money en el contrato (`schemas/Money.yaml`; ADR-0007). */
export interface MoneyJson {
  readonly amount_minor: string;
  readonly currency: string;
}

/** Forma canónica de `amount_minor`: `0` o signo opcional y 1–19 dígitos sin ceros a la izquierda (solo la forma). */
export const CANONICAL_AMOUNT_MINOR = /^(0|-?[1-9][0-9]{0,18})$/;

export function moneyToJson(money: Money): MoneyJson {
  return money.toJSON();
}

/**
 * JSON → Money (T062; operación `from_json` de los fixtures). Orden de validación: moneda (`UNSUPPORTED_CURRENCY`),
 * forma canónica de `amount_minor` (`INVALID_AMOUNT`: `-0`, ceros a la izquierda, decimales, exponentes, espacios,
 * signo `+`, números JSON en lugar de string) y dominio numérico exacto (`AMOUNT_OUT_OF_RANGE`). Nunca pasa por `number`.
 */
export function moneyFromJson(value: unknown): Money {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MoneyError('INVALID_AMOUNT');
  const { amount_minor: amountMinor, currency } = value as Record<string, unknown>;
  const code = requireCurrency(currency);
  if (typeof amountMinor !== 'string' || !CANONICAL_AMOUNT_MINOR.test(amountMinor)) {
    throw new MoneyError('INVALID_AMOUNT');
  }
  return Money.of(BigInt(amountMinor), code);
}

const MONEY_KEYS = new Set(['amount_minor', 'currency']);

/**
 * Validación en la frontera HTTP (FR-022): convierte un campo Money del body o lanza 400 `validation-error` con
 * `errors[{field, message}]`. El mensaje indica el código de Money y nunca refleja el valor recibido. Rechaza
 * propiedades adicionales (el esquema `Money` del contrato es cerrado).
 */
export function parseMoneyField(value: unknown, field: string): Money {
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isObject || Object.keys(value).some((key) => !MONEY_KEYS.has(key))) {
    throw new KuotaProblemError('validation-error', {
      errors: [{ field, message: 'Se espera un objeto {amount_minor, currency} sin otras propiedades' }],
    });
  }
  try {
    return moneyFromJson(value);
  } catch (error) {
    if (!(error instanceof MoneyError)) throw error;
    const target = error.code === 'UNSUPPORTED_CURRENCY' ? `${field}.currency` : `${field}.amount_minor`;
    throw new KuotaProblemError('validation-error', {
      errors: [{ field: target, message: `${error.code}: ${error.message}` }],
    });
  }
}
