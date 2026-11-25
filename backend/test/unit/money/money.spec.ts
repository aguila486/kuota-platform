import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { KuotaProblemError } from '../../../src/common/errors/problem.js';
import {
  divideRounded,
  isCurrencyCode,
  minorUnits,
  Money,
  MoneyDecimal,
  MoneyError,
  moneyFromJson,
  parseMoneyField,
  requireCurrency,
} from '../../../src/common/money/index.js';

/** T061/T062: casos de la implementación TypeScript que no forman parte de los fixtures compartidos. */
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof MoneyError ? e.code : (e as Error).name;
  }
  return undefined;
};

describe('Money (T061)', () => {
  it('es inmutable y usa bigint', () => {
    const m = Money.of(150000n, 'MXN');
    expect(Object.isFrozen(m)).toBe(true);
    expect(typeof m.amountMinor).toBe('bigint');
    expect(() => {
      (m as { amountMinor: bigint }).amountMinor = 1n;
    }).toThrow(TypeError);
  });

  it('of valida primero la moneda y después el dominio', () => {
    expect(code(() => Money.of(2n ** 63n, 'ZZZ'))).toBe('UNSUPPORTED_CURRENCY');
    expect(code(() => Money.of(-(2n ** 63n), 'MXN'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(Money.zero('JPY').equals(Money.of(0n, 'JPY'))).toBe(true);
    expect(Money.of(1n, 'MXN').equals(Money.of(1n, 'USD'))).toBe(false);
  });

  it('JSON.stringify usa la forma del contrato (no falla con bigint)', () => {
    expect(JSON.stringify({ x: Money.of(-9007199254740993n, 'USD') })).toBe(
      '{"x":{"amount_minor":"-9007199254740993","currency":"USD"}}',
    );
  });

  it('multiply acepta factores de decimal.js global con notación exponencial, con valor exacto', () => {
    expect(Money.of(10_000_000n, 'MXN').multiply(new Decimal('1e-7')).amountMinor).toBe(1n);
    expect(Money.of(3n, 'MXN').multiply(new Decimal('2E+3')).amountMinor).toBe(6000n);
    expect(Money.of(3n, 'MXN').multiply(new MoneyDecimal('-0.5'), 'HALF_EVEN').amountMinor).toBe(-2n);
  });

  it('multiply rechaza factores no finitos o con exponentes extremos (error de programación, no de dominio)', () => {
    expect(code(() => Money.of(1n, 'MXN').multiply(new Decimal(NaN)))).toBe('RangeError');
    expect(code(() => Money.of(1n, 'MXN').multiply(new Decimal('Infinity')))).toBe('RangeError');
    expect(code(() => Money.of(1n, 'MXN').multiply(new Decimal('1e5000')))).toBe('RangeError');
    expect(code(() => Money.of(1n, 'MXN').multiply(new Decimal('1e-5000')))).toBe('RangeError');
  });

  it('allocate: total negativo se reparte de forma simétrica (interpretación pendiente de confirmar para Dart)', () => {
    expect(
      Money.of(-100n, 'MXN')
        .allocate(3)
        .map((m) => m.amountMinor),
    ).toEqual([-34n, -33n, -33n]);
    expect(
      Money.of(-5n, 'MXN')
        .allocate([1, 1])
        .map((m) => m.amountMinor),
    ).toEqual([-3n, -2n]);
  });

  it('allocate rechaza argumentos inválidos con RangeError', () => {
    const m = Money.of(10n, 'MXN');
    for (const bad of [0, -1, 1.5, Number.NaN] as const)
      expect(
        code(() => m.allocate(bad)),
        String(bad),
      ).toBe('RangeError');
    for (const bad of [[], [0, 0], [1, -1], [1.5], [2 ** 60]])
      expect(
        code(() => m.allocate(bad)),
        JSON.stringify(bad),
      ).toBe('RangeError');
  });

  it('parse: interpretaciones estrictas no cubiertas por los fixtures compartidos', () => {
    for (const text of ['007.5', '-0', '-0.00', '.5', '1.', '١٢٣', '0x10', '1_000']) {
      expect(
        code(() => Money.parse(text, 'MXN')),
        text,
      ).toBe('INVALID_AMOUNT');
    }
    expect(code(() => Money.parse(12 as unknown as string, 'MXN'))).toBe('INVALID_AMOUNT');
    expect(code(() => Money.parse('1'.repeat(40), 'JPY'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(Money.parse('0.50', 'MXN').amountMinor).toBe(50n);
  });

  it('divideRounded exige divisor positivo y respeta los modos', () => {
    expect(code(() => divideRounded(1n, 0n))).toBe('RangeError');
    expect(divideRounded(10n, 5n)).toBe(2n);
    expect(code(() => divideRounded(1n, 3n))).toBe('ROUNDING_REQUIRED');
    expect(divideRounded(-7n, 2n, 'FLOOR')).toBe(-4n);
    expect(divideRounded(7n, 2n, 'CEILING')).toBe(4n);
  });

  it('catálogo cerrado', () => {
    expect(isCurrencyCode('MXN')).toBe(true);
    for (const bad of ['mxn', 'EUR', '', 'constructor', 'toString', null, 1])
      expect(isCurrencyCode(bad), String(bad)).toBe(false);
    expect(code(() => requireCurrency('__proto__'))).toBe('UNSUPPORTED_CURRENCY');
    expect(minorUnits('CLF')).toBe(4);
  });
});

describe('JSON en la frontera (T062, parte money.json.ts)', () => {
  it('moneyFromJson rechaza estructuras que no son objeto y montos que no son string', () => {
    for (const bad of [
      null,
      'x',
      1,
      [],
      { amount_minor: 100, currency: 'MXN' },
      { amount_minor: 1n, currency: 'MXN' },
      { currency: 'MXN' },
    ]) {
      expect(
        code(() => moneyFromJson(bad)),
        JSON.stringify(bad, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)),
      ).toBe('INVALID_AMOUNT');
    }
    expect(code(() => moneyFromJson({ amount_minor: '1' }))).toBe('UNSUPPORTED_CURRENCY');
  });

  it('parseMoneyField: 400 validation-error con el campo y el código, sin reflejar el valor', () => {
    const problem = (value: unknown) => {
      try {
        parseMoneyField(value, 'sample_amount');
      } catch (e) {
        return e as KuotaProblemError;
      }
      throw new Error('se esperaba un error');
    };
    const outOfRange = problem({ amount_minor: '9223372036854775808', currency: 'MXN' });
    expect(outOfRange).toBeInstanceOf(KuotaProblemError);
    expect(outOfRange.code).toBe('validation-error');
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.options.errors).toEqual([
      { field: 'sample_amount.amount_minor', message: expect.stringMatching(/^AMOUNT_OUT_OF_RANGE: /) as unknown },
    ]);
    expect(JSON.stringify(outOfRange.options)).not.toContain('9223372036854775808');
    expect(problem({ amount_minor: '1', currency: 'ZZZ' }).options.errors?.[0]?.field).toBe('sample_amount.currency');
    expect(problem({ amount_minor: '1', currency: 'MXN', extra: 1 }).options.errors?.[0]?.field).toBe('sample_amount');
    expect(problem([]).options.errors?.[0]?.field).toBe('sample_amount');
    expect(parseMoneyField({ amount_minor: '-75', currency: 'MXN' }, 'x').format()).toBe('-0.75');
  });

  it('parseMoneyField propaga errores que no son de Money', () => {
    const hostile = {
      amount_minor: '1',
      get currency(): string {
        throw new TypeError('getter hostil');
      },
    };
    expect(() => parseMoneyField(hostile, 'x')).toThrow(TypeError);
  });
});
