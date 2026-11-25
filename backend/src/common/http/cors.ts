import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { AppConfig } from '../config/app-config.js';

/**
 * Política CORS de Kuota Core (Aprobación 8). Solo concede a los orígenes exactos de `KUOTA_CORS_ALLOWED_ORIGINS` lo
 * que las apps usan del contrato `client` (hoy, `GET`), sin credenciales. CORS es una protección del NAVEGADOR: no
 * sustituye la autenticación ni la autorización, y un cliente que no es navegador no la aplica.
 *
 * - Origen permitido: `Access-Control-Allow-Origin` con ese origen exacto (más `Vary: Origin`), también en errores.
 * - Origen no permitido: ninguna cabecera `Access-Control-Allow-Origin`; el navegador no deja leer la respuesta ni
 *   supera el preflight.
 * - Preflight `OPTIONS`: 204 con los métodos y encabezados permitidos; el navegador rechaza cualquier otro.
 */
export const CORS_ALLOWED_METHODS: readonly string[] = ['GET'];
/** Encabezados no "simples" que envían las apps (contrato: parámetros `X-Correlation-Id` y `X-App-Version`). */
export const CORS_ALLOWED_HEADERS: readonly string[] = ['X-Correlation-Id', 'X-App-Version'];
/** Encabezados de respuesta que la app puede leer (correlación para soporte). */
export const CORS_EXPOSED_HEADERS: readonly string[] = ['X-Correlation-Id'];
/** Caché del preflight en el navegador (s). */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Opciones para `app.enableCors`, o `undefined` si no hay orígenes permitidos (CORS desactivado). */
export function corsOptionsFor(config: Pick<AppConfig, 'cors'>): CorsOptions | undefined {
  const origins = config.cors.allowedOrigins;
  if (origins.length === 0) return undefined;
  return {
    // Lista de cadenas: comparación EXACTA con `Origin`; nunca se refleja un origen que no esté en la lista.
    origin: [...origins],
    methods: [...CORS_ALLOWED_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
    credentials: false,
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };
}
