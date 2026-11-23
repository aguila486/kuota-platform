import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { MetricsRuntime } from '../../src/common/metrics/metrics.module.js';
import { STRONG_TOKEN, validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';

/**
 * T093 (US1-5, FR-039, FR-040): métricas técnicas sobre la aplicación real y PostgreSQL 18.
 * - Acceso: escucha propia (por defecto 127.0.0.1), 200 con `Authorization: Bearer <token>`, 401 sin token o con token
 *   inválido; el puerto de la API no sirve `/metrics`.
 * - Contenido: `http_server_request_duration_seconds{route,method,status}` con plantillas, `kuota_http_errors_total`
 *   por `code`, pool de PostgreSQL y proceso; ninguna etiqueta con UUIDs de tenant, valores de encabezados, rutas
 *   concretas con ids, query ni IP.
 */
const TENANT = randomUUID();
const PATH = '/v1/dev/probe-items';
const SECRET_HEADER = 'valor-de-encabezado-que-no-debe-aparecer';

/** Ruta de prueba que lanza un error no controlado (500 internal-error), solo para esta suite. */
@Controller('metrics-test')
class FailingController {
  @Get('boom')
  boom(): never {
    throw new Error('fallo de prueba con dato-sensible@example.com');
  }
}
@Module({ controllers: [FailingController] })
class FailingModule {}

let db: TestDatabase;
let app: INestApplication;
let admin: Client;
let url = '';
let metricsUrl = '';

const call = (method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      'x-kuota-dev-tenant': TENANT,
      'x-kuota-dev-actor': 'dev:metrics',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const scrape = (authorization: string | null = `Bearer ${STRONG_TOKEN}`) =>
  fetch(metricsUrl, { headers: authorization === null ? {} : { authorization } });

/** Series (sin comentarios) como pares `nombre{etiquetas}` → valor. */
async function series(): Promise<Map<string, number>> {
  const res = await scrape();
  expect(res.status).toBe(200);
  const map = new Map<string, number>();
  for (const line of (await res.text()).split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const at = line.lastIndexOf(' ');
    map.set(line.slice(0, at), Number(line.slice(at + 1)));
  }
  return map;
}
const labelValues = (text: string, label: string) =>
  new Set([...text.matchAll(new RegExp(`${label}="([^"]*)"`, 'g'))].map((m) => m[1]));

beforeAll(async () => {
  db = await startTestDatabase();
  app = await createApp(
    loadConfig(
      validEnv({
        KUOTA_ENV: 'testing',
        KUOTA_DEV_TENANT_CONTEXT: 'enabled',
        DATABASE_URL_APP: db.appUrl,
        LOG_LEVEL: 'silent',
        KUOTA_METRICS_TOKEN: STRONG_TOKEN,
      }),
    ),
    { modules: [FailingModule] },
  );
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  metricsUrl = `http://127.0.0.1:${await app.get(MetricsRuntime).listen(0)}/metrics`;
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();

  // Tráfico representativo: éxito, ruta con id, 400, 401, 404 (por id y ruta inexistente), 409, 500 y concurrencia.
  const created = await call('POST', PATH, {
    body: { label: 'metricas' },
    headers: { 'idempotency-key': randomUUID() },
  });
  const { id } = (await created.json()) as { id: string };
  await call('GET', `${PATH}/${id}`);
  await call('PATCH', `${PATH}/${id}`, { body: { label: 'v2', version: 1 } });
  await call('PATCH', `${PATH}/${id}`, { body: { label: 'v3', version: 1 } }); // 409 version-conflict
  await call('GET', `${PATH}/${randomUUID()}`); // 404 not-found con id
  await call('POST', PATH, { body: { label: '' }, headers: { 'idempotency-key': randomUUID() } }); // 400
  await fetch(`${url}${PATH}`); // 401 tenant-context-required
  await fetch(`${url}/health/live`);
  await fetch(`${url}/v1/meta/compatibility`, {
    headers: { 'x-app-version': 'collector/0.1.0+1', 'x-secret': SECRET_HEADER },
  });
  await fetch(`${url}/v1/no-existe/${randomUUID()}?email=persona@example.com&token=abc`); // 404 sin ruta
  await fetch(`${url}/v1/metrics-test/boom`); // 500 internal-error
  await Promise.all(Array.from({ length: 20 }, () => fetch(`${url}/v1/meta/compatibility`)));
}, 180_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await db?.stop();
});

describe('contenido de las métricas (FR-039)', () => {
  it('duración por plantilla de ruta, método y estado, incluidas rutas inexistentes, errores y concurrencia', async () => {
    const s = await series();
    const count = (route: string, method: string, status: number) =>
      s.get(`http_server_request_duration_seconds_count{route="${route}",method="${method}",status="${status}"}`);
    expect(count('/health/live', 'GET', 200)).toBe(1);
    expect(count('/v1/meta/compatibility', 'GET', 200)).toBe(21);
    expect(count('/v1/dev/probe-items', 'POST', 201)).toBe(1);
    expect(count('/v1/dev/probe-items', 'POST', 400)).toBe(1);
    expect(count('/v1/dev/probe-items', 'GET', 401)).toBe(1);
    expect(count('/v1/dev/probe-items/:id', 'GET', 200)).toBe(1);
    expect(count('/v1/dev/probe-items/:id', 'GET', 404)).toBe(1);
    expect(count('/v1/dev/probe-items/:id', 'PATCH', 200)).toBe(1);
    expect(count('/v1/dev/probe-items/:id', 'PATCH', 409)).toBe(1);
    expect(count('unmatched', 'GET', 404)).toBe(1);
    expect(count('/v1/metrics-test/boom', 'GET', 500)).toBe(1);
    expect(
      s.get('http_server_request_duration_seconds_bucket{route="/health/live",method="GET",status="200",le="+Inf"}'),
    ).toBe(1);
  });

  it('errores por código estable del contrato, alimentados por el filtro problem+json', async () => {
    const s = await series();
    const errors = (code: string) => s.get(`kuota_http_errors_total{code="${code}"}`);
    expect(errors('validation-error')).toBe(1);
    expect(errors('tenant-context-required')).toBe(1);
    expect(errors('not-found')).toBe(2); // id inexistente + ruta inexistente
    expect(errors('version-conflict')).toBe(1);
    expect(errors('internal-error')).toBe(1);
    expect(s.has('kuota_http_errors_total{code="idempotency-key-reused"}')).toBe(false);
  });

  it('pool de PostgreSQL y proceso', async () => {
    const s = await series();
    const idle = s.get('kuota_db_pool_connections{state="idle"}');
    const inUse = s.get('kuota_db_pool_connections{state="in_use"}');
    expect(idle).toBeGreaterThanOrEqual(0);
    expect(inUse).toBeGreaterThanOrEqual(0);
    expect(idle! + inUse!).toBeGreaterThan(0); // el pool real abrió conexiones para dev-probe
    expect(s.get('kuota_db_pool_waiting_requests')).toBe(0);
    expect(s.get('kuota_process_resident_memory_bytes')).toBeGreaterThan(0);
    expect(s.get('kuota_process_heap_used_bytes')).toBeGreaterThan(0);
    expect(s.get('kuota_process_cpu_seconds_total')).toBeGreaterThan(0);
    expect(s.get('kuota_process_uptime_seconds')).toBeGreaterThan(0);
  });

  it('ninguna etiqueta contiene UUIDs, tenant, encabezados, rutas concretas, query, IP ni datos personales', async () => {
    const text = await (await scrape()).text();
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const forbidden of [
      TENANT,
      SECRET_HEADER,
      'collector/0.1.0+1',
      'dev:metrics',
      'persona@example.com',
      'email=',
      'token=abc',
      '?',
      '127.0.0.1',
      'dato-sensible',
      'no-existe',
      'kuota_app_login',
      STRONG_TOKEN,
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // Ningún NOMBRE de etiqueta de tenant, actor o correlación (el valor `tenant-context-required` de `code` es un código
    // estable del contrato, no un identificador).
    expect(text).not.toMatch(/[{,](tenant|actor|correlation)[a-z_]*="/i);
    expect(text).not.toMatch(/target_info|otel_scope|service_version|telemetry_sdk/);
  });

  it('cardinalidad acotada: rutas desconocidas y métodos raros no crean series nuevas', async () => {
    const before = await (await scrape()).text();
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        fetch(`${url}/v1/aleatoria-${i}/${randomUUID()}?q=${i}`, { method: i % 2 ? 'GET' : 'PROPFIND' }),
      ),
    );
    const after = await (await scrape()).text();
    expect(labelValues(after, 'route')).toEqual(
      new Set([
        '/health/live',
        '/v1/meta/compatibility',
        '/v1/dev/probe-items',
        '/v1/dev/probe-items/:id',
        '/v1/metrics-test/boom',
        'unmatched',
      ]),
    );
    expect(
      [...labelValues(after, 'method')].every((m) =>
        ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS', 'OTHER'].includes(m!),
      ),
    ).toBe(true);
    expect(labelValues(after, 'code').size).toBe(labelValues(before, 'code').size);
  });

  it('consultar las métricas no tiene efectos en el dominio ni en la auditoría, y no se mide a sí misma', async () => {
    const count = async (table: string) =>
      (await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM kuota.${table}`)).rows[0]!.n;
    const before = [await count('dev_probe_items'), await count('audit_events')];
    const first = await series();
    await scrape();
    await scrape(null);
    const second = await series();
    expect([await count('dev_probe_items'), await count('audit_events')]).toEqual(before);
    const apiRequests = (m: Map<string, number>) =>
      [...m].filter(([k]) => k.startsWith('http_server_request_duration_seconds_count')).reduce((a, [, v]) => a + v, 0);
    expect(apiRequests(second)).toBe(apiRequests(first));
  });
});

describe('acceso a las métricas (FR-040, tabla Endpoint Access)', () => {
  it('200 con el token del recolector; 401 sin token, con token inválido o con otro esquema', async () => {
    expect((await scrape()).status).toBe(200);
    for (const auth of [
      null,
      'Bearer otro-token-de-32-caracteres-xxxxxxxx',
      `Basic ${STRONG_TOKEN}`,
      STRONG_TOKEN,
      'Bearer ',
    ]) {
      const res = await scrape(auth);
      expect(res.status, String(auth)).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(await res.text()).toBe('');
    }
  });

  it('solo GET /metrics: otra ruta → 404, otro método → 405 (con token), sin cuerpo', async () => {
    const other = await fetch(metricsUrl.replace('/metrics', '/otra'), {
      headers: { authorization: `Bearer ${STRONG_TOKEN}` },
    });
    expect(other.status).toBe(404);
    const post = await fetch(metricsUrl, { method: 'POST', headers: { authorization: `Bearer ${STRONG_TOKEN}` } });
    expect(post.status).toBe(405);
    expect(await post.text()).toBe('');
  });

  it('el puerto de la API no sirve /metrics (404 sin métricas, también con token)', async () => {
    // Nota: fuera de /v1 y de /health, Express responde su 404 por defecto (HTML), no problem+json. Es un comportamiento
    // previo del bootstrap, ajeno a las métricas, registrado como discrepancia en research.md; aquí no se cambia.
    for (const headers of [{}, { authorization: `Bearer ${STRONG_TOKEN}` }]) {
      const res = await fetch(`${url}/metrics`, { headers });
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain('http_server_request_duration_seconds');
      expect(body).not.toContain('# TYPE');
    }
  });

  it('por defecto la escucha es 127.0.0.1', () => {
    expect(loadConfig(validEnv()).metrics.host).toBe('127.0.0.1');
    expect(new URL(metricsUrl).hostname).toBe('127.0.0.1');
  });
});

describe('sin token configurado (solo local/testing con escucha de loopback)', () => {
  it('la credencial es opcional: 200 sin Authorization', async () => {
    const local = await createApp(loadConfig(validEnv({ LOG_LEVEL: 'silent' })));
    try {
      const port = await local.get(MetricsRuntime).listen(0);
      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('kuota_process_uptime_seconds');
    } finally {
      await local.close();
    }
  });
});
