import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { DATABASE_PROBE, DATABASE_PROBE_TIMEOUT_MS, type DatabaseProbe } from '../../common/database/database-probe.js';

/** Indicador terminus `database`: up/down sin datos adicionales. El motivo del fallo va solo al log. */
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
      const err = error instanceof Error ? error : new Error('Fallo no Error en la sonda de base de datos');
      this.logger.warn({ err, check: 'database' }, 'PostgreSQL no disponible: readiness en 503');
      return indicator.down();
    }
  }
}

/** Salvaguarda por encima de los límites del driver: ninguna comprobación queda colgada. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Sonda sin respuesta en ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
