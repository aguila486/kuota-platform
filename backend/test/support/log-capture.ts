import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

/**
 * SC-009 · T102: captura de TODA la salida de logs de la suite del backend para comprobar, al final de la ejecución, que
 * ningún valor sensible ficticio aparece en ella.
 *
 * Tres fuentes acaban en el directorio `KUOTA_LOG_CAPTURE_DIR` (lo crea `log-privacy.global.ts`):
 *  1. Los streams en memoria de las pruebas (`logCapture()`), que sustituyen a los `Writable` ad hoc.
 *  2. La salida estándar y de error de cada worker de Vitest (`log-capture.setup.ts`): logs de apps sin stream propio.
 *  3. La salida de procesos hijos que las pruebas leen (`recordOutput`): `main.ts`, scripts de base de datos…
 *
 * Al terminar, `log-privacy.global.ts` busca en todo lo capturado los valores de `SENSITIVE_TEST_VALUES` y los que las
 * pruebas registran en tiempo de ejecución (`registerSensitiveValue`, p. ej. contraseñas de las bases efímeras).
 */

/** Nombre de la variable de entorno con el directorio de captura de esta ejecución. */
export const CAPTURE_DIR_ENV = 'KUOTA_LOG_CAPTURE_DIR';
/** Archivo del directorio de captura con los valores sensibles registrados en tiempo de ejecución (JSON por línea). */
export const RUNTIME_VALUES_FILE = 'sensitive-values.jsonl';
/** Prefijo de los archivos de salida capturada. */
export const CAPTURE_FILE_PREFIX = 'output-';

/**
 * Catálogo de valores sensibles ficticios conocidos que las pruebas envían al servicio (cuerpos, encabezados, URLs,
 * errores, configuración). Ninguno es un secreto real. Clave = nombre que se informa (nunca contiene el valor); valor =
 * texto que no debe aparecer.
 * Los que podrían confundirse con credenciales reales se construyen en tiempo de ejecución (como en T046).
 */
export const SENSITIVE_TEST_VALUES: Readonly<Record<string, string>> = {
  'contraseña en mensaje de error': 'hunter2',
  'contraseña de URL de base de datos': 'ficticio-secreto-db',
  'contraseña de URL inalcanzable (preflight)': 'ficticio-no-imprimir',
  'contraseña de URL (check-rls)': 'secreto-ficticio',
  'token del recolector de métricas': 'ficticio-token-recolector-0123456789abcdef',
  'token Bearer alternativo de métricas': 'otro-token-de-32-caracteres-xxxxxxxx',
  'token de URL y Bearer (auditoría, 404)': 'secreto-123',
  'token corto de métricas': 'secreto-corto',
  'JWT de ejemplo': ['eyJhbGciOiJIUzI1NiJ9', 'payload', 'signature'].join('.'),
  'token de http-log': 'FICTICIO-TOKEN-XYZ',
  'token de privacidad HTTP': 'FICTICIO-TOKEN-7f3a',
  'cookie de sesión': 'FICTICIA-SESION-91c2',
  'API key': ['FICTICIA', 'APIKEY', '55d0'].join('-'),
  'contraseña de cuerpo': 'FICTICIA-CLAVE-0042',
  'correo en URL de 404': 'persona@example.com',
  'correo en log de aplicación': 'ana@example.com',
  'correo de redacción': 'ana.perez@example.com',
  'correo en error de métricas': 'dato-sensible@example.com',
  'correo de privacidad HTTP': 'persona.ficticia@example.invalid',
  CURP: 'GODE561231HDFRRN09',
  RFC: 'GODE561231GR8',
  'IPv4 de cliente (privacidad HTTP)': '198.51.100.23',
  'IPv4 reenviada (privacidad HTTP)': '203.0.113.77',
  'IPv4 de cliente (http-log)': '203.0.113.7',
  'consulta de URL': 'CONSULTA-FICTICIA-a1b2',
  'cuerpo de solicitud': 'CUERPO-FICTICIO-d4e5',
  'dato arbitrario de encabezado': 'DATO-ARBITRARIO-c0ffee',
};

function captureDir(): string | undefined {
  return process.env[CAPTURE_DIR_ENV];
}

/** Archivo de captura de este proceso (uno por worker; `appendFileSync` mantiene el orden dentro del proceso). */
function captureFile(dir: string): string {
  return join(dir, `${CAPTURE_FILE_PREFIX}${process.pid}.log`);
}

/** Añade texto a la captura de la suite. Sin directorio de captura (Vitest sin `globalSetup`), no hace nada. */
export function recordOutput(text: string): void {
  const dir = captureDir();
  if (dir === undefined || text.length === 0) return;
  appendFileSync(captureFile(dir), text.endsWith('\n') ? text : `${text}\n`);
}

/**
 * Registra un valor sensible conocido solo en tiempo de ejecución (p. ej. la contraseña aleatoria de una base efímera)
 * para que la comprobación final también lo busque. Se guarda en el directorio temporal de captura, nunca en el repo.
 */
export function registerSensitiveValue(name: string, value: string): void {
  const dir = captureDir();
  if (dir === undefined || value.length < 6) return;
  appendFileSync(join(dir, RUNTIME_VALUES_FILE), `${JSON.stringify({ name, value })}\n`);
}

/** Stream de logs en memoria para una prueba: guarda el texto para sus aserciones y lo añade a la captura de la suite. */
export interface LogCapture {
  readonly stream: Writable;
  /** Texto escrito desde el último `reset()`. */
  text(): string;
  reset(): void;
}

export function logCapture(): LogCapture {
  let buffer = '';
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      const text = chunk.toString();
      buffer += text;
      recordOutput(text);
      done();
    },
  });
  return {
    stream,
    text: () => buffer,
    reset: () => {
      buffer = '';
    },
  };
}
