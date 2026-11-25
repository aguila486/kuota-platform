import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';
import noUnsafeMoneyNumber from '../../../eslint-rules/no-unsafe-money-number.mjs';

/**
 * T104 (Aprobación 12, opción C; FR-021): regla tipada `kuota/no-unsafe-money-number`.
 *   1. Matriz de casos (test/fixtures/money-rule/): cada línea marcada `✗ <messageId>` produce exactamente esos errores y
 *      ninguna otra línea produce errores de la regla (sin falsos positivos en los casos legítimos).
 *   2. Configuración REAL: alcance por ruta y 0 errores sobre todo src/ (incluidos los 18 usos legítimos de number que
 *      la opción literal de T104 habría marcado).
 *   3. Mutaciones sobre la configuración real: archivos temporales en src/ con conversiones inseguras.
 */
const BACKEND_DIR = join(__dirname, '../../..');
const FIXTURES = 'test/fixtures/money-rule';
const RULE = 'kuota/no-unsafe-money-number';
const plugin = { rules: { 'no-unsafe-money-number': noUnsafeMoneyNumber } } as NonNullable<
  Linter.Config['plugins']
>[string];

function fixtureBlock(files: string, strictArithmetic: boolean, bigintIsMoney: boolean): Linter.Config {
  return {
    files: [`${FIXTURES}/${files}`],
    plugins: { kuota: plugin },
    rules: { [RULE]: ['error', { strictArithmetic, bigintIsMoney }] },
  };
}

const fixtureLinter = new ESLint({
  cwd: BACKEND_DIR,
  ignore: false,
  overrideConfig: [
    fixtureBlock('*-domain.ts', true, true),
    fixtureBlock('*-interface.ts', false, true),
    fixtureBlock('safe-timer.ts', false, false),
  ],
});
const realLinter = new ESLint({ cwd: BACKEND_DIR });

/** `línea:messageId` de cada error de la regla (repetidos incluidos). */
async function detected(linter: ESLint, file: string): Promise<string[]> {
  const [result] = await linter.lintFiles([join(BACKEND_DIR, file)]);
  const fatal = (result?.messages ?? []).filter((m) => m.fatal);
  expect(
    fatal.map((m) => m.message),
    file,
  ).toEqual([]);
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === RULE)
    .map((m) => `${m.line}:${m.messageId}`)
    .sort();
}

function expected(file: string): string[] {
  return readFileSync(join(BACKEND_DIR, file), 'utf8')
    .split('\n')
    .flatMap((text, index) => [...text.matchAll(/✗ (\w+)/g)].map((m) => `${index + 1}:${m[1]}`))
    .sort();
}

describe('regla tipada anti punto flotante (T104): matriz de casos', () => {
  for (const file of ['unsafe-interface.ts', 'unsafe-domain.ts']) {
    it(`${file}: cada caso inseguro marcado se detecta con su motivo, y nada más`, async () => {
      const marked = expected(`${FIXTURES}/${file}`);
      expect(marked.length).toBeGreaterThan(8);
      expect(await detected(fixtureLinter, `${FIXTURES}/${file}`)).toEqual(marked);
    }, 60_000);
  }

  for (const file of ['safe-domain.ts', 'safe-interface.ts', 'safe-timer.ts']) {
    it(`${file}: los usos legítimos de number no producen errores`, async () => {
      expect(expected(`${FIXTURES}/${file}`)).toEqual([]);
      expect(await detected(fixtureLinter, `${FIXTURES}/${file}`)).toEqual([]);
    }, 60_000);
  }
});

describe('regla tipada anti punto flotante (T104): configuración real', () => {
  it('alcance: aritmética estricta en money y domain; conversiones en todo src/ (interface, application, common)', async () => {
    const options = async (file: string) =>
      ((await realLinter.calculateConfigForFile(join(BACKEND_DIR, file))) as Linter.Config).rules?.[RULE];
    expect(await options('src/common/money/x.ts')).toEqual([2, { strictArithmetic: true }]);
    expect(await options('src/modules/loans/domain/x.ts')).toEqual([2, { strictArithmetic: true }]);
    expect(await options('src/modules/loans/interface/x.ts')).toEqual([2, { strictArithmetic: false }]);
    expect(await options('src/modules/loans/application/x.ts')).toEqual([2, { strictArithmetic: false }]);
    expect(await options('src/common/metrics/x.ts')).toEqual([2, { strictArithmetic: false }]);
  });

  it('todo src/ cumple la regla: 0 errores (sin falsos positivos sobre el código real)', async () => {
    const results = await realLinter.lintFiles([join(BACKEND_DIR, 'src')]);
    const findings = results.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === RULE).map((m) => `${r.filePath}:${m.line}`),
    );
    expect(findings).toEqual([]);
    expect(results.length).toBeGreaterThan(40);
  }, 120_000);
});

describe('regla tipada anti punto flotante (T104): mutaciones sobre la configuración real', () => {
  const created: string[] = [];
  afterAll(() => {
    for (const file of created) rmSync(file, { force: true });
  });

  const MUTATIONS: Array<[string, string, string, string[]]> = [
    [
      'DTO de interfaz que convierte el importe a number',
      'src/modules/dev-probe/interface/__t104_mutation__.ts',
      "import type { MoneyJson } from '../../../common/money/index.js';\nexport const toNumber = (m: MoneyJson): number => Number(m.amount_minor);\n",
      ['monetaryToNumber'],
    ],
    [
      'servicio de aplicación que oculta el importe tras un cast',
      'src/modules/dev-probe/application/__t104_mutation__.ts',
      "import type { Money } from '../../../common/money/index.js';\nexport const hide = (m: Money): number => m.amountMinor as unknown as number;\n",
      ['monetaryAssertion'],
    ],
    [
      'Money que redondea con Math sobre un number',
      'src/common/money/__t104_mutation__.ts',
      'export const fee = (base: number): number => Math.round(base * 0.16);\n',
      ['floatArithmetic', 'floatLiteral', 'mathInMoney'],
    ],
    [
      'dominio que crea un bigint desde un number recibido',
      'src/modules/dev-probe/domain/__t104_mutation__.ts',
      'export const minor = (amount: number): bigint => BigInt(amount);\n',
      ['unsafeBigInt'],
    ],
  ];

  for (const [name, file, code, messageIds] of MUTATIONS) {
    it(`${name} → ${messageIds.join(', ')}`, async () => {
      const path = join(BACKEND_DIR, file);
      created.push(path);
      writeFileSync(path, code);
      try {
        const [result] = await realLinter.lintFiles([path]);
        const found = (result?.messages ?? []).filter((m) => m.ruleId === RULE).map((m) => m.messageId);
        expect([...new Set(found)].sort()).toEqual([...messageIds].sort());
        expect(result?.errorCount).toBeGreaterThan(0);
      } finally {
        rmSync(path, { force: true });
      }
    }, 60_000);
  }
});
