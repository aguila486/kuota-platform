import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_AMOUNT_MINOR,
  CURRENCIES,
  type CurrencyCode,
  Money,
  MoneyDecimal,
  MoneyError,
  MONEY_MAX_MINOR,
  MONEY_MIN_MINOR,
  moneyFromJson,
  ROUNDING_MODES,
} from '../../src/common/money/index.js';

/**
 * T058 (US4-5; ADR-0007): pruebas de propiedades de Money con fast-check.
 *
 * Propiedades literales de T058: `allocate` conserva la suma, `add`/`subtract` son inversas y `multiply` por 1 es
 * identidad. Además, solo propiedades que ya son reglas aprobadas de ADR-0007 o de la API documentada de T061: identidad
 * y asociatividad de la suma dentro del dominio, ida y vuelta JSON y de presentación sin pérdida (también > 2^53),
 * separación de monedas, dominio simétrico sin truncar ni saturar, rechazo de JSON no canónico y de monedas fuera del
 * catálogo, y reparto simétrico para totales negativos. No se fija ningún redondeo de negocio (D-FIN-02, pendiente).
 *
 * Reproducibilidad: semilla FIJA (no aleatoria por ejecución). Para reproducir un fallo, fast-check imprime `seed`,
 * `path` y el contraejemplo; se reejecuta con `KUOTA_FC_SEED=<seed>` (y `KUOTA_FC_PATH=<path>` para ir directo al caso).
 * `KUOTA_FC_RUNS` aumenta las ejecuciones en una exploración manual. Los casos límite se fijan además como `examples`.
 */
const SEED = Number.parseInt(process.env['KUOTA_FC_SEED'] ?? '20261123', 10);
const RUNS = Number.parseInt(process.env['KUOTA_FC_RUNS'] ?? '1000', 10);
const PATH = process.env['KUOTA_FC_PATH'];
fc.configureGlobal({ seed: SEED, numRuns: RUNS, ...(PATH ? { path: PATH } : {}), endOnFailure: true });

const CODES = Object.keys(CURRENCIES) as CurrencyCode[];
const TWO_POW_53 = 2n ** 53n;
const EDGES = [
  0n,
  1n,
  -1n,
  MONEY_MAX_MINOR,
  MONEY_MIN_MINOR,
  MONEY_MAX_MINOR - 1n,
  MONEY_MIN_MINOR + 1n,
  TWO_POW_53,
  TWO_POW_53 + 1n,
  -(TWO_POW_53 + 1n),
];

/** Monto en el dominio simétrico, con los bordes y valores > 2^53 forzados con frecuencia. */
const amountIn = (min: bigint, max: bigint) =>
  fc.oneof(
    { weight: 3, arbitrary: fc.bigInt({ min, max }) },
    { weight: 1, arbitrary: fc.constantFrom(...EDGES.filter((e) => e >= min && e <= max)) },
  );
const amount = amountIn(MONEY_MIN_MINOR, MONEY_MAX_MINOR);
const currency = fc.constantFrom(...CODES);
const money = fc.tuple(amount, currency).map(([a, c]) => Money.of(a, c));
/** Montos acotados para que la suma de dos (o tres) nunca salga del dominio. */
const half = MONEY_MAX_MINOR / 2n;
const third = MONEY_MAX_MINOR / 3n;

function moneyError(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof MoneyError) return error.code;
    throw error;
  }
  return undefined;
}
const sum = (parts: Money[]) => parts.reduce((total, part) => total + part.amountMinor, 0n);

