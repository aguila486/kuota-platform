import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule, devModulesEnabled } from '../../src/app.module.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { DEV_ONLY_MODULES } from '../../src/dev-modules.js';
import { STRONG_TOKEN, validEnv } from '../support/env.js';

describe('AppModule (T025)', () => {
  it('compila el contenedor de inyección de dependencias con la configuración real', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(loadConfig(validEnv()))],
    }).compile();
    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    await moduleRef.close();
  });

  it('habilita módulos de desarrollo solo en local/testing con KUOTA_DEV_TENANT_CONTEXT=enabled', () => {
    const cases: Array<[Record<string, string>, boolean]> = [
      [{ KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'enabled' }, true],
      [{ KUOTA_ENV: 'testing', KUOTA_DEV_TENANT_CONTEXT: 'enabled' }, true],
      [{ KUOTA_ENV: 'local', KUOTA_DEV_TENANT_CONTEXT: 'disabled' }, false],
      [{ KUOTA_ENV: 'staging', KUOTA_METRICS_TOKEN: STRONG_TOKEN }, false],
      [{ KUOTA_ENV: 'production', KUOTA_METRICS_TOKEN: STRONG_TOKEN }, false],
    ];
    for (const [env, expected] of cases)
      expect(devModulesEnabled(loadConfig(validEnv(env))), JSON.stringify(env)).toBe(expected);
  });

  it('en G5 el registro de módulos de desarrollo está vacío (dev-probe llega en G7)', () => {
    expect(DEV_ONLY_MODULES).toEqual([]);
  });
});
