import type { IncomingMessage, ServerResponse } from 'node:http';
import { type DynamicModule, Module } from '@nestjs/common';
import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { CORRELATION_HEADER, correlationIdFor } from './correlation.js';
import { buildLoggerOptions, CLS_CORRELATION_ID } from './logger-options.js';

export interface LoggingModuleOptions {
  /** Destino alternativo (pruebas). Por defecto, stdout. */
  readonly stream?: DestinationStream;
}

function assignCorrelation(req: IncomingMessage, res: ServerResponse): string {
  const id = correlationIdFor(req);
  if (!res.headersSent) res.setHeader(CORRELATION_HEADER, id);
  return id;
}

/**
 * Logging estructurado (T019): nestjs-pino + nestjs-cls. Cada solicitud recibe un `correlation_id` (propagado o UUIDv7)
 * que se devuelve en `X-Correlation-Id`, se guarda en el CLS y aparece en todos sus logs; el contexto `module` viene del
 * logger de Nest; `tenant_id`/`actor_id` salen del CLS cuando el contexto autenticado los fija.
 */
/**
 * Middleware de contexto de solicitud (CLS + correlación) para montar con `app.use` antes del enrutado, de modo que
 * cubra todas las rutas, con o sin prefijo de versión.
 */
export function requestContextMiddleware(): ClsMiddleware['use'] {
  return new ClsMiddleware({
    setup: (cls, req: IncomingMessage, res: ServerResponse) => cls.set(CLS_CORRELATION_ID, assignCorrelation(req, res)),
  }).use;
}

@Module({})
export class LoggingModule {
  static forRoot(options: LoggingModuleOptions = {}): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        ClsModule.forRoot({
          global: true,
          // El middleware NO lo monta Nest: con el prefijo global `/v1`, Nest no lo aplicaría a las rutas excluidas
          // (`health/*`) y sus logs quedarían sin correlation_id. Lo monta `createApp` para todas las rutas.
          middleware: { mount: false },
        }),
        LoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => {
            const httpOptions = {
              ...buildLoggerOptions(config),
              genReqId: assignCorrelation,
              customAttributeKeys: { reqId: 'correlation_id' },
            };
            return {
              renameContext: 'module',
              pinoHttp: options.stream ? [httpOptions, options.stream] : httpOptions,
            };
          },
        }),
      ],
      exports: [LoggerModule],
    };
  }
}
