import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_VALUES_FILE, SENSITIVE_TEST_VALUES } from '../../support/log-capture.js';
import { formatLogPrivacyReport, scanCapturedLogs } from '../../support/log-privacy-scan.js';

/** SC-009 · T102: el escáner de la salida agregada detecta cada valor del catálogo y nunca lo imprime. */
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function workspace(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'kuota-scan-test-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('escáner de privacidad de logs (T102)', () => {
  it('salida limpia → sin filtraciones', () => {
    const report = scanCapturedLogs(
      workspace({ 'output-1.log': '{"level":"info","msg":"ok"}\n' }),
      SENSITIVE_TEST_VALUES,
    );
    expect(report.leaks).toEqual([]);
    expect(report.files).toBe(1);
    expect(formatLogPrivacyReport(report)).toMatch(/^SC-009: 0 valores sensibles/);
  });

  it('detecta CADA valor del catálogo, en texto plano, codificado en URL o escapado en JSON', () => {
    for (const [name, value] of Object.entries(SENSITIVE_TEST_VALUES)) {
      for (const form of [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]) {
        const report = scanCapturedLogs(
          workspace({ 'output-9.log': `{"msg":"x ${form} y"}\n` }),
          SENSITIVE_TEST_VALUES,
        );
        expect(
          report.leaks.map((leak) => leak.name),
          name,
        ).toContain(name);
        rmSync(dir, { recursive: true, force: true });
      }
    }
    dir = mkdtempSync(join(tmpdir(), 'kuota-scan-test-'));
  });

  it('busca también los valores registrados en ejecución y cuenta las apariciones por archivo', () => {
    const report = scanCapturedLogs(
      workspace({
        // Dos bases efímeras con el mismo nombre de valor: se buscan ambas contraseñas.
        [RUNTIME_VALUES_FILE]: [
          JSON.stringify({ name: 'clave efímera', value: 'Zx9-efimera-77' }),
          JSON.stringify({ name: 'clave efímera', value: 'Qw3-segunda-88' }),
          '',
        ].join('\n'),
        'output-1.log': 'a Zx9-efimera-77 b Zx9-efimera-77\n',
        'output-2.log': 'nada\n',
        'output-3.log': 'c Qw3-segunda-88\n',
        'otro.txt': 'Zx9-efimera-77 (no es un archivo de captura)\n',
      }),
      {},
    );
    expect(report.leaks).toEqual([
      { name: 'clave efímera (registrado en ejecución)', file: 'output-1.log', occurrences: 2 },
      { name: 'clave efímera (registrado en ejecución)', file: 'output-3.log', occurrences: 1 },
    ]);
    expect(report.files).toBe(3);
    expect(report.valuesChecked).toBe(2);
  });

  it('el informe nombra el valor y el archivo, pero nunca imprime ningún valor del catálogo', () => {
    const value = SENSITIVE_TEST_VALUES['contraseña en mensaje de error']!;
    const report = scanCapturedLogs(workspace({ 'output-3.log': `password=${value}\n` }), SENSITIVE_TEST_VALUES);
    const text = formatLogPrivacyReport(report);
    expect(text).toContain('contraseña en mensaje de error');
    expect(text).toContain('output-3.log');
    for (const [name, other] of Object.entries(SENSITIVE_TEST_VALUES)) {
      expect(name, name).not.toContain(other);
      expect(text, name).not.toContain(other);
    }
    expect(readFileSync(join(dir, 'output-3.log'), 'utf8')).toContain(value);
  });
});

describe('cobertura de la captura (T102)', () => {
  /** Archivos de prueba (.ts) bajo `test/`, salvo la propia captura. */
  function testSources(dir = join(__dirname, '../..')): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return testSources(path);
      return entry.name.endsWith('.ts') && entry.name !== 'log-capture.ts' ? [path] : [];
    });
  }

  it('todo stream de log en memoria y todo proceso hijo con salida leída envían su texto a la captura', () => {
    const offenders = testSources()
      .filter((path) => /new Writable\(|\bspawn\(/.test(readFileSync(path, 'utf8')))
      .filter((path) => !/recordOutput\(|logCapture\(/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
