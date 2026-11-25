import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * Destino de logs por defecto (corrección de la prueba intermitente de `main-process.spec.ts`, T101 de 001).
 *
 * Al recibir SIGTERM, Nest ejecuta los hooks de apagado (que emiten `service.stopped`) y después se reenvía la señal con
 * `process.kill`, sin evento `exit`. Con el destino ASÍNCRONO por defecto de pino, una línea escrita mientras otra
 * escritura sigue en curso queda en un búfer de memoria que se vacía en un turno posterior del event loop: la señal mata
 * el proceso antes y la línea se pierde. El destino síncrono la escribe antes de volver.
 *
 * Cada caso reproduce ese mecanismo en un proceso real: una línea previa deja una escritura en curso, la segunda línea
 * se escribe en la misma cadena de microtareas y el proceso se envía SIGTERM a sí mismo, como hace Nest.
 */
const BACKEND_DIR = join(__dirname, '../../..');
const DESTINATION_MODULE = pathToFileURL(join(BACKEND_DIR, 'src/common/logging/log-destination.ts')).href;

async function lastLineSurvivesSignal(destination: 'app' | 'pino-default'): Promise<boolean> {
  const script = `
    import pino from 'pino';
    import { stdoutDestination } from ${JSON.stringify(DESTINATION_MODULE)};
    const logger = ${destination === 'app' ? 'pino({}, stdoutDestination())' : 'pino({})'};
    logger.info({ event: 'previous' }, 'linea previa');
    await Promise.resolve();
    logger.info({ event: 'service.stopped' }, 'ultima linea');
    process.kill(process.pid, 'SIGTERM');
  `;
  const run = promisify(execFile)(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', script],
    { cwd: BACKEND_DIR, env: { PATH: process.env['PATH'] } },
  );
  // El proceso termina por la señal: execFile rechaza con `signal: 'SIGTERM'` y conserva la salida.
  const result = await run.then(
    (ok) => ({ stdout: ok.stdout, signal: null as string | null }),
    (error: { stdout: string; signal: string | null }) => ({ stdout: error.stdout, signal: error.signal }),
  );
  expect(result.signal).toBe('SIGTERM');
  return result.stdout.includes('"event":"service.stopped"');
}

describe('destino de logs por defecto (apagado por señal)', () => {
  it('con el destino de la aplicación, la última línea antes de la señal llega siempre', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await lastLineSurvivesSignal('app')).toBe(true);
    }
  });

  it('control: con el destino asíncrono por defecto de pino, la misma línea se pierde (la prueba detecta el defecto)', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await lastLineSurvivesSignal('pino-default')).toBe(false);
    }
  });
});
