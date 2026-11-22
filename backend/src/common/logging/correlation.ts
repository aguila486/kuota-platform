import { randomUUIDv7 } from 'node:crypto';

/** Encabezado de correlación (contrato: `X-Correlation-Id`, UUID). Los encabezados de Node llegan en minúsculas. */
export const CORRELATION_HEADER = 'x-correlation-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORRELATION_KEY = Symbol('kuota.correlationId');

/** Usa el UUID recibido (normalizado a minúsculas) o genera un UUIDv7. Nunca refleja un valor que no sea UUID. */
export function resolveCorrelationId(header: unknown): string {
  return typeof header === 'string' && UUID.test(header) ? header.toLowerCase() : randomUUIDv7();
}

interface CorrelatedRequest {
  headers: Record<string, string | string[] | undefined>;
  [CORRELATION_KEY]?: string;
}

/** Identificador de correlación de la solicitud; se calcula una sola vez para que CLS, logs y respuesta coincidan. */
export function correlationIdFor(req: object): string {
  const request = req as CorrelatedRequest;
  request[CORRELATION_KEY] ??= resolveCorrelationId(request.headers[CORRELATION_HEADER]);
  return request[CORRELATION_KEY];
}
