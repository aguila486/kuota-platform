// Evalúa la salida JSON de osv-scanner (T048, FR-035; R-17): falla si algún grupo de vulnerabilidades tiene severidad
// máxima >= 7.0 (alta o crítica, CVSS) o no tiene severidad clasificable (no se puede descartar que sea alta). Las
// moderadas y bajas se informan sin bloquear. Uso: node scripts/ci/osv-gate.mjs <resultado.json>
import { readFileSync } from 'node:fs';

const HIGH = 7.0;
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let blocking = 0;
let advisory = 0;
for (const result of report.results ?? []) {
  for (const pkg of result.packages ?? []) {
    for (const group of pkg.groups ?? []) {
      const score = Number.parseFloat(group.max_severity ?? '');
      const level = Number.isNaN(score) ? 'SIN SEVERIDAD' : score >= HIGH ? 'ALTA/CRÍTICA' : 'MODERADA/BAJA';
      const blocks = Number.isNaN(score) || score >= HIGH;
      if (blocks) blocking++;
      else advisory++;
      console.log(
        `  ${blocks ? '✗' : '!'} ${pkg.package.name}@${pkg.package.version} ${group.ids.join(',')} — ${level}${Number.isNaN(score) ? '' : ` (${score})`}`,
      );
    }
  }
}
console.log(`osv-gate: ${blocking} bloqueante(s), ${advisory} informativa(s)`);
process.exit(blocking > 0 ? 1 : 0);
