import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { MetricsRuntime } from '../../src/common/metrics/metrics.module.js';
import { validEnv } from '../support/env.js';

/**
 * H3 de T092 (FR-011, US5-4): toda ruta inexistente responde `application/problem+json` con el código del contrato
 * `not-found`, dentro y fuera de `/v1` y de `/health`, sin revelar el framework, la ruta pedida ni datos de la consulta.
 */
const ORIGIN = 'http://localhost:8080';
const CORRELATION = '0190b6a4-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
let app: INestApplication;
let url = '';

beforeAll(async () => {
  app = await createApp(loadConfig(validEnv({ LOG_LEVEL: 'silent', KUOTA_CORS_ALLOWED_ORIGINS: ORIGIN })));
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => app?.close());

async function expectNotFound(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  expect(res.headers.get('x-powered-by')).toBeNull();
  const text = await res.text();
  expect(text).not.toMatch(/<html|<pre>|Cannot (GET|POST)|express|nestjs|stack/i);
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['code', 'correlation_id', 'status', 'title', 'type']);
  expect(body).toMatchObject({ code: 'not-found', status: 404, title: 'No encontrado' });
  expect(body['correlation_id']).toBe(res.headers.get('x-correlation-id'));
  return body;
}

describe('404 problem+json en todo el puerto de la API (H3)', () => {
  for (const path of ['/foo', '/metrics', '/v2/meta/compatibility', '/', '/v1/no-existe', '/health/no-existe']) {
    it(`GET ${path}`, async () => {
      await expectNotFound(await fetch(`${url}${path}`));
    });
  }

  it('otros métodos fuera de /v1 también', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      await expectNotFound(
        await fetch(`${url}/foo/bar`, { method, body: method === 'DELETE' ? undefined : '{"x":1}' }),
      );
    }
  });

  it('no refleja la ruta, la query ni encabezados; respeta X-Correlation-Id', async () => {
    const res = await fetch(`${url}/privado/persona@example.com?token=secreto-123&tenant=abc`, {
      headers: { 'x-correlation-id': CORRELATION, 'x-secreto': 'valor-sensible' },
    });
    const body = await expectNotFound(res);
    expect(body['correlation_id']).toBe(CORRELATION);
    const text = JSON.stringify(body);
    for (const leak of ['persona@example.com', 'secreto-123', 'privado', 'valor-sensible', 'token']) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it('las rutas existentes no cambian', async () => {
    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/v1/meta/compatibility`)).status).toBe(200);
  });

  it('CORS sin regresiones: el origen permitido puede leer el 404 y el preflight sigue respondiendo 204', async () => {
    const get = await fetch(`${url}/foo`, { headers: { origin: ORIGIN } });
    expect(get.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    await expectNotFound(get);
    const denied = await fetch(`${url}/foo`, { headers: { origin: 'http://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${url}/v1/meta/compatibility`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('cuenta en kuota_http_errors_total{code="not-found"} y se mide como ruta `unmatched`', async () => {
    const port = await app.get(MetricsRuntime).listen(0);
    const scrape = async () => (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    const value = (text: string, series: string) => Number(new RegExp(`^${series} (\\S+)$`, 'm').exec(text)?.[1] ?? 0);
    const before = await scrape();
    await fetch(`${url}/fuera-de-v1`);
    const after = await scrape();
    expect(value(after, 'kuota_http_errors_total\\{code="not-found"\\}')).toBe(
      value(before, 'kuota_http_errors_total\\{code="not-found"\\}') + 1,
    );
    const unmatched = 'http_server_request_duration_seconds_count\\{route="unmatched",method="GET",status="404"\\}';
    expect(value(after, unmatched)).toBe(value(before, unmatched) + 1);
    expect(after).not.toContain('fuera-de-v1');
  });
});
