import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { DATABASE_PROBE, DATABASE_PROBE_TIMEOUT_MS, type DatabaseProbe } from '../../common/database/database-probe.js';

/**
 * Motivo acotado de un fallo de la sonda (T101): un código de error del sistema o de PostgreSQL (`ECONNREFUSED`,
 * `57P03`…), `timeout` o `error`. Nunca el mensaje, que puede incluir host, puerto, usuario o SQL.
 */
export function probeFailureReason(error: unknown): string {
  if (error instanceof ProbeTimeoutError) return 'timeout';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,32}$/.test(code) ? code : 'error';
}

/**
 * Indicador terminus `database`: up/down. Cuando está caído añade `reason` (solo para el log del controlador; la
 * respuesta del contrato no lo incluye). Cada fallo se registra en `debug`; el cambio de estado lo registra
 * `HealthController` una sola vez (T101).
 */
@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger('Readiness');

  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(DATABASE_PROBE) private readonly probe: DatabaseProbe,
  ) {}

  async check() {
    const indicator = this.indicators.check('database');
    try {
      await withTimeout(this.probe.ping(), DATABASE_PROBE_TIMEOUT_MS + 500);
      return indicator.up();
    } catch (error) {
      const reason = probeFailureReason(error);
      this.logger.debug({ check: 'database', reason }, 'Sonda de PostgreSQL fallida');
      return indicator.down({ reason });
    }
  }
}

class ProbeTimeoutError extends Error {
  constructor(ms: number) {
    super(`Sonda sin respuesta en ${ms} ms`);
    this.name = 'ProbeTimeoutError';
  }
}

/** Salvaguarda por encima de los límites del driver: ninguna comprobación queda colgada. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
