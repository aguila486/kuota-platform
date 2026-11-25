import type { INestApplication } from '@nestjs/common';
import { Writable } from 'node:stream';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { startTcpProxy, type TcpProxy } from '../support/tcp-proxy.js';
import { recordOutput } from '../support/log-capture.js';

/**
 * T026 (US1-1, US1-2; FR-040): sondas reales contra PostgreSQL efímero (Testcontainers) a través de un proxy TCP que
 * simula caída, cuelgue y recuperación. Sin credenciales en ninguna solicitud.
 */
let db: TestDatabase;
let proxy: TcpProxy;
let app: INestApplication;
let url: string;
let dbHost: string;
let dbPort: string;
let logs = '';
const logStream = new Writable({
  write(chunk: Buffer, _enc, done) {
    logs += chunk.toString();
    recordOutput(chunk.toString()); // SC-009 · T102: captura de la suite
    done();
  },
});

const SECURITY_CATALOG = `
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
         (SELECT array_agg(p.polname ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
         c.relacl::text AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'kuota' AND c.relkind = 'r' ORDER BY c.relname`;
const ROLES = `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles
  WHERE rolname LIKE 'kuota%' ORDER BY rolname`;

async function snapshot(): Promise<unknown> {
  const client = new Client({ connectionString: db.superuserUrl });
  await client.connect();
  try {
    return { tables: (await client.query(SECURITY_CATALOG)).rows, roles: (await client.query(ROLES)).rows };
  } finally {
    await client.end();
  }
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}${path}`, { headers });
  return { res, text: await res.text() };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const target = new URL(db.appUrl);
  dbHost = target.hostname;
  dbPort = target.port;
  proxy = await startTcpProxy(dbHost, Number(dbPort));
  const viaProxy = new URL(db.appUrl);
  viaProxy.hostname = '127.0.0.1';
  viaProxy.port = String(proxy.port);
  app = await createApp(loadConfig(validEnv({ DATABASE_URL_APP: viaProxy.toString() })), { logStream });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await proxy?.close();
  await db?.stop();
});

describe('GET /health/live (T026)', () => {
  it('200 con exactamente {"status":"ok"} y JSON', async () => {
    const { res, text } = await get('/health/live');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(JSON.parse(text)).toStrictEqual({ status: 'ok' });
  });

  it('no consulta PostgreSQL', async () => {
    proxy.resetCapture();
    proxy.mode = 'refuse';
    try {
      expect((await get('/health/live')).res.status).toBe(200);
      expect(proxy.captured()).toBe('');
    } finally {
      proxy.mode = 'forward';
    }
  });
});

describe('GET /health/ready (T026)', () => {
  it('200 {"status":"ok","checks":{"database":{"status":"up"}}} con la base arriba', async () => {
    const { res, text } = await get('/health/ready');
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toStrictEqual({ status: 'ok', checks: { database: { status: 'up' } } });
  });

  it('503 con checks.database.status=down y sin detalles internos con la base caída; live sigue en 200', async () => {
    proxy.mode = 'refuse';
    proxy.dropConnections();
    try {
      const { res, text } = await get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(JSON.parse(text)).toStrictEqual({ status: 'error', checks: { database: { status: 'down' } } });
      for (const leak of [
        dbHost,
        dbPort,
        String(proxy.port),
        '127.0.0.1',
        'kuota_app_login',
        'postgres',
        'ECONN',
        'error:',
        'Connection',
        '18.',
      ]) {
        expect(text, leak).not.toContain(leak);
      }
      expect((await get('/health/live')).res.status).toBe(200);
    } finally {
      proxy.mode = 'forward';
    }
  });

  it('el motivo del fallo va solo al log (nivel warn, con correlación) y sin la contraseña de la conexión', async () => {
    // Parte de un estado `up` para que la caída sea una transición (T101: solo los cambios de estado van a warn).
    expect((await get('/health/ready')).res.status).toBe(200);
    logs = '';
    proxy.mode = 'refuse';
    proxy.dropConnections();
    try {
      const { res } = await get('/health/ready');
      expect(res.status).toBe(503);
      const line = logs.split('\n').find((l) => l.includes('PostgreSQL no disponible'));
      expect(line).toBeDefined();
      const record = JSON.parse(line!) as Record<string, unknown>;
      expect(record['level']).toBe('warn');
      expect(record['check']).toBe('database');
      expect(record['correlation_id']).toBe(res.headers.get('x-correlation-id'));
      // T101: motivo acotado (código), nunca el mensaje del driver con host, puerto o usuario.
      expect(record['reason']).toMatch(/^[A-Z0-9_]{2,32}$|^timeout$|^error$/);
      expect(record).not.toHaveProperty('err');
      expect(logs).not.toContain(decodeURIComponent(new URL(db.appUrl).password));
      for (const leak of [String(proxy.port), 'kuota_app_login']) expect(line, leak).not.toContain(leak);
    } finally {
      proxy.mode = 'forward';
    }
  });

  it('una base colgada no bloquea la sonda: 503 dentro del límite de tiempo', async () => {
    proxy.mode = 'blackhole';
    proxy.dropConnections();
    try {
      const started = Date.now();
      const { res } = await get('/health/ready');
      const elapsed = Date.now() - started;
      expect(res.status).toBe(503);
      expect(elapsed).toBeLessThan(3_500);
    } finally {
      proxy.mode = 'forward';
      proxy.dropConnections();
    }
  });

  it('se recupera sola al volver la base', async () => {
    proxy.mode = 'refuse';
    proxy.dropConnections();
    expect((await get('/health/ready')).res.status).toBe(503);
    proxy.mode = 'forward';
    expect((await get('/health/ready')).res.status).toBe(200);
  });
});

describe('eventos de transición de readiness (T101)', () => {
  function transitions(): Array<Record<string, unknown>> {
    return logs
      .split('\n')
      .filter((line) => line.includes('"event":"readiness.changed"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('un solo evento por cambio de estado: caída (warn) y recuperación (info), sin repetir en sondas iguales', async () => {
    proxy.mode = 'forward';
    expect((await get('/health/ready')).res.status).toBe(200);
    logs = '';
    proxy.mode = 'refuse';
    proxy.dropConnections();
    try {
      for (let i = 0; i < 3; i += 1) expect((await get('/health/ready')).res.status).toBe(503);
    } finally {
      proxy.mode = 'forward';
    }
    for (let i = 0; i < 3; i += 1) expect((await get('/health/ready')).res.status).toBe(200);

    const events = transitions();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ level: 'warn', check: 'database', from: 'up', to: 'down', module: 'Readiness' });
    expect(events[1]).toMatchObject({ level: 'info', check: 'database', from: 'down', to: 'up', module: 'Readiness' });
    expect(events[1]).not.toHaveProperty('reason');
  });

  it('sondas sanas consecutivas no emiten eventos', async () => {
    expect((await get('/health/ready')).res.status).toBe(200);
    logs = '';
    for (let i = 0; i < 5; i += 1) await get('/health/ready');
    expect(transitions()).toHaveLength(0);
  });
});

describe('seguridad de la sonda de base de datos (T026, FR-040)', () => {
  it('usa kuota_app_login, solo ejecuta SELECT 1 y nunca fija contexto de tenant, aunque se envíe el encabezado técnico', async () => {
    proxy.dropConnections();
    proxy.resetCapture();
    const { res } = await get('/health/ready', {
      'x-kuota-dev-tenant': '0193b6f0-0000-7000-8000-000000000001',
      'x-kuota-dev-actor': '0193b6f0-0000-7000-8000-000000000002',
    });
    expect(res.status).toBe(200);
    const sent = proxy.captured();
    expect(sent).toContain('kuota_app_login');
    expect(sent).toContain('SELECT 1');
    for (const forbidden of [
      'kuota_migrator',
      'set_config',
      'app.tenant_id',
      'app.actor_id',
      'SET ',
      'kuota.',
      'FROM ',
      '0193b6f0',
    ]) {
      expect(sent, forbidden).not.toContain(forbidden);
    }
  });

  it('las sondas no alteran RLS, políticas, permisos ni roles', async () => {
    const before = await snapshot();
    for (let i = 0; i < 5; i++) await get('/health/ready');
    expect(await snapshot()).toStrictEqual(before);
  });

  it('con PostgreSQL detenido de verdad: 503 y el proceso sigue vivo', async () => {
    await db.stop();
    const ready = await get('/health/ready');
    expect(ready.res.status).toBe(503);
    expect(JSON.parse(ready.text)).toStrictEqual({ status: 'error', checks: { database: { status: 'down' } } });
    expect((await get('/health/live')).res.status).toBe(200);
  }, 60_000);
});
