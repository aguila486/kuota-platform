import type { IncomingMessage, ServerResponse } from 'node:http';
import { type INestApplication, NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import type { AppConfig } from './common/config/app-config.js';
import { ProblemDetailsFilter } from './common/errors/problem.filter.js';
import { corsOptionsFor } from './common/http/cors.js';
import { requestContextMiddleware } from './common/logging/logging.module.js';
import { httpMetricsMiddleware } from './common/metrics/http-metrics.js';
import { MetricsRuntime } from './common/metrics/metrics.module.js';

/** Prefijo de las rutas versionadas (contrato v1). Las sondas `health/*` no se versionan. */
export const API_PREFIX = 'v1';
const UNVERSIONED_ROUTES = ['health/{*path}'];

/** Crea la aplicación Nest configurada (T025). La usan `main.ts` y las pruebas de integración del bootstrap. */
export async function createApp(config: AppConfig, options: AppModuleOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config, options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(requestContextMiddleware());
  // Métricas HTTP (T094): todas las respuestas, incluidas 404 y rechazos de guards, por plantilla de ruta.
  app.use(httpMetricsMiddleware(app.get(MetricsRuntime).metrics));
  // CORS (Aprobación 8): solo orígenes exactos configurados; sin lista, sin CORS (el navegador bloquea).
  const cors = corsOptionsFor(config);
  if (cors) app.enableCors(cors);
  app.setGlobalPrefix(API_PREFIX, { exclude: UNVERSIONED_ROUTES });
  // No revelar el framework en las cabeceras de respuesta.
  (app.getHttpAdapter().getInstance() as { disable(setting: string): void }).disable('x-powered-by');
  app.enableShutdownHooks();
  // H3 (FR-011): con el prefijo global, Nest solo monta su manejador 404 bajo `/v1` y en las rutas excluidas; el resto
  // (p. ej. `/metrics` o `/foo` en el puerto de la API) caía en el 404 HTML de Express. Tras `init()` (rutas y 404 de
  // Nest ya registrados), un último recurso responde con el mismo filtro problem+json: `not-found`, correlación, log y
  // métrica. No cambia el contrato: `not-found` ya es un código del contrato.
  await app.init();
  const notFound = new ProblemDetailsFilter(app.get(MetricsRuntime));
  (
    app.getHttpAdapter().getInstance() as { use(handler: (req: IncomingMessage, res: ServerResponse) => void): void }
  ).use((req, res) => notFound.respond(new NotFoundException(), req, res));
  return app;
}