describe('propiedades literales de T058 (US4-5)', () => {
  it('allocate(n) conserva exactamente la suma, en la misma moneda, para todo monto y n ∈ [1, 64]', () => {
    fc.assert(
      fc.property(money, fc.integer({ min: 1, max: 64 }), (m, n) => {
        const parts = m.allocate(n);
        expect(parts).toHaveLength(n);
        expect(sum(parts)).toBe(m.amountMinor);
        expect(parts.every((p) => p.currency === m.currency)).toBe(true);
        // Mayor residuo con proporciones iguales: las partes difieren como mucho en 1 unidad mínima.
        const values = parts.map((p) => p.amountMinor);
        const spread = values.reduce((a, b) => (a > b ? a : b)) - values.reduce((a, b) => (a < b ? a : b));
        expect(spread <= 1n).toBe(true);
      }),
      {
        examples: [
          [Money.of(MONEY_MAX_MINOR, 'USD'), 3],
          [Money.of(MONEY_MIN_MINOR, 'JPY'), 64],
          [Money.of(1n, 'BHD'), 7],
        ],
      },
    );
  });

  it('allocate(ratios) conserva exactamente la suma para proporciones enteras ≥ 0 con al menos una > 0', () => {
    const ratios = fc
      .array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 })
      .filter((r) => r.some((x) => x > 0));
    fc.assert(
      fc.property(money, ratios, (m, r) => {
        const parts = m.allocate(r);
        expect(parts).toHaveLength(r.length);
        expect(sum(parts)).toBe(m.amountMinor);
        // Una proporción 0 nunca recibe monto.
        r.forEach((weight, i) => weight === 0 && expect(parts[i]!.amountMinor).toBe(0n));
      }),
      {
        examples: [
          [Money.of(100n, 'MXN'), [1, 1, 1]],
          [Money.of(-100n, 'MXN'), [0, 1, 2]],
        ],
      },
    );
  });

  it('add y subtract son inversas: (a + b) − b = a y (a − b) + b = a dentro del dominio', () => {
    fc.assert(
      fc.property(amountIn(-half, half), amountIn(-half, half), currency, (x, y, c) => {
        const a = Money.of(x, c);
        const b = Money.of(y, c);
        expect(a.add(b).subtract(b).equals(a)).toBe(true);
        expect(a.subtract(b).add(b).equals(a)).toBe(true);
      }),
      {
        examples: [
          [half, -half, 'USD'],
          [0n, half, 'CLF'],
        ],
      },
    );
  });

  it('multiply por 1 es identidad, sin modo de redondeo y con cualquier modo, y con 1 escrito con ceros', () => {
    const one = fc.constantFrom('1', '1.0', '1.000000', '1e0', '0.1e1', '10e-1');
    const mode = fc.option(fc.constantFrom(...ROUNDING_MODES), { nil: undefined });
    fc.assert(
      fc.property(money, one, mode, (m, text, rounding) => {
        expect(m.multiply(new MoneyDecimal(text), rounding).equals(m)).toBe(true);
      }),
    );
  });
});

