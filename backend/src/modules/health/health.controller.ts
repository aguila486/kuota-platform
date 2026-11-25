import type { ServerResponse } from 'node:http';
import { Controller, Get, HttpStatus, Logger, Res, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';

/** Contrato: `LivenessStatus`. */
export interface LivenessStatus {
  readonly status: 'ok';
}

/** Contrato: `ReadinessStatus` (esquema cerrado: sin `info`, `error` ni `details` de terminus). */
export interface ReadinessStatus {
  readonly status: 'ok' | 'error';
  readonly checks: { readonly database: { readonly status: 'up' | 'down' } };
}

/**
 * Sondas operativas públicas sin prefijo de versión (FR-040, excepciones registradas). No leen encabezados ni contexto de
 * tenant. Un 503 de readiness es un estado del contrato, no un error: no pasa por el filtro problem+json.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Readiness');
  /** Último estado observado; `unknown` hasta la primera comprobación de este proceso. */
  private readiness: 'unknown' | 'up' | 'down' = 'unknown';

  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  /** Vida del proceso: no consulta dependencias; una caída de PostgreSQL no lo marca como muerto. */
  @Get('live')
  live(): LivenessStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: ServerResponse): Promise<ReadinessStatus> {
    let result: HealthCheckResult;
    try {
      result = await this.health.check([() => this.database.check()]);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      result = error.getResponse() as HealthCheckResult;
    }
    const database = result.details['database']?.status === 'up' ? 'up' : 'down';
    const ready = result.status === 'ok' && database === 'up';
    this.recordTransition(ready ? 'up' : 'down', result.details['database']?.['reason']);
    res.statusCode = ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return { status: ready ? 'ok' : 'error', checks: { database: { status: database } } };
  }

  /**
   * T101: un evento `readiness.changed` SOLO cuando cambia el estado (no en cada sonda: los orquestadores consultan cada
   * pocos segundos). Caída → `warn` con el motivo acotado; recuperación o primer estado `up` → `info`.
   */
  private recordTransition(next: 'up' | 'down', reason: unknown): void {
    const previous = this.readiness;
    if (previous === next) return;
    this.readiness = next;
    const event = { event: 'readiness.changed', check: 'database', from: previous, to: next };
    if (next === 'down') {
      this.logger.warn(
        { ...event, reason: typeof reason === 'string' ? reason : 'error' },
        'PostgreSQL no disponible: readiness en 503',
      );
    } else {
      this.logger.log(event, 'Readiness disponible');
    }
  }
}
