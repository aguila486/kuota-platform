import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Logging HTTP mínimo por lista permitida (hotfix de privacidad, 2026-11-23; FR-009, FR-010, R-15).
 *
 * pino-http crea por solicitud un logger hijo con `{ req }`, y al terminar escribe `{ res, err?, responseTime }`. Los
 * serializadores por defecto copian la URL con query string, `query`, `params`, TODOS los encabezados, `remoteAddress` y
 * `remotePort`, y eso aparece en el log de acceso y en cada log de la aplicación dentro de la solicitud. Aquí se
 * construye cada objeto desde cero con campos permitidos; nada de la solicitud se copia por defecto, de modo que un
 * encabezado o metadato nuevo no puede filtrarse.
 *
 * Permitido: `req.method`, `res.statusCode`, `route` (plantilla registrada, sin valores ni query), `responseTime`,
 * `correlation_id` y la categoría del error (`err.type`). Prohibido: IP, puertos, encabezados, URL cruda, query,
 * parámetros, cuerpos y el objeto de error de pino-http.
 */

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/** Valor de `route` cuando la solicitud no coincidió con ninguna ruta registrada (404) o no hay plantilla fiable. */
export const UNMATCHED_ROUTE = 'unmatched';
// Una plantilla registrada solo usa estos caracteres (p. ej. `/v1/dev/probe-items/:id`, `/health/{*path}`).
const TEMPLATE = /^\/[A-Za-z0-9/_:{}*.-]{0,200}$/;

interface RoutedRequest {
  readonly method?: unknown;
  readonly id?: unknown;
  readonly route?: { readonly path?: unknown };
}

/** `req` → solo el método HTTP (valores desconocidos se agrupan como `OTHER`). */
export function serializeHttpRequest(req: unknown): { method: string } {
  const method = (req as RoutedRequest | null)?.method;
  return { method: typeof method === 'string' && METHODS.has(method) ? method : 'OTHER' };
}

/** `res` → solo el código de estado. */
export function serializeHttpResponse(res: unknown): { statusCode: number | null } {
  const status = (res as { statusCode?: unknown } | null)?.statusCode;
  return { statusCode: typeof status === 'number' ? status : null };
}

/**
 * Plantilla de la ruta que atendió la solicitud (la registrada en el router, p. ej. `/v1/dev/probe-items/:id`), nunca la
 * URL de la solicitud: así no se registran identificadores ni query strings. Sin plantilla fiable → `unmatched`.
 */
export function routeTemplate(req: unknown): string {
  const path = (req as RoutedRequest | null)?.route?.path;
  return typeof path === 'string' && TEMPLATE.test(path) ? path : UNMATCHED_ROUTE;
}

function correlation(req: unknown): Record<string, string> {
  const id = (req as RoutedRequest | null)?.id;
  return typeof id === 'string' ? { correlation_id: id } : {};
}

/** Objeto del log de acceso de una respuesta correcta (`customSuccessObject` de pino-http). */
export function httpSuccessObject(req: IncomingMessage, _res: ServerResponse, value: object): object {
  return { ...value, ...correlation(req), route: routeTemplate(req) };
}

/**
 * Objeto del log de acceso de una respuesta fallida (`customErrorObject`): sustituye el error de pino-http por su
 * categoría. El detalle saneado lo registra `ProblemDetailsFilter` con la misma correlación.
 */
export function httpErrorObject(req: IncomingMessage, _res: ServerResponse, error: Error, value: object): object {
  return {
    ...value,
    ...correlation(req),
    route: routeTemplate(req),
    err: { type: typeof error?.name === 'string' ? error.name : 'Error' },
  };
}
