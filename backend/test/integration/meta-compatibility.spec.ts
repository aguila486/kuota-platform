import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';

/** T027 (FR-007, FR-040): `GET /v1/meta/compatibility` sobre la aplicación real, sin credenciales. */
let app: INestApplication;
let url: string;

beforeAll(async () => {
  const env = validEnv({
    LOG_LEVEL: 'silent',
    API_VERSION: '1.2.3',
    MIN_SUPPORTED_ADMIN: '1.0.0',
    MIN_SUPPORTED_COLLECTOR: '1.4.2',
    MIN_SUPPORTED_CLIENT: '2.0.0+7',
  });
  app = await createApp(loadConfig(env));
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => app?.close());

const call = (headers: Record<string, string> = {}) => fetch(`${url}/v1/meta/compatibility`, { headers });

describe('GET /v1/meta/compatibility (T027)', () => {
  it('sin credenciales devuelve CompatibilityInfo desde la configuración, sin campos adicionales', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['api_version', 'client_supported', 'min_supported', 'server_time']);
    expect(body).toMatchObject({
      api_version: '1.2.3',
      min_supported: { admin: '1.0.0', collector: '1.4.2', client: '2.0.0+7' },
      client_supported: null,
    });
    expect(Object.keys(body['min_supported'] as object).sort()).toEqual(['admin', 'client', 'collector']);
    const serverTime = Date.parse(body['server_time'] as string);
    expect(Math.abs(serverTime - Date.now())).toBeLessThan(10_000);
    expect(body['server_time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it('incluye X-Correlation-Id (UUID) y no refleja otros encabezados', async () => {
    const res = await call({ 'x-app-version': 'collector/1.4.2+120', 'x-echo-me': 'reflejo-sospechoso' });
    expect(res.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    const text = await res.text();
    expect(text).not.toContain('reflejo-sospechoso');
    expect(text).not.toContain('collector/1.4.2+120');
    expect([...res.headers.keys()].some((h) => h.includes('echo'))).toBe(false);
  });

  const supported: Array<[string, boolean]> = [
    ['collector/1.4.2', true],
    ['collector/1.4.2+120', true],
    ['collector/1.10.0', true],
    ['collector/1.4.1+999', false],
    ['collector/0.9.9', false],
    ['admin/1.0.0', true],
    ['client/1.99.99', false],
    ['client/2.0.0+1', true],
  ];
  for (const [header, expected] of supported) {
    it(`client_supported=${expected} para X-App-Version: ${header}`, async () => {
      const body = (await (await call({ 'x-app-version': header })).json()) as { client_supported: boolean };
      expect(body.client_supported).toBe(expected);
    });
  }

  for (const invalid of [
    'collector',
    'collector/1.4',
    'web/1.0.0',
    'collector/1.4.2-beta',
    'Collector/1.4.2',
    '<script>/1.0.0',
  ]) {
    it(`400 problem+json validation-error con X-App-Version inválido: ${invalid}`, async () => {
      const res = await call({ 'x-app-version': invalid });
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      const body = (await res.json()) as Record<string, unknown> & { errors: Array<Record<string, string>> };
      expect(body['code']).toBe('validation-error');
      expect(body['detail']).toBeUndefined();
      // El valor recibido nunca se refleja: el único texto es el mensaje fijo de formato.
      expect(body.errors).toStrictEqual([
        { field: 'X-App-Version', message: 'Formato esperado <admin|collector|client>/<X.Y.Z>[+build]' },
      ]);
    });
  }
});
