import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  Money,
  MONEY_ERROR_CODES,
  MoneyDecimal,
  MoneyError,
  moneyFromJson,
  moneyToJson,
  ROUNDING_MODES,
  type RoundingMode,
} from '../../../src/common/money/index.js';

/**
 * T057 (ADR-0007; R-09): ejecuta TODOS los casos de `contracts/fixtures/money/*.json`, valida los archivos contra el
 * esquema, compara el catálogo con `currencies.json` y prueba Money → JSON → Money sin pasar nunca por `number`.
 */
const DIR = join(__dirname, '../../../../contracts/fixtures/money');
const NON_FIXTURE_FILES = new Set(['fixture.schema.json', 'currencies.json']);

interface MoneyIn {
  amount_minor: string;
  currency: string;
}
interface FixtureCase {
  id: string;
  operation: 'add' | 'subtract' | 'multiply' | 'allocate' | 'parse' | 'format' | 'from_json';
  inputs: {
    a?: MoneyIn;
    b?: MoneyIn;
    factor?: string;
    parts?: number;
    ratios?: number[];
    text?: string;
    json?: MoneyIn;
  };
  rounding?: RoundingMode;
  expected?: MoneyIn | MoneyIn[] | string;
  expected_error?: string;
}

const read = (file: string): unknown => JSON.parse(readFileSync(join(DIR, file), 'utf8'));
const fixtureFiles = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && !NON_FIXTURE_FILES.has(f))
  .sort();
const cases: FixtureCase[] = fixtureFiles.flatMap((f) => (read(f) as { cases: FixtureCase[] }).cases);
const toMoney = (m: MoneyIn) => Money.of(BigInt(m.amount_minor), m.currency);

function run(c: FixtureCase): unknown {
  const { a, b, factor, parts, ratios, text, json } = c.inputs;
  switch (c.operation) {
    case 'add':
      return toMoney(a!).add(toMoney(b!));
    case 'subtract':
      return toMoney(a!).subtract(toMoney(b!));
    case 'multiply':
      return toMoney(a!).multiply(new MoneyDecimal(factor!), c.rounding);
    case 'allocate':
      return toMoney(a!).allocate(parts ?? ratios!);
    case 'parse':
      return Money.parse(text!, a!.currency);
    case 'format':
      return toMoney(a!).format();
    case 'from_json':
      return moneyFromJson(json);
  }
}

