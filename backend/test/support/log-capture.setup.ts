import fs from 'node:fs';
import { recordOutput } from './log-capture.js';

/**
 * SC-009 · T102 (setupFiles de Vitest): en cada worker, copia a la captura de la suite todo lo que se escribe en la salida
 * estándar y de error. Así quedan cubiertos los logs de apps creadas sin stream propio, que pino escribe directamente en
 * los descriptores 1 y 2 (`fs.writeSync`/`fs.write` de sonic-boom), y cualquier `process.stdout.write`.
 * Se instala una sola vez por proceso; no cambia lo que se escribe.
 */
const INSTALLED = Symbol.for('kuota.logCapture.installed');
const globals = globalThis as { [INSTALLED]?: true };

function textOf(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return Buffer.from(data).toString('utf8');
  return '';
}

if (!globals[INSTALLED]) {
  globals[INSTALLED] = true;

  const writeSync = fs.writeSync;
  fs.writeSync = function patchedWriteSync(fd: number, data: unknown, ...rest: unknown[]) {
    if (fd === 1 || fd === 2) recordOutput(textOf(data));
    return (writeSync as (...args: unknown[]) => number).call(fs, fd, data, ...rest);
  };

  const write = fs.write;
  fs.write = function patchedWrite(fd: number, data: unknown, ...rest: unknown[]) {
    if (fd === 1 || fd === 2) recordOutput(textOf(data));
    return (write as (...args: unknown[]) => void).call(fs, fd, data, ...rest);
  } as typeof fs.write;

  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = (chunk: unknown, ...rest: unknown[]) => {
      recordOutput(textOf(chunk));
      return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
  }
}
