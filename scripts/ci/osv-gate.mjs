// Evalúa la salida JSON de osv-scanner (T048, FR-035; R-17): falla si algún grupo de vulnerabilidades tiene severidad
// máxima >= 7.0 (alta o crítica, CVSS) o no tiene severidad clasificable (no se puede descartar que sea alta). Las
// moderadas y bajas se informan sin bloquear.
//
// Falla en cerrado (SEC-2026-001): un informe que no tenga la estructura esperada no se interpreta como "sin hallazgos".
//   - El informe debe ser un objeto con `results` como lista; cada resultado, con `packages` como lista; cada paquete,
//     con nombre, versión y `vulnerabilities`/`groups` como listas cuando existan.
//   - Toda vulnerabilidad de un paquete debe pertenecer a algún grupo; una vulnerabilidad sin grupo bloquea.
//   - Con el código de salida del scanner (segundo argumento), se exige coherencia: salida 1 (hay vulnerabilidades) sin
//     ningún hallazgo, o salida 0 con hallazgos, es un informe inválido.
// Uso: node scripts/ci/osv-gate.mjs <resultado.json> [código-de-salida-del-scanner]
// Salida: 0 sin bloqueantes; 1 con bloqueantes; 2 informe inválido o incoherente.
import { readFileSync } from 'node:fs';

const HIGH = 7.0;
const invalid = (reason) => {
  console.log(`  ✗ informe de osv-scanner inválido: ${reason}`);
  console.log('osv-gate: informe inválido (no se interpreta como aprobado)');
  process.exit(2);
};

let report;
try {
  report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
} catch (error) {
  invalid(`no se pudo leer como JSON (${error.message})`);
}
const scannerExit = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
const isList = Array.isArray;
if (report === null || typeof report !== 'object' || isList(report)) invalid('no es un objeto');
if (!isList(report.results)) invalid('falta la lista `results`');

let blocking = 0;
let advisory = 0;
for (const result of report.results) {
  if (result === null || typeof result !== 'object' || !isList(result.packages)) invalid('resultado sin lista `packages`');
  for (const pkg of result.packages) {
    const name = pkg?.package?.name;
    const version = pkg?.package?.version;
    if (typeof name !== 'string' || typeof version !== 'string') invalid('paquete sin nombre o versión');
    const vulnerabilities = pkg.vulnerabilities ?? [];
    const groups = pkg.groups ?? [];
    if (!isList(vulnerabilities) || !isList(groups)) invalid(`${name}@${version}: vulnerabilities/groups no son listas`);
    const grouped = new Set();
    for (const group of groups) {
      if (!isList(group?.ids) || group.ids.length === 0) invalid(`${name}@${version}: grupo sin identificadores`);
      for (const id of [...group.ids, ...(isList(group.aliases) ? group.aliases : [])]) grouped.add(id);
      const score = Number.parseFloat(group.max_severity ?? '');
      const level = Number.isNaN(score) ? 'SIN SEVERIDAD' : score >= HIGH ? 'ALTA/CRÍTICA' : 'MODERADA/BAJA';
      const blocks = Number.isNaN(score) || score >= HIGH;
      if (blocks) blocking++;
      else advisory++;
      console.log(
        `  ${blocks ? '✗' : '!'} ${name}@${version} ${group.ids.join(',')} — ${level}${Number.isNaN(score) ? '' : ` (${score})`}`,
      );
    }
    for (const vulnerability of vulnerabilities) {
      if (typeof vulnerability?.id !== 'string') invalid(`${name}@${version}: vulnerabilidad sin identificador`);
      if (!grouped.has(vulnerability.id)) {
        blocking++;
        console.log(`  ✗ ${name}@${version} ${vulnerability.id} — SIN GRUPO (no se puede clasificar su severidad)`);
      }
    }
  }
}
const findings = blocking + advisory;
if (scannerExit === 1 && findings === 0) invalid('el scanner indicó vulnerabilidades (salida 1) y el informe no contiene ninguna');
if (scannerExit === 0 && findings > 0) invalid('el scanner indicó que no hay vulnerabilidades (salida 0) y el informe contiene hallazgos');
console.log(`osv-gate: ${blocking} bloqueante(s), ${advisory} informativa(s)`);
process.exit(blocking > 0 ? 1 : 0);
