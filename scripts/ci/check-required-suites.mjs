// Comprueba en el informe JSON de Vitest que se ejecutaron todas las suites obligatorias, sin omisiones (T048).
// Falla si: falta una suite de scripts/ci/required-suites.txt, una suite obligatoria no tiene pruebas aprobadas, hay
// pruebas fallidas, o hay pruebas omitidas (skip, todo, only) en cualquier suite: una suite saltada no es un PASS.
// Uso: node scripts/ci/check-required-suites.mjs <informe-vitest.json> <required-suites.txt>
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const required = readFileSync(process.argv[3], 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));
const problems = [];
const byFile = new Map();
for (const file of report.testResults ?? []) {
  const relative = file.name.replace(/\\/g, '/').replace(/^.*\/backend\//, '');
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const test of file.assertionResults ?? []) {
    if (test.status === 'passed') counts.passed++;
    else if (test.status === 'failed') counts.failed++;
    else counts.skipped++;
  }
  byFile.set(relative, counts);
  if (counts.failed > 0) problems.push(`${relative}: ${counts.failed} prueba(s) fallidas`);
  if (counts.skipped > 0) problems.push(`${relative}: ${counts.skipped} prueba(s) omitidas (skip/todo/only)`);
  if (file.status === 'failed' && counts.failed === 0) problems.push(`${relative}: la suite falló al cargarse`);
}
for (const suite of required) {
  const counts = byFile.get(suite);
  if (!counts) problems.push(`${suite}: suite obligatoria NO ejecutada`);
  else if (counts.passed === 0) problems.push(`${suite}: suite obligatoria sin pruebas aprobadas`);
}
const total = [...byFile.values()].reduce((sum, c) => sum + c.passed, 0);
if (problems.length > 0) {
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`required-suites: ${required.length} suites obligatorias ejecutadas; ${byFile.size} archivos, ${total} pruebas aprobadas, 0 omitidas`);
