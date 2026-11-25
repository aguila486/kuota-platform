import { spawn } from 'node:child_process';
import { type AddressInfo, createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BuiltMain, buildPrivateMain } from '../support/built-main.js';
import { STRONG_TOKEN, validEnv } from '../support/env.js';
import { recordOutput } from '../support/log-capture.js';

/**
 * T025: el proceso real `node dist/main.js` (build SWC) arranca con configuración válida y aborta con una inválida.
 * Se ejecuta una copia privada del build (`buildPrivateMain`): otras suites compilan en paralelo y `nest build` borra dist/.
 */
const BACKEND_DIR = join(__dirname, '../..');
let built: BuiltMain;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function run(env: Record<string, string | undefined>, untilListening: boolean) {
  const child = spawn(process.execPath, [built.main], { cwd: BACKEND_DIR, env: { PATH: process.env['PATH'], ...env } });
  let stdout = '';
  let stderr = '';
  // SC-009 · T102: la salida del proceso real también entra en la captura de la suite.
  child.stdout.on('data', (c: Buffer) => {
    stdout += c.toString();
    recordOutput(c.toString());
  });
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
    recordOutput(c.toString());
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const ready = untilListening
    ? new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no arrancó: ${stdout}${stderr}`)), 20_000);
        child.stdout.on('data', () => {
          if (stdout.includes('Nest application successfully started')) {
            clearTimeout(timer);
            resolve();
          }
        });
      })
    : Promise.resolve();
  return { child, exited, ready, output: () => ({ stdout, stderr }) };
}

describe('proceso main.ts (T025)', () => {
  beforeAll(async () => {
    built = await buildPrivateMain();
  }, 180_000);
  afterAll(() => built?.cleanup());

  it('arranca con configuración válida, responde problem+json y emite logs JSON', async () => {
    const port = await freePort();
    const metricsPort = await freePort();
    const proc = run(
      validEnv({
        PORT: String(port),
        KUOTA_METRICS_PORT: String(metricsPort),
        KUOTA_METRICS_TOKEN: STRONG_TOKEN,
        DATABASE_URL_APP: 'postgresql://kuota_app_login:ficticio-secreto-db@127.0.0.1:55432/kuota',
      }),
      true,
    );
    try {
      await proc.ready;
      // T094: el proceso abre la escucha de métricas protegida, separada del puerto de la API.
      const metricsUrl = `http://127.0.0.1:${metricsPort}/metrics`;
      const scrape = async (headers: Record<string, string> = {}) => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await fetch(metricsUrl, { headers });
          } catch (error) {
            if (attempt >= 50) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      };
      expect((await scrape()).status).toBe(401);
      expect((await scrape({ authorization: `Bearer ${STRONG_TOKEN}` })).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(404);
      const res = await fetch(`http://127.0.0.1:${port}/v1/no-existe`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      const lines = proc.output().stdout.trim().split('\n');
      expect(lines.every((line) => (JSON.parse(line) as { service: string }).service === 'kuota-core')).toBe(true);
      expect(proc.output().stdout).not.toContain('ficticio-secreto-db');
      // T101: un único evento de arranque, emitido cuando ambas escuchas están abiertas.
      const started = lines.filter((line) => line.includes('"event":"service.started"'));
      expect(started).toHaveLength(1);
      expect(JSON.parse(started[0]!)).toMatchObject({
        level: 'info',
        env: 'local',
        port,
        metrics_port: metricsPort,
        modules: expect.arrayContaining(['health', 'meta', 'metrics', 'tenant-context']) as unknown,
      });
      expect(started[0]).not.toContain(STRONG_TOKEN);
    } finally {
      proc.child.kill('SIGTERM');
      await proc.exited;
    }
    // T101: al recibir SIGTERM, un único evento de apagado con la señal.
    const stopped = proc
      .output()
      .stdout.split('\n')
      .filter((line) => line.includes('"event":"service.stopped"'));
    expect(stopped).toHaveLength(1);
    expect(JSON.parse(stopped[0]!)).toMatchObject({ level: 'info', signal: 'SIGTERM' });
  });

  it('aborta con código 1 si la configuración es inválida, sin revelar valores', async () => {
    const proc = run(
      validEnv({
        KUOTA_ENV: 'production',
        KUOTA_DEV_TENANT_CONTEXT: 'enabled',
        KUOTA_METRICS_TOKEN: STRONG_TOKEN,
        DATABASE_URL_APP: 'postgresql://kuota_migrator:ficticio-secreto-db@127.0.0.1:55432/kuota',
      }),
      false,
    );
    expect(await proc.exited).toBe(1);
    const { stdout, stderr } = proc.output();
    const record = JSON.parse(stderr.trim()) as { level: string; issues: string[] };
    expect(record.level).toBe('fatal');
    expect(record.issues.join('\n')).toMatch(/KUOTA_DEV_TENANT_CONTEXT/);
    expect(record.issues.join('\n')).toMatch(/DATABASE_URL_APP/);
    expect(stderr + stdout).not.toContain('ficticio-secreto-db');
    expect(stderr + stdout).not.toContain(STRONG_TOKEN);
    expect(stdout).not.toContain('Nest application successfully started');
    expect(stdout).not.toContain('service.started');
  });

  it('termina con código 1 si la escucha de métricas no puede abrirse (puerto ocupado), sin revelar el token', async () => {
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const metricsPort = (busy.address() as AddressInfo).port;
    try {
      const proc = run(
        validEnv({
          PORT: String(await freePort()),
          KUOTA_METRICS_PORT: String(metricsPort),
          KUOTA_METRICS_TOKEN: STRONG_TOKEN,
          DATABASE_URL_APP: 'postgresql://kuota_app_login:ficticio-secreto-db@127.0.0.1:55432/kuota',
        }),
        false,
      );
      expect(await proc.exited).toBe(1);
      const { stdout, stderr } = proc.output();
      const fatal = JSON.parse(stderr.trim().split('\n').at(-1)!) as { level: string; msg: string; reason: string };
      expect(fatal).toMatchObject({ level: 'fatal', reason: 'EADDRINUSE' });
      expect(fatal.msg).toMatch(/métricas/);
      expect(stderr + stdout).not.toContain(STRONG_TOKEN);
      expect(stderr + stdout).not.toContain('ficticio-secreto-db');
      // T101: sin escucha de métricas no hay evento de arranque (el servicio no llegó a estar disponible).
      expect(stdout).not.toContain('"event":"service.started"');
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }
  });
});
