import { MoneyError } from './money-error.js';

/** Modos de redondeo (ADR-0007). No hay modo por defecto: cada operación inexacta debe indicarlo. */
export const ROUNDING_MODES = ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP', 'FLOOR', 'CEILING'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/**
 * `numerator / denominator` redondeado a entero con aritmética exacta (`bigint`). `denominator` > 0.
 * Semántica (la de decimal.js y Java BigDecimal): HALF_UP = mitad alejándose de cero; HALF_EVEN = mitad al par;
 * DOWN = hacia cero; UP = alejándose de cero; FLOOR = hacia −∞; CEILING = hacia +∞.
 * Si la división es exacta no exige modo; si es inexacta y no hay modo → `ROUNDING_REQUIRED`.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode?: RoundingMode): bigint {
  if (denominator <= 0n) throw new RangeError('El divisor debe ser positivo');
  const quotient = numerator / denominator; // trunca hacia cero
  const remainder = numerator % denominator; // mismo signo que el numerador
  if (remainder === 0n) return quotient;
  if (mode === undefined) throw new MoneyError('ROUNDING_REQUIRED');
  const sign = numerator < 0n ? -1n : 1n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  switch (mode) {
    case 'DOWN':
      return quotient;
    case 'UP':
      return quotient + sign;
    case 'FLOOR':
      return sign < 0n ? quotient - 1n : quotient;
    case 'CEILING':
      return sign > 0n ? quotient + 1n : quotient;
    case 'HALF_UP':
      return twiceRemainder >= denominator ? quotient + sign : quotient;
    case 'HALF_EVEN':
      if (twiceRemainder > denominator) return quotient + sign;
      if (twiceRemainder < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : quotient + sign;
  }
}
