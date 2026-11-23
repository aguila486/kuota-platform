import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { DestinationStream } from 'pino';
import { type AppConfig, devTenantContextEnabled } from './common/config/app-config.js';
import { ConfigModule } from './common/config/config.module.js';
import { ProblemDetailsFilter } from './common/errors/problem.filter.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { TenantContextModule } from './common/tenant-context/tenant-context.module.js';
import { DEV_ONLY_MODULES } from './dev-modules.js';
import { HealthModule } from './modules/health/health.module.js';
import { MetaModule } from './modules/meta/meta.module.js';

export interface AppModuleOptions {
  /** Módulos de desarrollo candidatos; por defecto `DEV_ONLY_MODULES`. Solo se registran si `devModulesEnabled`. */
  readonly devModules?: ReadonlyArray<Type | DynamicModule>;
  /** Módulos adicionales (solo pruebas de integración del bootstrap). */
  readonly modules?: ReadonlyArray<Type | DynamicModule>;
  /** Destino alternativo de los logs (solo pruebas). */
  readonly logStream?: DestinationStream;
}

/** FR-040 · R-05: los mecanismos técnicos de desarrollo existen solo en local/testing con el contexto técnico activo. */
export function devModulesEnabled(config: AppConfig): boolean {
  return devTenantContextEnabled(config);
}

/**
 * Módulo raíz de Kuota Core (T025): configuración validada, logging estructurado con correlación, filtro global
 * problem+json, sondas health, compatibilidad (US1) y registro condicional de módulos de desarrollo.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppModuleOptions = {}): DynamicModule {
    const devModules = devModulesEnabled(config) ? (options.devModules ?? DEV_ONLY_MODULES) : [];
    return {
      module: AppModule,
      imports: [
        ConfigModule.forConfig(config),
        LoggingModule.forRoot(options.logStream ? { stream: options.logStream } : {}),
        TenantContextModule,
        HealthModule,
        MetaModule,
        ...devModules,
        ...(options.modules ?? []),
      ],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    };
  }
}
