import { Decimal } from 'decimal.js';
import { type CurrencyCode, minorUnits, requireCurrency } from './currencies.js';
import { MoneyError } from './money-error.js';
import { divideRounded, type RoundingMode } from './rounding.js';

/** Dominio simétrico de `amountMinor` (ADR-0007): −2^63 queda fuera aunque BIGINT lo admita. */
export const MONEY_MAX_MINOR = 9223372036854775807n;
export const MONEY_MIN_MINOR = -MONEY_MAX_MINOR;

/**
 * Decimal para factores y tasas: instancia clonada (nunca la global) con `precision: 40` (R-08) y sin notación
 * exponencial al convertir a texto. Money NO usa sus operaciones para los montos: el producto se calcula con `bigint`
 * a partir del valor exacto del factor, así que nunca se redondea un intermedio.
 */
export const MoneyDecimal = Decimal.clone({ precision: 40, toExpNeg: -9e15, toExpPos: 9e15 });

const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;
const PARSE_TEXT = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const MAX_INTEGER_DIGITS = 19;
/** Límite de dígitos de un factor (protege de exponentes extremos; ningún factor real se acerca). */
const MAX_FACTOR_SCALE = 1_000;

function assertInDomain(amountMinor: bigint): void {
  if (amountMinor > MONEY_MAX_MINOR || amountMinor < MONEY_MIN_MINOR) throw new MoneyError('AMOUNT_OUT_OF_RANGE');
}

/** Valor exacto de un Decimal como fracción `numerator / 10^scale`. */
function exactFraction(factor: Decimal): { numerator: bigint; scale: number } {
  if (!factor.isFinite()) throw new RangeError('El factor debe ser un número finito');
  const match = DECIMAL_TEXT.exec(factor.toString());
  if (!match) throw new RangeError('Factor con formato no reconocido');
  const [, sign = '', integer = '', fraction = '', exponentText = '0'] = match;
  let digits = `${integer}${fraction}`;
  let scale = fraction.length - Number.parseInt(exponentText, 10);
  if (scale > MAX_FACTOR_SCALE || digits.length - scale > MAX_FACTOR_SCALE)
    throw new RangeError('Factor fuera de rango');
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  const magnitude = BigInt(digits);
  return { numerator: sign === '-' ? -magnitude : magnitude, scale };
}

/**
 * Money inmutable (T061; ADR-0007; data-model.md, Objetos de valor): `amountMinor` en unidades mínimas (`bigint`, dominio
 * simétrico) y moneda del catálogo cerrado. Nunca usa `number` para montos.
 */
export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: CurrencyCode,
  ) {
    Object.freeze(this);
  }

  /** Construye un Money validando moneda (`UNSUPPORTED_CURRENCY`) y dominio (`AMOUNT_OUT_OF_RANGE`). */
  static of(amountMinor: bigint, currency: string): Money {
    const code = requireCurrency(currency);
    assertInDomain(amountMinor);
    return new Money(amountMinor, code);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  /**
   * Cadena decimal de presentación → Money. Acepta `-?(0|[1-9][0-9]*)(.[0-9]+)?` sin separadores, signo `+`, espacios ni
   * exponentes (`INVALID_AMOUNT`); más decimales que la escala → `TOO_MANY_DECIMALS` (nunca redondea); el cero negativo
   * (`-0`, `-0.00`) → `INVALID_AMOUNT`; fuera de dominio → `AMOUNT_OUT_OF_RANGE`. Se valida primero la moneda.
   */
  static parse(text: string, currency: string): Money {
    const code = requireCurrency(currency);
    const scale = minorUnits(code);
    const match = typeof text === 'string' ? PARSE_TEXT.exec(text) : null;
    if (!match) throw new MoneyError('INVALID_AMOUNT');
    const [, sign = '', integer = '', fraction = ''] = match;
    if (fraction.length > scale) throw new MoneyError('TOO_MANY_DECIMALS');
    if (integer.length > MAX_INTEGER_DIGITS) throw new MoneyError('AMOUNT_OUT_OF_RANGE');
    const magnitude = BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
    if (sign === '-' && magnitude === 0n) throw new MoneyError('INVALID_AMOUNT');
    return Money.of(sign === '-' ? -magnitude : magnitude, code);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor - other.amountMinor, this.currency);
  }

  /**
   * Multiplica por un factor decimal exacto. Si el resultado no es entero en unidades mínimas, exige `rounding`
   * (`ROUNDING_REQUIRED`); no hay modo por defecto. Resultado fuera de dominio → `AMOUNT_OUT_OF_RANGE`.
   */
  multiply(factor: Decimal, rounding?: RoundingMode): Money {
    const { numerator, scale } = exactFraction(factor);
    const product = divideRounded(this.amountMinor * numerator, 10n ** BigInt(scale), rounding);
    return Money.of(product, this.currency);
  }

  /**
   * Reparto exacto por mayor residuo: la suma de las partes es igual al total; los empates se resuelven por índice
   * (el menor primero). `parts` (entero ≥ 1) equivale a `ratios` de unos. Con total negativo el reparto es simétrico:
   * se reparte el valor absoluto y se aplica el signo a cada parte.
   */
  allocate(partsOrRatios: number | readonly number[]): Money[] {
    const ratios = typeof partsOrRatios === 'number' ? this.equalRatios(partsOrRatios) : partsOrRatios;
    if (ratios.length === 0 || ratios.some((r) => !Number.isSafeInteger(r) || r < 0)) {
      throw new RangeError('Las proporciones deben ser enteros ≥ 0');
    }
    const weights = ratios.map((r) => BigInt(r));
    const total = weights.reduce((sum, w) => sum + w, 0n);
    if (total === 0n) throw new RangeError('Al menos una proporción debe ser mayor que cero');

    const negative = this.amountMinor < 0n;
    const magnitude = negative ? -this.amountMinor : this.amountMinor;
    const shares = weights.map((w, index) => ({ index, base: (magnitude * w) / total, rest: (magnitude * w) % total }));
    let leftover = magnitude - shares.reduce((sum, s) => sum + s.base, 0n);
    const byRemainder = [...shares].sort((x, y) => (x.rest === y.rest ? x.index - y.index : x.rest > y.rest ? -1 : 1));
    const extra = new Set<number>();
    for (const share of byRemainder) {
      if (leftover === 0n) break;
      extra.add(share.index);
      leftover -= 1n;
    }
    return shares.map((s) => {
      const part = s.base + (extra.has(s.index) ? 1n : 0n);
      return Money.of(negative ? -part : part, this.currency);
    });
  }

  /** Cadena decimal canónica con exactamente `escala` decimales y punto (`1234.50`, `-0.75`, `100` en JPY). */
  format(): string {
    const scale = minorUnits(this.currency);
    const negative = this.amountMinor < 0n;
    const digits = (negative ? -this.amountMinor : this.amountMinor).toString();
    if (scale === 0) return `${negative ? '-' : ''}${digits}`;
    const padded = digits.padStart(scale + 1, '0');
    return `${negative ? '-' : ''}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  /** JSON del contrato (ADR-0007): `amount_minor` siempre string canónico. Evita que `JSON.stringify` falle con bigint. */
  toJSON(): { amount_minor: string; currency: CurrencyCode } {
    return { amount_minor: this.amountMinor.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) throw new MoneyError('CURRENCY_MISMATCH');
  }

  private equalRatios(parts: number): number[] {
    if (!Number.isSafeInteger(parts) || parts < 1) throw new RangeError('El número de partes debe ser un entero ≥ 1');
    return new Array<number>(parts).fill(1);
  }
}
