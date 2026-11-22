import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '../../../src/common/config/config.module.js';
import { ConfigValidationError, loadConfig } from '../../../src/common/config/load-config.js';
import { STRONG_TOKEN, validEnv } from '../../support/env.js';

// T017 · R-05 · FR-040: el contexto técnico de tenant nunca puede activarse en staging/production.
describe('guard de arranque: contexto técnico de tenant (R-05)', () => {
  for (const env of ['staging', 'production']) {
    it(`aborta con KUOTA_ENV=${env} y KUOTA_DEV_TENANT_CONTEXT=enabled`, () => {
      const call = () =>
        loadConfig(
          validEnv({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'enabled', KUOTA_METRICS_TOKEN: STRONG_TOKEN }),
        );
      expect(call).toThrow(ConfigValidationError);
      expect(call).toThrow(/KUOTA_DEV_TENANT_CONTEXT/);
    });

    it(`es válido con KUOTA_ENV=${env} si el mecanismo está deshabilitado`, () => {
      const config = loadConfig(
        validEnv({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'disabled', KUOTA_METRICS_TOKEN: STRONG_TOKEN }),
      );
      expect(config.devTenantContext).toBe(false);
    });
  }

  for (const env of ['local', 'testing']) {
    it(`permite el mecanismo con KUOTA_ENV=${env}`, () => {
      expect(loadConfig(validEnv({ KUOTA_ENV: env, KUOTA_DEV_TENANT_CONTEXT: 'enabled' })).devTenantContext).toBe(true);
    });
  }

  it('está deshabilitado por defecto y rechaza valores distintos de enabled/disabled', () => {
    expect(loadConfig(validEnv()).devTenantContext).toBe(false);
    expect(() => loadConfig(validEnv({ KUOTA_DEV_TENANT_CONTEXT: 'yes' }))).toThrow(/KUOTA_DEV_TENANT_CONTEXT/);
  });

  it('el arranque de Nest falla si la configuración es inválida', async () => {
    const env = validEnv({
      KUOTA_ENV: 'production',
      KUOTA_DEV_TENANT_CONTEXT: 'enabled',
      KUOTA_METRICS_TOKEN: STRONG_TOKEN,
    });
    await expect(Test.createTestingModule({ imports: [ConfigModule.forRoot(env)] }).compile()).rejects.toBeInstanceOf(
      ConfigValidationError,
    );
  });
});
