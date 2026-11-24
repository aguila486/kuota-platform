import pino, { type DestinationStream } from 'pino';

/**
 * Destino por defecto de los logs: stdout SÍNCRONO.
 *
 * Al recibir SIGTERM, Nest ejecuta los hooks de apagado (`service.stopped`, T101) y se reenvía la señal con
 * `process.kill`, sin evento `exit`. El destino asíncrono por defecto de pino deja en memoria una línea escrita mientras
 * otra escritura sigue en curso, y la vacía en un turno posterior: la señal mata el proceso antes y la línea se pierde
 * (causa de la intermitencia de `main-process.spec.ts`). La escritura síncrona termina antes de volver.
 * Prueba: `test/unit/logging/log-destination.spec.ts`.
 */
export function stdoutDestination(): DestinationStream {
  return pino.destination({ dest: 1, sync: true });
}
