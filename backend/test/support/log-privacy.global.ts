import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPTURE_DIR_ENV, SENSITIVE_TEST_VALUES } from './log-capture.js';
import { formatLogPrivacyReport, scanCapturedLogs } from './log-privacy-scan.js';

/**
 * SC-009 · T102 (globalSetup de Vitest): crea el directorio de captura de esta ejecución y, al terminar TODA la suite,
 * comprueba que ningún valor sensible ficticio aparece en los logs capturados. Si aparece alguno, la ejecución falla y
 * el informe nombra el valor (por su nombre en el catálogo) y el archivo, nunca el valor.
 *
 * `KUOTA_LOG_PRIVACY_REPORT` (opcional): ruta donde escribir el informe (lo usa la autoverificación del gate).
 * `KUOTA_LOG_CAPTURE_KEEP=1` (opcional): conserva el directorio de captura para inspección local.
 */
export function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'kuota-log-capture-'));
  process.env[CAPTURE_DIR_ENV] = dir;
  return () => {
    try {
      const report = scanCapturedLogs(dir, SENSITIVE_TEST_VALUES);
      const text = formatLogPrivacyReport(report);
      const reportPath = process.env['KUOTA_LOG_PRIVACY_REPORT'];
      if (reportPath) writeFileSync(reportPath, `${JSON.stringify({ ...report, text })}\n`);
      if (report.leaks.length > 0) throw new Error(text);
      process.stdout.write(`${text}\n`);
    } finally {
      if (process.env['KUOTA_LOG_CAPTURE_KEEP'] !== '1') rmSync(dir, { recursive: true, force: true });
      delete process.env[CAPTURE_DIR_ENV];
    }
  };
}
