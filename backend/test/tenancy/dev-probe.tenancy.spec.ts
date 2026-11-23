import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase } from '../support/postgres.js';
import { describeTenantIsolation, type Json } from './describe-tenant-isolation.js';

/**
 * T037: suite de acceso cruzado aplicada a `dev_probe_items` (create/get/list/patch/delete del contrato) sobre la
 * aplicación real (`createApp`, AppModule con DEV_ONLY_MODULES) y PostgreSQL 18 efímero.
 */
describeTenantIsolation({
  name: 'dev_probe_items (/v1/dev/probe-items)',
  collectionPath: '/v1/dev/probe-items',
  markerField: 'label',
  createBody: (marker) => ({ label: marker, sample_amount: { amount_minor: '-123456789012345678', currency: 'MXN' } }),
  updateBody: (item: Json, marker) => ({ label: marker, version: item['version'] }),
  createHeaders: () => ({ 'idempotency-key': randomUUID() }),
  async setup() {
    const db = await startTestDatabase();
    const app = await createApp(
      loadConfig(
        validEnv({
          KUOTA_ENV: 'testing',
          KUOTA_DEV_TENANT_CONTEXT: 'enabled',
          DATABASE_URL_APP: db.appUrl,
          LOG_LEVEL: 'silent',
        }),
      ),
    );
    await app.listen(0, '127.0.0.1');
    // Conteo sin RLS (superusuario del contenedor efímero): verifica que un rechazo no escribió nada.
    const admin = new Client({ connectionString: db.superuserUrl });
    await admin.connect();
    return {
      baseUrl: await app.getUrl(),
      async countRows(tenantId: string) {
        const { rows } = await admin.query<{ n: string }>(
          'SELECT count(*) AS n FROM kuota.dev_probe_items WHERE tenant_id = $1',
          [tenantId],
        );
        return Number(rows[0]!.n);
      },
      async close() {
        await app.close();
        await admin.end();
        await db.stop();
      },
    };
  },
});
