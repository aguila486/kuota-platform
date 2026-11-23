import type { IncomingMessage, ServerResponse } from 'node:http';
import { routeTemplate, serializeHttpRequest } from '../logging/http-log.js';
import type { KuotaMetrics } from './kuota-metrics.js';

/**
 * Instrumentación HTTP (T094): se monta con `app.use` antes del enrutado, igual que el contexto de solicitud, para que
 * mida TODAS las respuestas, incluidas las rutas inexistentes (404) y los rechazos de guards, que un `NestInterceptor`
 * no ve. Al terminar la respuesta registra la duración con la plantilla de la ruta (la misma normalización que el log
 * de acceso: `routeTemplate`, nunca la URL), el método (lista cerrada) y el estado.
 */
export function httpMetricsMiddleware(
  metrics: KuotaMetrics,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.recordRequest(routeTemplate(req), serializeHttpRequest(req).method, res.statusCode, seconds);
    });
    next();
  };
}
