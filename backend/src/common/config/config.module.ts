import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './app-config.js';
import { loadConfig } from './load-config.js';

/**
 * Configuración global (T016). Si la validación o los guards de arranque fallan, `loadConfig` lanza
 * `ConfigValidationError` y Nest no arranca.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Readonly<Record<string, string | undefined>> = process.env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(env) }],
      exports: [APP_CONFIG],
    };
  }
}
