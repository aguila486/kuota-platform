import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURE_FILE_PREFIX, RUNTIME_VALUES_FILE } from './log-capture.js';

/** Una filtración: QUÉ valor del catálogo apareció (por nombre), dónde y cuántas veces. Nunca el valor. */
export interface LogLeak {
  readonly name: string;
  readonly file: string;
  readonly occurrences: number;
}

export interface LogPrivacyReport {
  readonly files: number;
  readonly bytes: number;
  readonly valuesChecked: number;
  readonly leaks: readonly LogLeak[];
}

/** Valores registrados en ejecución. Varios pueden compartir nombre (una contraseña por cada base efímera): todos cuentan. */
function runtimeValues(dir: string): Array<[string, string]> {
  const path = join(dir, RUNTIME_VALUES_FILE);
  if (!existsSync(path)) return [];
  const values = new Map<string, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const { name, value } = JSON.parse(line) as { name: string; value: string };
    values.set(value, `${name} (registrado en ejecución)`);
  }
  return [...values].map(([value, name]) => [name, value]);
}

function count(haystack: string, needle: string): number {
  let occurrences = 0;
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) {
    occurrences += 1;
  }
  return occurrences;
}

/**
 * Busca cada valor sensible (catálogo + registrados en ejecución) en todos los archivos capturados del directorio
 * (SC-009). Se comparan también las formas codificadas en URL y JSON, porque un valor puede llegar al log escapado.
 */
export function scanCapturedLogs(dir: string, catalog: Readonly<Record<string, string>>): LogPrivacyReport {
  const values: Array<[string, string]> = [...Object.entries(catalog), ...runtimeValues(dir)];
  const files = readdirSync(dir).filter((file) => file.startsWith(CAPTURE_FILE_PREFIX));
  const leaks: LogLeak[] = [];
  let bytes = 0;
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    bytes += Buffer.byteLength(text);
    for (const [name, value] of values) {
      const forms = new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]);
      const occurrences = [...forms].reduce((total, form) => total + count(text, form), 0);
      if (occurrences > 0) leaks.push({ name, file, occurrences });
    }
  }
  return { files: files.length, bytes, valuesChecked: values.length, leaks };
}

/** Texto del informe: nombres de los valores filtrados y archivos, nunca los valores. */
export function formatLogPrivacyReport(report: LogPrivacyReport): string {
  if (report.leaks.length === 0) {
    return `SC-009: 0 valores sensibles en ${report.bytes} bytes de logs capturados (${report.files} archivos, ${report.valuesChecked} valores comprobados)`;
  }
  const lines = report.leaks.map((leak) => `  - ${leak.name}: ${leak.occurrences} aparición(es) en ${leak.file}`);
  return [
    `SC-009: ${report.leaks.length} filtración(es) de valores sensibles ficticios en los logs de la suite:`,
    ...lines,
  ].join('\n');
}
