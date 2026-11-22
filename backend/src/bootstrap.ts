import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import type { AppConfig } from './common/config/app-config.js';

/** Prefijo de las rutas versionadas (contrato v1). Las sondas `health/*` no se versionan. */
export const API_PREFIX = 'v1';
const UNVERSIONED_ROUTES = ['health/{*path}'];

/** Crea la aplicación Nest configurada (T025). La usan `main.ts` y las pruebas de integración del bootstrap. */
export async function createApp(config: AppConfig, options: AppModuleOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config, options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX, { exclude: UNVERSIONED_ROUTES });
  // No revelar el framework en las cabeceras de respuesta.
  (app.getHttpAdapter().getInstance() as { disable(setting: string): void }).disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
