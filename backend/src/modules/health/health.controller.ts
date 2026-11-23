import type { ServerResponse } from 'node:http';
import { Controller, Get, HttpStatus, Res, ServiceUnavailableException } from '@nestjs/common';
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
    res.statusCode = ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return { status: ready ? 'ok' : 'error', checks: { database: { status: database } } };
  }
}
