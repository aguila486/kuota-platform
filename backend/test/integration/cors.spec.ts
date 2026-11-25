import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';

/**
 * Aprobación 8: política CORS sobre la aplicación real. El navegador decide con estas cabeceras; aquí se comprueba que
 * el servidor solo concede permiso a los orígenes exactos configurados, con los métodos y encabezados del contrato.
 */
const ALLOWED = 'http://localhost:8080';
const OTHER = 'http://localhost:8081';

async function start(origins: string | undefined): Promise<{ app: INestApplication; url: string }> {
  const app = await createApp(loadConfig(validEnv({ LOG_LEVEL: 'silent', KUOTA_CORS_ALLOWED_ORIGINS: origins })));
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl() };
}

const preflight = (url: string, origin: string, method = 'GET', headers = 'x-app-version,x-correlation-id') =>
  fetch(`${url}/v1/meta/compatibility`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers },
  });

describe('CORS con origen permitido configurado', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => ({ app, url } = await start(`${ALLOWED},http://127.0.0.1:8080`)));
  afterAll(async () => app?.close());

  it('origen permitido: GET con encabezados del contrato devuelve CompatibilityInfo y ACAO exacto', async () => {
    const res = await fetch(`${url}/v1/meta/compatibility`, {
      headers: {
        origin: ALLOWED,
        'x-app-version': 'admin/0.1.0+1',
        'x-correlation-id': '0190b6a4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('access-control-expose-headers')).toBe('X-Correlation-Id');
    expect(res.headers.get('vary')).toMatch(/origin/i);
    expect(res.headers.get('x-correlation-id')).toBe('0190b6a4-1c2d-7e3f-8a9b-0c1d2e3f4a5b');
    expect(((await res.json()) as { client_supported: boolean }).client_supported).toBe(true);
  });

  it('preflight válido: 204 con origen exacto, solo GET y solo los encabezados permitidos', async () => {
    const res = await preflight(url, ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET');
    expect(res.headers.get('access-control-allow-headers')).toBe('X-Correlation-Id,X-App-Version');
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('cada origen de la lista recibe su propio valor, nunca otro de la lista', async () => {
    const res = await preflight(url, 'http://127.0.0.1:8080');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8080');
  });

  it('origen no permitido: sin Access-Control-Allow-Origin en GET ni en preflight (el navegador bloquea)', async () => {
    for (const origin of [OTHER, 'null', 'http://localhost:8080.evil.test', 'https://localhost:8080']) {
      const get = await fetch(`${url}/v1/meta/compatibility`, { headers: { origin } });
      expect(get.headers.get('access-control-allow-origin')).toBeNull();
      expect(get.headers.get('vary')).toMatch(/origin/i);
      const pre = await preflight(url, origin);
      expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('preflight no permitido: métodos y encabezados fuera de la política no se conceden', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await preflight(url, ALLOWED, method);
      expect(res.headers.get('access-control-allow-methods')).toBe('GET');
    }
    const headers = await preflight(url, ALLOWED, 'GET', 'authorization,x-kuota-dev-tenant');
    const granted = (headers.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',');
    expect(granted).not.toContain('authorization');
    expect(granted).not.toContain('x-kuota-dev-tenant');
  });

  it('error de API: el problem+json lleva ACAO para el origen permitido (la app puede leer el error)', async () => {
    const res = await fetch(`${url}/v1/no-existe`, { headers: { origin: ALLOWED } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    const denied = await fetch(`${url}/v1/no-existe`, { headers: { origin: OTHER } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sin Origin (apps móviles, servidores): sin cabeceras CORS y respuesta normal', async () => {
    const res = await fetch(`${url}/v1/meta/compatibility`, { headers: { 'x-app-version': 'collector/0.1.0+1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('CORS sin orígenes configurados', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => ({ app, url } = await start(undefined)));
  afterAll(async () => app?.close());

  it('ningún origen recibe permiso y el preflight no se atiende', async () => {
    const get = await fetch(`${url}/v1/meta/compatibility`, { headers: { origin: ALLOWED } });
    expect(get.status).toBe(200);
    expect(get.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await preflight(url, ALLOWED);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    expect(pre.headers.get('access-control-allow-methods')).toBeNull();
  });
});
