import { join } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/**
 * T064 (R-10; Constitución IV; ADR-0007): la regla anti punto flotante de la configuración REAL de ESLint, sobre código
 * virtual en las rutas protegidas. (El archivo defectuoso de referencia y el script de CI son T060 y T065.)
 */
const BACKEND_DIR = join(__dirname, '../../..');
const eslint = new ESLint({
  cwd: BACKEND_DIR,
  overrideConfig: [{ files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked }],
});

async function messages(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(BACKEND_DIR, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}
const MONEY_FILE = 'src/common/money/virtual.ts';
const DOMAIN_FILE = 'src/modules/loans/domain/virtual.ts';

const FORBIDDEN: Record<string, string> = {
  'parámetro amount: number': 'export function f(amount: number): void { void amount; }\n',
  'variable feeTotal: number': 'export const feeTotal: number = 0;\n',
  'propiedad de interfaz balance: number': 'export interface X { balance: number }\n',
  'propiedad de tipo amountMinor: number | null': 'export type T = { amountMinor: number | null };\n',
  'propiedad de clase interestRate: number': 'export class Y { interestRate: number = 0; }\n',
  'parámetro de constructor money: number': 'export class Z { constructor(readonly money: number) {} }\n',
  'arreglo amounts: number[]': 'export function g(amounts: number[]): void { void amounts; }\n',
  parseFloat: "export const v = parseFloat('1.5');\n",
  'Number.parseFloat': "export const v = Number.parseFloat('1.5');\n",
  'Number(…)': "export const v = Number('1');\n",
  'new Number(…)': 'export const v = new Number(1);\n',
  toFixed: 'declare const x: { toFixed(n: number): string };\nexport const v = x.toFixed(2);\n',
  'Math.round': 'export const v = Math.round(1.5);\n',
};

describe('regla anti punto flotante (T064)', () => {
  for (const [name, code] of Object.entries(FORBIDDEN)) {
    it(`rechaza en Money y en domain/: ${name}`, async () => {
      for (const file of [MONEY_FILE, DOMAIN_FILE]) {
        const found = await messages(code, file);
        expect(
          found.some((m) => m.startsWith('Prohibido punto flotante')),
          `${file}: ${found.join(' | ')}`,
        ).toBe(true);
      }
    });
  }

  it('permite bigint para montos y number para conteos, y Number.isSafeInteger/BigInt', async () => {
    const code =
      "export function f(amount: bigint, parts: number): bigint { return Number.isSafeInteger(parts) ? amount + BigInt('1') : amount; }\n";
    expect(await messages(code, MONEY_FILE)).toEqual([]);
    expect(await messages(code, DOMAIN_FILE)).toEqual([]);
  });

  it('no aplica fuera de common/money y domain/ (R-10 fija esas rutas)', async () => {
    expect(await messages(FORBIDDEN['parámetro amount: number']!, 'src/modules/loans/application/virtual.ts')).toEqual(
      [],
    );
  });

  it('las restricciones de seguridad (P2, T038) siguen activas en esas rutas', async () => {
    const found = await messages(
      "export const sql = 'SELECT set_config(1)';\ndeclare const cls: any;\ncls.set('tenantId', 'x');\n",
      MONEY_FILE,
    );
    expect(found.some((m) => m.includes('ADR-0004, condición P2'))).toBe(true);
    expect(found.some((m) => m.includes('T038'))).toBe(true);
  });
});