describe('propiedades de ADR-0007 y de la API de T061', () => {
  it('identidad aditiva: a + 0 = a y a − 0 = a', () => {
    fc.assert(
      fc.property(money, (m) => {
        expect(m.add(Money.zero(m.currency)).equals(m)).toBe(true);
        expect(m.subtract(Money.zero(m.currency)).equals(m)).toBe(true);
      }),
    );
  });

  it('asociatividad de la suma cuando todos los resultados están en el dominio', () => {
    fc.assert(
      fc.property(amountIn(-third, third), amountIn(-third, third), amountIn(-third, third), currency, (x, y, z, c) => {
        const [a, b, d] = [Money.of(x, c), Money.of(y, c), Money.of(z, c)];
        expect(
          a
            .add(b)
            .add(d)
            .equals(a.add(b.add(d))),
        ).toBe(true);
      }),
    );
  });

  it('Money → JSON → Money es exacto, canónico y nunca pasa por number (incluidos valores > 2^53)', () => {
    fc.assert(
      fc.property(money, (m) => {
        const json = JSON.stringify(m);
        const parsed = JSON.parse(json) as { amount_minor: unknown; currency: unknown };
        expect(typeof parsed.amount_minor).toBe('string');
        expect(parsed.amount_minor).toMatch(CANONICAL_AMOUNT_MINOR);
        expect(parsed.amount_minor).toBe(m.amountMinor.toString());
        expect(moneyFromJson(parsed).equals(m)).toBe(true);
        expect(JSON.stringify(moneyFromJson(parsed))).toBe(json); // mismo JSON → mismo hash de idempotencia
      }),
    );
  });

  it('presentación: parse(format(m)) = m y format tiene exactamente la escala de la moneda', () => {
    fc.assert(
      fc.property(money, (m) => {
        const text = m.format();
        const scale = CURRENCIES[m.currency].minorUnits;
        expect(text.includes('.') ? text.split('.')[1]!.length : 0).toBe(scale);
        expect(Money.parse(text, m.currency).equals(m)).toBe(true);
      }),
    );
  });

  it('separación de monedas: add/subtract entre monedas distintas → CURRENCY_MISMATCH, sin resultado', () => {
    const pair = fc.tuple(currency, currency).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(amount, amount, pair, (x, y, [c1, c2]) => {
        const [a, b] = [Money.of(x, c1), Money.of(y, c2)];
        expect(moneyError(() => a.add(b))).toBe('CURRENCY_MISMATCH');
        expect(moneyError(() => a.subtract(b))).toBe('CURRENCY_MISMATCH');
      }),
    );
  });

  it('dominio simétrico: fuera de rango → AMOUNT_OUT_OF_RANGE; la suma desbordada nunca se trunca ni se satura', () => {
    const outside = fc.oneof(
      fc.bigInt({ min: MONEY_MAX_MINOR + 1n, max: MONEY_MAX_MINOR * 4n }),
      fc.bigInt({ min: MONEY_MIN_MINOR * 4n, max: MONEY_MIN_MINOR - 1n }),
    );
    fc.assert(
      fc.property(outside, currency, (x, c) => {
        expect(moneyError(() => Money.of(x, c))).toBe('AMOUNT_OUT_OF_RANGE');
      }),
      {
        examples: [
          [MONEY_MIN_MINOR - 1n, 'USD'],
          [MONEY_MAX_MINOR + 1n, 'JPY'],
        ],
      },
    );
    fc.assert(
      fc.property(amount, amount, currency, (x, y, c) => {
        const exact = x + y;
        const inDomain = exact <= MONEY_MAX_MINOR && exact >= MONEY_MIN_MINOR;
        const result = (() => {
          try {
            return Money.of(x, c).add(Money.of(y, c));
          } catch (error) {
            if (error instanceof MoneyError && error.code === 'AMOUNT_OUT_OF_RANGE') return 'fuera';
            throw error;
          }
        })();
        expect(result === 'fuera' ? !inDomain : inDomain && result.amountMinor === exact).toBe(true);
      }),
      {
        examples: [
          [MONEY_MAX_MINOR, 1n, 'USD'],
          [MONEY_MIN_MINOR, -1n, 'USD'],
          [MONEY_MAX_MINOR, MONEY_MIN_MINOR, 'USD'],
        ],
      },
    );
  });

  it('la negación de cualquier monto válido es válida y el reparto de un total negativo es simétrico', () => {
    fc.assert(
      fc.property(money, fc.integer({ min: 1, max: 16 }), (m, n) => {
        const negated = Money.of(-m.amountMinor, m.currency);
        expect(negated.allocate(n).map((p) => p.amountMinor)).toEqual(m.allocate(n).map((p) => -p.amountMinor));
      }),
    );
  });

  it('JSON no canónico (ceros a la izquierda, -0, +, decimales, exponentes, espacios, number) → INVALID_AMOUNT', () => {
    const digits = fc.bigInt({ min: 1n, max: MONEY_MAX_MINOR }).map(String);
    const nonCanonical = fc.oneof(
      digits.map((d) => `0${d}`),
      digits.map((d) => `-0${d}`),
      digits.map((d) => `+${d}`),
      digits.map((d) => `${d}.0`),
      digits.map((d) => `${d}e0`),
      digits.map((d) => ` ${d}`),
      digits.map((d) => `${d} `),
      digits.map((d) => `${d.slice(0, 1)},${d.slice(1)}`).filter((d) => d.endsWith(',') === false),
      fc.constantFrom('-0', '00', '', '-', '1_000', '0x10', 'NaN', 'Infinity'),
    );
    fc.assert(
      fc.property(nonCanonical, currency, (text, c) => {
        expect(moneyError(() => moneyFromJson({ amount_minor: text, currency: c }))).toBe('INVALID_AMOUNT');
      }),
    );
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double()), currency, (value, c) => {
        expect(moneyError(() => moneyFromJson({ amount_minor: value, currency: c }))).toBe('INVALID_AMOUNT');
      }),
    );
  });

  it('moneda fuera del catálogo cerrado → UNSUPPORTED_CURRENCY en of, parse y JSON', () => {
    const unsupported = fc.string({ maxLength: 6 }).filter((s) => !Object.hasOwn(CURRENCIES, s));
    fc.assert(
      fc.property(unsupported, (c) => {
        expect(moneyError(() => Money.of(1n, c))).toBe('UNSUPPORTED_CURRENCY');
        expect(moneyError(() => Money.parse('1', c))).toBe('UNSUPPORTED_CURRENCY');
        expect(moneyError(() => moneyFromJson({ amount_minor: '1', currency: c }))).toBe('UNSUPPORTED_CURRENCY');
      }),
      { examples: [['usd'], ['EUR'], [''], ['MXN ']] },
    );
  });

  it('parse rechaza más decimales que la escala con TOO_MANY_DECIMALS (nunca redondea en silencio)', () => {
    fc.assert(
      fc.property(money, fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 9 }), (m, extra, digit) => {
        const scale = CURRENCIES[m.currency].minorUnits;
        const base = m.format();
        const text = `${scale === 0 ? `${base}.` : base}${'0'.repeat(extra - 1)}${digit}`;
        expect(moneyError(() => Money.parse(text, m.currency))).toBe('TOO_MANY_DECIMALS');
      }),
    );
  });
});
