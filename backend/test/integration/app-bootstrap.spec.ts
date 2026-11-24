import { Writable } from 'node:stream';
import { Controller, Get, Logger, Module, type INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { LifecycleEvents } from '../../src/common/logging/lifecycle-events.js';
import { STRONG_TOKEN, validEnv } from '../support/env.js';
import { recordOutput } from '../support/log-capture.js';

/**
 * T025: la aplicación REAL (AppModule.forRoot + createApp) registra configuración, logging, filtro global y el registro
 * condicional de módulos de desarrollo. Los controladores de este archivo son solo de prueba.
 */
@Controller('dev/ping')
class DevPingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}
@Module({ controllers: [DevPingController] })
class FakeDevModule {}

@Controller()
class ProbeController {
  private readonly logger = new Logger('ProbeModule');

  @Get('boom')
  boom(): never {
    this.logger.log('a punto de fallar, cliente ana@example.com');
    throw new Error('fallo interno password=hunter2 en SELECT * FROM kuota.audit_events');
  }

  @Get('health/probe')
  health(): { status: 'ok' } {
    this.logger.log('log desde una ruta sin prefijo');
    return { status: 'ok' };
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

let logs = '';
const logStream = new Writable({
  write(chunk: Buffer, _enc, done) {
    logs += chunk.toString();
    recordOutput(chunk.toString()); // SC-009 · T102: captura de la suite
    done();
  },
});

let app: INestApplication | undefined;
async function start(env: Record<string, string>): Promise<string> {
  logs = '';
  app = await createApp(loadConfig(validEnv(env)), { devModules: [FakeDevModule], modules: [ProbeModule], logStream });
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('bootstrap real de Kuota Core (T025)', () => {
  it('una ruta inexistente → 404 problem+json con correlación y log JSON; sin X-Powered-By', async () => {
    const url = await start({ KUOTA_ENV: 'local' });
    const res = await fetch(`${url}/v1/no-existe`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.headers.get('x-powered-by')).toBeNull();
    const body = (await res.json()) as { code: string; correlation_id: string };
    expect(body.code).toBe('not-found');
    expect(res.headers.get('x-correlation-id')).toBe(body.correlation_id);
    expect(logs).toContain(`"correlation_id":"${body.correlation_id}"`);
  });

  it('500 saneado: sin stack, SQL ni secretos en la respuesta, y log redactado con la misma correlación', async () => {
    const url = await start({ KUOTA_ENV: 'local' });
    const res = await fetch(`${url}/v1/boom`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ code: 'internal-error', status: 500 });
    for (const leak of ['hunter2', 'SELECT', 'stack']) expect(text).not.toContain(leak);
    expect(logs).not.toContain('hunter2');
    expect(logs).not.toContain('ana@example.com');
    expect(logs).toContain(`"correlation_id":"${(JSON.parse(text) as { correlation_id: string }).correlation_id}"`);
  });

  it('las rutas versionadas llevan /v1 y las sondas health/* no', async () => {
    const url = await start({ KUOTA_ENV: 'local' });
    expect((await fetch(`${url}/health/probe`)).status).toBe(200);
    expect((await fetch(`${url}/v1/health/probe`)).status).toBe(404);
    expect((await fetch(`${url}/boom`)).status).toBe(404);
  });

  it('los logs de rutas sin prefijo (/health/*) también llevan correlation_id del CLS', async () => {
    const url = await start({ KUOTA_ENV: 'local' });
    const res = await fetch(`${url}/health/probe`);
    const line = logs.split('\n').find((l) => l.includes('log desde una ruta sin prefijo'));
    expect((JSON.parse(line!) as { correlation_id?: string }).correlation_id).toBe(res.headers.get('x-correlation-id'));
  });

  it('el arranque registra los logs de Nest una sola vez (sin duplicados)', async () => {
    await start({ KUOTA_ENV: 'local' });
    const started = logs.split('\n').filter((l) => l.includes('Nest application successfully started'));
    expect(started).toHaveLength(1);
  });

  for (const env of ['local', 'testing']) {
    it(`registra los módulos de desarrollo con KUOTA_ENV=${env} y el contexto técnico activo`, async () => {
      const url = await start({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'enabled' });
      expect((await fetch(`${url}/v1/dev/ping`)).status).toBe(200);
    });
  }

  const disabledCases: Array<[string, Record<string, string>]> = [
    ['local sin contexto técnico', { KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'disabled' }],
    ['staging', { KUOTA_ENV: 'staging', KUOTA_METRICS_TOKEN: STRONG_TOKEN }],
    ['production', { KUOTA_ENV: 'production', KUOTA_METRICS_TOKEN: STRONG_TOKEN }],
  ];
  for (const [name, env] of disabledCases) {
    it(`no registra ninguna ruta de desarrollo en ${name}, aunque se envíe el encabezado técnico`, async () => {
      const url = await start(env);
      const res = await fetch(`${url}/v1/dev/ping`, {
        headers: { 'x-kuota-dev-tenant': '0193b6f0-0000-7000-8000-000000000001' },
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe('not-found');
    });
  }

  it('arranca con el registro real de módulos de desarrollo: dev-probe montado en local (G7b; ausencia: T096)', async () => {
    logs = '';
    app = await createApp(loadConfig(validEnv({ KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'enabled' })), {
      logStream,
    });
    await app.listen(0, '127.0.0.1');
    // La ruta existe: sin contexto técnico responde 401 del guard (no 404).
    expect((await fetch(`${await app.getUrl()}/v1/dev/probe-items`)).status).toBe(401);
  });

  /** Registros con un `event` dado (T101). */
  function events(name: string): Array<Record<string, unknown>> {
    return logs
      .split('\n')
      .filter((line) => line.includes(`"event":"${name}"`))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('T101: un único evento service.started con entorno, versión y módulos, sin secretos ni URLs', async () => {
    const env = {
      KUOTA_ENV: 'local',
      KUOTA_DEV_TENANT_CONTEXT: 'enabled',
      KUOTA_METRICS_TOKEN: STRONG_TOKEN,
      DATABASE_URL_APP: 'postgresql://kuota_app_login:ficticio-secreto-db@127.0.0.1:55432/kuota',
      KUOTA_CORS_ALLOWED_ORIGINS: 'http://localhost:8080',
    };
    logs = '';
    app = await createApp(loadConfig(validEnv(env)), { logStream });
    await app.listen(0, '127.0.0.1');
    const lifecycle = app.get(LifecycleEvents);
    lifecycle.started({ api: 3000, metrics: 9464 });
    lifecycle.started({ api: 3000, metrics: 9464 });

    const started = events('service.started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      level: 'info',
      module: 'Lifecycle',
      env: 'local',
      api_version: loadConfig(validEnv(env)).apiVersion,
      modules: ['tenant-context', 'metrics', 'health', 'meta', 'dev-probe'],
      port: 3000,
      metrics_port: 9464,
    });
    for (const leak of ['ficticio-secreto-db', STRONG_TOKEN, 'postgresql://', 'localhost:8080', '55432']) {
      expect(JSON.stringify(started[0]), leak).not.toContain(leak);
    }
  });

  it('T101: los módulos de desarrollo no aparecen en service.started fuera de local/testing', async () => {
    logs = '';
    app = await createApp(loadConfig(validEnv({ KUOTA_ENV: 'production', KUOTA_METRICS_TOKEN: STRONG_TOKEN })), {
      logStream,
    });
    app.get(LifecycleEvents).started({ api: 3000, metrics: 9464 });
    // Solo `modules`: `env` sale de la base de pino, y nestjs-pino 5 conserva un único logger raíz por proceso, así que
    // en este proceso de pruebas (varias apps) lleva el entorno de la primera. En el proceso real hay una sola app.
    expect(events('service.started')[0]!['modules']).toStrictEqual(['tenant-context', 'metrics', 'health', 'meta']);
  });

  it('T101: un único evento service.stopped al cerrar, con señal y tiempo en marcha', async () => {
    await start({ KUOTA_ENV: 'local' });
    app!.get(LifecycleEvents).started({ api: 3000, metrics: 9464 });
    await app!.close();
    app = undefined;
    const stopped = events('service.stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatchObject({ level: 'info', module: 'Lifecycle', signal: 'close' });
    expect(typeof stopped[0]!['uptime_ms']).toBe('number');
  });
});
