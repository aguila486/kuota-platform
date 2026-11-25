import type { DynamicModule, Type } from '@nestjs/common';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** Token: nombres de los módulos de aplicación registrados en este arranque (los calcula `AppModule.forRoot`). */
export const ENABLED_MODULES = Symbol('ENABLED_MODULES');

/** `DevProbeModule` → `dev-probe`. Solo nombres de clase: nunca configuración ni valores. */
export function moduleName(module: Type | DynamicModule): string {
  const name = 'module' in module ? module.module.name : module.name;
  return name
    .replace(/Module$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Eventos de ciclo de vida del proceso (T101; spec: Observability Signals). Un evento `service.started` cuando la API y
 * la escucha de métricas ya aceptan conexiones, y un `service.stopped` al cerrar la aplicación (señal o `close()`).
 * Solo llevan datos operativos no sensibles: entorno, versión de la API, módulos habilitados, puertos y señal. Nunca
 * URLs de conexión, tokens ni orígenes CORS.
 */
@Injectable()
export class LifecycleEvents implements OnApplicationShutdown {
  private readonly logger = new Logger('Lifecycle');
  private startedAt: number | undefined;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ENABLED_MODULES) private readonly modules: readonly string[],
  ) {}

  /** Lo llama `main.ts` una vez abiertas ambas escuchas. Una segunda llamada no emite un evento duplicado. */
  started(ports: { readonly api: number; readonly metrics: number }): void {
    if (this.startedAt !== undefined) return;
    this.startedAt = Date.now();
    this.logger.log(
      {
        event: 'service.started',
        api_version: this.config.apiVersion,
        modules: this.modules,
        port: ports.api,
        metrics_port: ports.metrics,
      },
      'Kuota Core disponible',
    );
  }

  onApplicationShutdown(signal?: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.logger.log(
      {
        event: 'service.stopped',
        signal: signal ?? 'close',
        ...(this.startedAt !== undefined && { uptime_ms: Date.now() - this.startedAt }),
      },
      'Kuota Core detenido',
    );
  }
}
