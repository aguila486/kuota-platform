// T104: fuera de money/domain/modules, un bigint que no tiene origen monetario (temporizador) no es dinero.
export function duracion(inicio: bigint): number {
  return Number(process.hrtime.bigint() - inicio) / 1e9;
}
