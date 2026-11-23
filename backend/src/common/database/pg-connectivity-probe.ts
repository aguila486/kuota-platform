// Excepción acotada a ESTE archivo (eslint.config.mjs): única importación de `pg` fuera de src/common/tenant-context.
import { Client } from 'pg';
import { DATABASE_PROBE_TIMEOUT_MS, type DatabaseProbe } from './database-probe.js';

/**
 * `DatabaseProbe` con `kuota_app_login` (sin BYPASSRLS, no propietario). Cada comprobación abre una conexión nueva,
 * ejecuta `SELECT 1` y la cierra: así verifica que PostgreSQL acepta conexiones ahora (una conexión reutilizada
 * podría estar muerta tras un reinicio) y no mantiene conexiones abiertas entre sondas. Hasta T039 no existe el pool
 * de la aplicación; cuando exista, se podrá revisar si la sonda lo usa.
 */
export class PgConnectivityProbe implements DatabaseProbe {
  constructor(
    private readonly connectionString: string,
    private readonly timeoutMs: number = DATABASE_PROBE_TIMEOUT_MS,
  ) {}

  async ping(): Promise<void> {
    const client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: this.timeoutMs,
      query_timeout: this.timeoutMs,
      statement_timeout: this.timeoutMs,
      application_name: 'kuota-core-readiness',
    });
    // Un error de socket tras conectar no debe terminar el proceso: la caída de la base nunca afecta a liveness.
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('SELECT 1');
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
