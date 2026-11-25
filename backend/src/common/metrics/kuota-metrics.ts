import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Histogram, type Counter, type Meter } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { ProblemCode } from '../errors/problem.js';

/** Estado del pool de conexiones de la aplicación (`kuota_app_login`), sin datos de conexión. */
export interface PoolStats {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
}

/** Fuente opcional del estado del pool (el servicio de acceso a datos por tenant). */
export type PoolStatsSource = () => PoolStats;

/** Límites del histograma de latencia (s): de 5 ms a 10 s. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Métricas técnicas de Kuota Core (T094; FR-039; R-21) con OpenTelemetry Metrics y exportador Prometheus en modo pull
 * (`preventServerStart: true`: el exportador nunca abre su propio puerto; lo sirve `metrics-server.ts` con control de
 * acceso).
 *
 * Etiquetas permitidas, todas de cardinalidad acotada: `route` (plantilla registrada o `unmatched`), `method` (lista
 * cerrada u `OTHER`), `status` (código HTTP), `code` (código estable del contrato) y `state` del pool. Nunca: tenant,
 * actor, correlación, IP, encabezados, URL concreta, query, cuerpos ni montos. Sin `target_info` ni etiquetas de scope:
 * no se publican versiones ni datos del host.
 */
export class KuotaMetrics {
  readonly #provider: MeterProvider;
  readonly #exporter: PrometheusExporter;
  readonly #duration: Histogram;
  readonly #errors: Counter;

  constructor(poolStats?: PoolStatsSource) {
    this.#exporter = new PrometheusExporter({
      preventServerStart: true,
      withoutTargetInfo: true,
      withoutScopeInfo: true,
    });
    this.#provider = new MeterProvider({ readers: [this.#exporter] });
    const meter: Meter = this.#provider.getMeter('kuota-core');

    this.#duration = meter.createHistogram('http_server_request_duration_seconds', {
      description: 'Duración de las solicitudes HTTP por plantilla de ruta, método y estado',
      unit: 's',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    });
    this.#errors = meter.createCounter('kuota_http_errors', {
      description: 'Respuestas de error problem+json por código estable del contrato',
    });

    if (poolStats) {
      const connections = meter.createObservableGauge('kuota_db_pool_connections', {
        description: 'Conexiones del pool de PostgreSQL de la aplicación por estado',
      });
      const waiting = meter.createObservableGauge('kuota_db_pool_waiting_requests', {
        description: 'Solicitudes esperando una conexión del pool de PostgreSQL',
      });
      meter.addBatchObservableCallback(
        (observer) => {
          const stats = poolStats();
          observer.observe(connections, stats.idle, { state: 'idle' });
          observer.observe(connections, stats.total - stats.idle, { state: 'in_use' });
          observer.observe(waiting, stats.waiting);
        },
        [connections, waiting],
      );
    }

    const residentMemory = meter.createObservableGauge('kuota_process_resident_memory_bytes', {
      description: 'Memoria residente del proceso',
    });
    const heapUsed = meter.createObservableGauge('kuota_process_heap_used_bytes', {
      description: 'Heap de V8 en uso',
    });
    const cpu = meter.createObservableCounter('kuota_process_cpu_seconds', {
      description: 'Tiempo de CPU del proceso (usuario + sistema)',
    });
    const uptime = meter.createObservableGauge('kuota_process_uptime_seconds', {
      description: 'Tiempo desde el arranque del proceso',
    });
    meter.addBatchObservableCallback(
      (observer) => {
        const memory = process.memoryUsage();
        const usage = process.cpuUsage();
        observer.observe(residentMemory, memory.rss);
        observer.observe(heapUsed, memory.heapUsed);
        observer.observe(cpu, (usage.user + usage.system) / 1e6);
        observer.observe(uptime, process.uptime());
      },
      [residentMemory, heapUsed, cpu, uptime],
    );
  }

  /** Una solicitud HTTP atendida. `route`, `method` y `status` deben venir ya normalizados (cardinalidad acotada). */
  recordRequest(route: string, method: string, status: number, seconds: number): void {
    this.#duration.record(seconds, { route, method, status: String(status) });
  }

  /** Una respuesta de error del filtro problem+json (T021), por código estable. */
  recordError(code: ProblemCode): void {
    this.#errors.add(1, { code });
  }

  /** Exposición Prometheus (la invoca `metrics-server.ts` solo después del control de acceso). */
  serve(req: IncomingMessage, res: ServerResponse): void {
    this.#exporter.getMetricsRequestHandler(req, res);
  }

  async shutdown(): Promise<void> {
    await this.#provider.shutdown();
  }
}