describe('fixtures de Money: archivos', () => {
  it('existen archivos de fixtures y todos cumplen fixture.schema.json', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
    // strictRequired es una advertencia de estilo de Ajv (un `required` dentro de `oneOf` que remite a propiedades
    // declaradas en el padre). Es JSON Schema válido; el resto del modo estricto sigue activo.
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    const validate = ajv.compile(read('fixture.schema.json') as object);
    for (const file of fixtureFiles) {
      const ok = validate(read(file));
      expect(ok, `${file}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it('el esquema rechaza fixtures defectuosos (la validación no es vacía)', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    const validate = ajv.compile(read('fixture.schema.json') as object);
    const ok = {
      id: 'ADD-901',
      operation: 'add',
      inputs: { a: { amount_minor: '1', currency: 'MXN' } },
      expected: { amount_minor: '1', currency: 'MXN' },
    };
    expect(validate({ schema_version: 1, cases: [ok] })).toBe(true);
    const broken: Array<[string, unknown]> = [
      ['monto como number', { ...ok, inputs: { a: { amount_minor: 1, currency: 'MXN' } } }],
      ['monto no canónico', { ...ok, inputs: { a: { amount_minor: '007', currency: 'MXN' } } }],
      ['id inválido', { ...ok, id: 'add-1' }],
      ['expected y expected_error a la vez', { ...ok, expected_error: 'INVALID_AMOUNT' }],
      ['sin expected ni expected_error', { id: ok.id, operation: ok.operation, inputs: ok.inputs }],
      ['error desconocido', { id: ok.id, operation: ok.operation, inputs: ok.inputs, expected_error: 'OTRO' }],
      ['propiedad extra en inputs', { ...ok, inputs: { ...ok.inputs, currency: 'MXN' } }],
    ];
    for (const [name, c] of broken) expect(validate({ schema_version: 1, cases: [c] }), name).toBe(false);
  });

  it('los identificadores de caso son únicos', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cubren lo que exige T056: operaciones, errores, modos con .5 ±, escalas 0/2/3/4 y bordes del dominio', () => {
    expect(new Set(cases.map((c) => c.operation))).toEqual(
      new Set(['add', 'subtract', 'multiply', 'allocate', 'parse', 'format', 'from_json']),
    );
    expect(new Set(cases.map((c) => c.expected_error).filter(Boolean))).toEqual(new Set(MONEY_ERROR_CODES));
    for (const mode of ROUNDING_MODES) {
      const half = cases.filter((c) => c.rounding === mode && c.inputs.factor === '0.1');
      expect(
        half.some((c) => c.inputs.a!.amount_minor.startsWith('-')),
        `${mode} negativo`,
      ).toBe(true);
      expect(
        half.some((c) => !c.inputs.a!.amount_minor.startsWith('-')),
        `${mode} positivo`,
      ).toBe(true);
    }
    const currencies = new Set(cases.flatMap((c) => [c.inputs.a?.currency, c.inputs.json?.currency]));
    for (const code of ['JPY', 'MXN', 'BHD', 'CLF']) expect(currencies.has(code), code).toBe(true);
    const fromJson = (amount: string) =>
      cases.find((c) => c.operation === 'from_json' && c.inputs.json?.amount_minor === amount);
    expect(fromJson('-9223372036854775807')?.expected).toBeDefined();
    expect(fromJson('9223372036854775807')?.expected).toBeDefined();
    expect(fromJson('-9223372036854775808')?.expected_error).toBe('AMOUNT_OUT_OF_RANGE');
    expect(fromJson('9223372036854775808')?.expected_error).toBe('AMOUNT_OUT_OF_RANGE');
    expect(fromJson('-0')?.expected_error).toBe('INVALID_AMOUNT');
    expect(fromJson('007')?.expected_error).toBe('INVALID_AMOUNT');
  });
});

describe('fixtures de Money: ejecución', () => {
  for (const c of cases) {
    it(`${c.id} ${c.operation}${c.rounding ? ` ${c.rounding}` : ''}`, () => {
      if (c.expected_error !== undefined) {
        let error: unknown;
        try {
          run(c);
        } catch (e) {
          error = e;
        }
        expect(error, 'se esperaba un error').toBeInstanceOf(MoneyError);
        expect((error as MoneyError).code).toBe(c.expected_error);
        return;
      }
      const result = run(c);
      if (typeof c.expected === 'string') expect(result).toBe(c.expected);
      else if (Array.isArray(c.expected)) expect((result as Money[]).map(moneyToJson)).toEqual(c.expected);
      else expect(moneyToJson(result as Money)).toEqual(c.expected);
    });
  }
});

describe('catálogo y Money → JSON → Money', () => {
  it('el catálogo del código coincide con contracts/fixtures/money/currencies.json', () => {
    const reference = (read('currencies.json') as { currencies: Array<{ code: string; minor_units: number }> })
      .currencies;
    const code = Object.entries(CURRENCIES).map(([c, v]) => ({ code: c, minor_units: v.minorUnits }));
    expect(code.sort((x, y) => x.code.localeCompare(y.code))).toEqual(reference);
  });

  it('todo monto válido de los fixtures hace ida y vuelta idéntica, como string, sin pasar por number', () => {
    const valid: MoneyIn[] = [];
    for (const c of cases) {
      for (const m of [
        c.inputs.a,
        c.inputs.b,
        ...(Array.isArray(c.expected) ? c.expected : typeof c.expected === 'object' ? [c.expected] : []),
      ]) {
        if (!m) continue;
        try {
          toMoney(m);
          valid.push(m);
        } catch {
          // fuera de dominio o moneda no soportada: no es un monto válido
        }
      }
    }
    const amounts = new Set(valid.map((m) => m.amount_minor));
    for (const required of ['0', '-9223372036854775807', '9223372036854775807', '9007199254740993']) {
      expect(amounts.has(required), required).toBe(true);
    }
    expect([...amounts].some((a) => a.startsWith('-'))).toBe(true);
    for (const m of valid) {
      const text = JSON.stringify(moneyToJson(toMoney(m)));
      expect(text).toBe(JSON.stringify({ amount_minor: m.amount_minor, currency: m.currency }));
      const back = moneyFromJson(JSON.parse(text));
      expect(back.amountMinor).toBe(BigInt(m.amount_minor));
      expect(typeof back.amountMinor).toBe('bigint');
      expect(back.currency).toBe(m.currency);
      expect(back.equals(toMoney(m))).toBe(true);
    }
  });
});
