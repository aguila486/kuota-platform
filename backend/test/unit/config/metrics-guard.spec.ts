import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from '../../../src/common/config/load-config.js';
import { STRONG_TOKEN, validEnv } from '../../support/env.js';

// T017 · R-21 · FR-040: el endpoint de métricas exige token del recolector fuera de local/testing o sin loopback.
describe('guard de arranque: métricas internas y protegidas (R-21)', () => {
  it('por defecto escucha en 127.0.0.1:9464 y en local no exige token', () => {
    const { metrics } = loadConfig(validEnv());
    expect(metrics).toEqual({ host: '127.0.0.1', port: 9464, token: undefined });
  });

  for (const env of ['staging', 'production']) {
    it(`aborta en ${env} sin token o con token de menos de 32 caracteres`, () => {
      expect(() => loadConfig(validEnv({ KUOTA_ENV: env }))).toThrow(/KUOTA_METRICS_TOKEN/);
      expect(() => loadConfig(validEnv({ KUOTA_ENV: env, KUOTA_METRICS_TOKEN: 'x'.repeat(31) }))).toThrow(
        ConfigValidationError,
      );
      expect(loadConfig(validEnv({ KUOTA_ENV: env, KUOTA_METRICS_TOKEN: 'x'.repeat(32) })).metrics.token).toHaveLength(
        32,
      );
    });
  }

  it('aborta en cualquier entorno si escucha fuera de loopback sin token', () => {
    expect(() => loadConfig(validEnv({ KUOTA_METRICS_HOST: '0.0.0.0' }))).toThrow(/KUOTA_METRICS_TOKEN/);
    expect(
      loadConfig(validEnv({ KUOTA_METRICS_HOST: '0.0.0.0', KUOTA_METRICS_TOKEN: STRONG_TOKEN })).metrics.host,
    ).toBe('0.0.0.0');
  });

  it('reconoce como loopback 127.0.0.0/8, ::1 y localhost', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', '::1', 'localhost']) {
      expect(loadConfig(validEnv({ KUOTA_METRICS_HOST: host })).metrics.host).toBe(host);
    }
  });

  it('los errores no revelan el valor del token', () => {
    const secret = 'secreto-corto';
    try {
      loadConfig(validEnv({ KUOTA_ENV: 'production', KUOTA_METRICS_TOKEN: secret }));
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });

  it('rechaza un puerto de métricas inválido', () => {
    expect(() => loadConfig(validEnv({ KUOTA_METRICS_PORT: '70000' }))).toThrow(/KUOTA_METRICS_PORT/);
  });
});
