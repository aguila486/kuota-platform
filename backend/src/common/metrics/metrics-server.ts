import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppConfig } from '../config/app-config.js';
import type { KuotaMetrics } from './kuota-metrics.js';

export const METRICS_PATH = '/metrics';

/** Comparación en tiempo constante (R-21): se comparan resúmenes SHA-256 para no revelar la longitud del token. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(match?.[1] ?? ''), digest(token)) && match !== null;
}

function reply(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end();
}

/**
 * Escucha de métricas, separada del puerto de la API (T094; FR-039, FR-040; tabla Endpoint Access):
 * - solo `GET /metrics` (otra ruta → 404; otro método → 405);
 * - con `KUOTA_METRICS_TOKEN` configurado, exige `Authorization: Bearer <token>` (tiempo constante) ANTES de delegar en
 *   el exportador; sin él o con otro → 401. Sin token solo es posible en local/testing con escucha de loopback
 *   (guard de arranque de `loadConfig`, T016), donde la credencial es opcional según la tabla Endpoint Access;
 * - sin cuerpos de error ni detalles internos.
 */
export function createMetricsServer(metrics: KuotaMetrics, token: string | undefined): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== METRICS_PATH) return reply(res, 404);
    if (token !== undefined && !bearerMatches(req.headers.authorization, token)) {
      return reply(res, 401, { 'www-authenticate': 'Bearer' });
    }
    if (req.method !== 'GET') return reply(res, 405, { allow: 'GET' });
    metrics.serve(req, res);
  });
}

/** Arranca la escucha en `KUOTA_METRICS_HOST:KUOTA_METRICS_PORT` (o en el puerto dado, p. ej. 0 en pruebas). */
export async function listenMetrics(
  metrics: KuotaMetrics,
  config: Pick<AppConfig, 'metrics'>,
  port: number = config.metrics.port,
): Promise<{ server: Server; port: number }> {
  const server = createMetricsServer(metrics, config.metrics.token);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.metrics.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return { server, port: (server.address() as AddressInfo).port };
}
