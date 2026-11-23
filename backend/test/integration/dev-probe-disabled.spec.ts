import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { DevProbeService } from '../../src/modules/dev-probe/application/dev-probe.service.js';
import { STRONG_TOKEN, validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';

/**
 * T096 (FR-040; excepción `/v1/dev/*`): fuera de local/testing con el contexto técnico habilitado, `dev-probe` NO se
 * registra. Sus rutas responden 404 porque no existen (no 401 de un guard), envíen o no `X-Kuota-Dev-Tenant`, y no se
 * escribe ninguna fila. Se verifica con `createApp` (AppModule real con `DEV_ONLY_MODULES` por defecto) y con el proceso
 * compilado `node dist/main.js` en producción.
 */
const BACKEND_DIR = join(__dirname, '../..');
const PATH = '/v1/dev/probe-items';
let db: TestDatabase;
let admin: Client;
let app: INestApplication | undefined;

const count = async () =>
  Number((await admin.query<{ n: string }>('SELECT count(*) AS n FROM kuota.dev_probe_items')).rows[0]!.n);

/** Las cinco operaciones del contrato, con y sin encabezado técnico (y con encabezados válidos en todo lo demás). */
async function allOperations(base: string): Promise<Array<{ op: string; status: number; code: unknown }>> {
  const id = randomUUID();
  const results: Array<{ op: string; status: number; code: unknown }> = [];
  for (const tenant of [undefined, randomUUID()]) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      'x-kuota-dev-actor': 'dev:t096',
      ...(tenant ? { 'x-kuota-dev-tenant': tenant } : {}),
    };
    const ops: Array<[string, string, string, unknown]> = [
      ['createDevProbeItem', 'POST', PATH, { label: 't096', sample_amount: { amount_minor: '1', currency: 'MXN' } }],
      ['listDevProbeItems', 'GET', PATH, undefined],
      ['getDevProbeItem', 'GET', `${PATH}/${id}`, undefined],
      ['updateDevProbeItem', 'PATCH', `${PATH}/${id}`, { label: 'x', version: 1 }],
      ['deleteDevProbeItem', 'DELETE', `${PATH}/${id}`, undefined],
    ];
    for (const [op, method, path, body] of ops) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: unknown };
      results.push({ op: `${op}${tenant ? ' +tenant' : ''}`, status: res.status, code: json.code });
    }
  }
  return results;
}

async function start(env: Record<string, string>): Promise<string> {
  app = await createApp(loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, LOG_LEVEL: 'silent', ...env })));
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await admin?.end();
  await db?.stop();
});

const DISABLED: Array<[string, Record<string, string>]> = [
  ['staging', { KUOTA_ENV: 'staging', KUOTA_METRICS_TOKEN: STRONG_TOKEN }],
  ['production', { KUOTA_ENV: 'production', KUOTA_METRICS_TOKEN: STRONG_TOKEN }],
  ['testing con el mecanismo deshabilitado', { KUOTA_ENV: 'testing', KUOTA_DEV_TENANT_CONTEXT: 'disabled' }],
  ['local con el mecanismo deshabilitado', { KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'disabled' }],
];

describe('dev-probe deshabilitado: las rutas no existen (T096)', () => {
  for (const [name, env] of DISABLED) {
    it(`${name}: las 5 operaciones → 404 not-found, con o sin X-Kuota-Dev-Tenant, sin escribir filas`, async () => {
      const before = await count();
      const base = await start(env);
      const results = await allOperations(base);
      expect(results).toHaveLength(10);
      for (const r of results) expect(r, r.op).toMatchObject({ status: 404, code: 'not-found' });
      expect(await count()).toBe(before);
      // El módulo ni siquiera está en el contenedor de Nest.
      expect(() => app!.get(DevProbeService, { strict: false })).toThrow();
    });
  }
});

describe('dev-probe habilitado: control positivo (las rutas existen)', () => {
  for (const env of ['local', 'testing']) {
    it(`${env} + enabled: sin encabezado → 401 del guard; con encabezado → 201`, async () => {
      const base = await start({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'enabled' });
      expect(app!.get(DevProbeService, { strict: false })).toBeInstanceOf(DevProbeService);
      const results = await allOperations(base);
      expect(results.find((r) => r.op === 'listDevProbeItems')).toMatchObject({
        status: 401,
        code: 'tenant-context-required',
      });
      expect(results.find((r) => r.op === 'createDevProbeItem +tenant')?.status).toBe(201);
    });
  }
});

describe('proceso real `node dist/main.js` en producción (T096)', () => {
  beforeAll(async () => {
    await promisify(execFile)(join(BACKEND_DIR, 'node_modules/.bin/nest'), ['build'], {
      cwd: BACKEND_DIR,
      timeout: 120_000,
    });
  }, 180_000);

  it('KUOTA_ENV=production: /v1/dev/probe-items → 404 con encabezados técnicos, sin escribir filas', async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
      });
    });
    const env = validEnv({
      KUOTA_ENV: 'production',
      KUOTA_METRICS_TOKEN: STRONG_TOKEN,
      DATABASE_URL_APP: db.appUrl,
      PORT: String(port),
    });
    const child = spawn(process.execPath, [join(BACKEND_DIR, 'dist/main.js')], {
      cwd: BACKEND_DIR,
      env: { PATH: process.env['PATH'], ...env },
    });
    let output = '';
    child.stdout.on('data', (c: Buffer) => (output += c.toString()));
    child.stderr.on('data', (c: Buffer) => (output += c.toString()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no arrancó: ${output}`)), 20_000);
        child.stdout.on('data', () => {
          if (output.includes('Nest application successfully started')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const before = await count();
      const results = await allOperations(`http://127.0.0.1:${port}`);
      for (const r of results) expect(r, r.op).toMatchObject({ status: 404, code: 'not-found' });
      expect(await count()).toBe(before);
      // Nest registra en el log cada controlador y ruta montados: los de meta sí, los de dev-probe no.
      expect(output).toContain('CompatibilityController');
      expect(output).not.toMatch(/DevProbeController|Mapped \{\/v1\/dev/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  }, 60_000);
});
