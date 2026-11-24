/**
 * Verificación de la regla anti punto flotante de TypeScript (T065; R-10; Constitución IV; ADR-0007).
 *
 * Analiza el archivo defectuoso de referencia (T060, `test/fixtures/float-violation.ts.txt`) con la configuración REAL
 * de ESLint, como si estuviera en cada ruta protegida (`src/common/money/**` y `src/**\/domain/**`), y EXIGE que cada
 * línea marcada con `ANTI-FLOAT` produzca el error de la regla. Falla si:
 *   - alguna línea marcada no se detecta (la regla se debilitó o se excluyó la ruta);
 *   - el archivo no tiene líneas marcadas (la prueba no probaría nada);
 *   - ESLint no puede analizarlo (error fatal).
 * El análisis de tipos se desactiva solo para este archivo virtual (no pertenece al proyecto de TypeScript); la regla
 * anti-float es sintáctica y no lo necesita.
 *
 * Uso (desde backend/): node scripts/check-no-float.ts [archivo-defectuoso]   (por defecto, el de T060)
 * Salida: 0 si se detectan todas las infracciones; 1 en cualquier otro caso.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

// CommonJS (como migration-preflight.ts): sin import.meta; se ejecuta desde backend/ (check-no-float.sh lo garantiza).
const BACKEND_DIR = process.cwd();
const FIXTURE = resolve(process.argv[2] ?? join(BACKEND_DIR, 'test/fixtures/float-violation.ts.txt'));
const MARKER = 'ANTI-FLOAT';
const FLOAT_MESSAGE_PREFIX = 'Prohibido punto flotante';
const PROTECTED_PATHS = [
  'src/common/money/__float-violation__.ts',
  'src/modules/__float-check__/domain/__float-violation__.ts',
];

const source = readFileSync(FIXTURE, 'utf8');
const marked = source
  .split('\n')
  .map((text, index) => ({ line: index + 1, text }))
  .filter(({ text }) => text.includes(MARKER) && !text.trimStart().startsWith('//'));

async function main(): Promise<number> {
  const eslint = new ESLint({
    cwd: BACKEND_DIR,
    overrideConfig: [
      { files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked },
      // Archivos virtuales sin información de tipos: la regla tipada de T104 no puede ejecutarse aquí y la cubre
      // test/unit/money/typed-money-rule.spec.ts con la configuración real.
      { files: ['src/**/*.ts'], rules: { 'kuota/no-unsafe-money-number': 'off' } },
    ],
  });

  let failures = 0;
  if (marked.length === 0) {
    console.log(`  ✗ ${FIXTURE}: no hay líneas marcadas con ${MARKER}; la verificación no probaría nada`);
    failures++;
  }
  for (const path of PROTECTED_PATHS) {
    const [result] = await eslint.lintText(source, { filePath: join(BACKEND_DIR, path) });
    const messages = result?.messages ?? [];
    const fatal = messages.filter((m) => m.fatal);
    if (fatal.length > 0) {
      console.log(`  ✗ ${path}: ESLint no pudo analizar el archivo (${fatal.map((m) => m.message).join('; ')})`);
      failures++;
      continue;
    }
    const detected = new Set(
      messages
        .filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.startsWith(FLOAT_MESSAGE_PREFIX))
        .map((m) => m.line),
    );
    for (const { line, text } of marked) {
      if (detected.has(line)) {
        console.log(`  ✓ ${path}:${line} rechazado — ${text.split(MARKER)[1]?.replace(/^:\s*/, '') ?? ''}`);
      } else {
        console.log(`  ✗ ${path}:${line} NO detectado por la regla anti-float: ${text.trim()}`);
        failures++;
      }
    }
  }
  console.log(
    failures === 0
      ? `check-no-float: las ${marked.length} infracciones de referencia se rechazan en ${PROTECTED_PATHS.length} rutas protegidas`
      : `check-no-float: ${failures} fallo(s): la regla anti punto flotante no rechaza el archivo defectuoso`,
  );
  return failures === 0 ? 0 : 1;
}

if (!existsSync(join(BACKEND_DIR, 'eslint.config.mjs'))) {
  console.log(`  ✗ ejecuta este script desde backend/ (no hay eslint.config.mjs en ${BACKEND_DIR})`);
  process.exit(1);
}
main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`  ✗ check-no-float: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
