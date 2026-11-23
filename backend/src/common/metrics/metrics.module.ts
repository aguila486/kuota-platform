import type { Server } from 'node:http';
import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { TenantPrismaService } from '../tenant-context/tenant-prisma.service.js';
import { KuotaMetrics } from './kuota-metrics.js';
import { listenMetrics } from './metrics-server.js';

/**
 * Ciclo de vida de las métricas (T094): una instancia de `KuotaMetrics` por aplicación (sin proveedor global de
 * OpenTelemetry) y la escucha protegida, que solo se abre cuando el proceso la pide (`main.ts`), nunca en `createApp`:
 * así las pruebas que crean aplicaciones no compiten por el puerto de métricas.
 */
@Injectable()
export class MetricsRuntime implements OnModuleDestroy {
  readonly metrics: KuotaMetrics;
  #server: Server | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    prisma: TenantPrismaService,
  ) {
    this.metrics = new KuotaMetrics(() => prisma.poolStats());
  }

  /** Abre `KUOTA_METRICS_HOST:KUOTA_METRICS_PORT` (o `port`, p. ej. 0 en pruebas) y devuelve el puerto real. */
  async listen(port?: number): Promise<number> {
    if (this.#server) throw new Error('La escucha de métricas ya está abierta');
    const { server, port: bound } = await listenMetrics(this.metrics, this.config, port);
    this.#server = server;
    return bound;
  }

  async onModuleDestroy(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.metrics.shutdown();
  }
}

@Global()
@Module({ providers: [MetricsRuntime], exports: [MetricsRuntime] })
export class MetricsModule {}
