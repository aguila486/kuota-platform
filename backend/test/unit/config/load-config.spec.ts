import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from '../../../src/common/config/load-config.js';
import { validEnv } from '../../support/env.js';

// T016: validación del resto de variables de entorno (.env.example).
describe('loadConfig', () => {
  it('carga una configuración válida con valores por defecto', () => {
    expect(loadConfig(validEnv())).toEqual({
      env: 'local',
      port: 3000,
      logLevel: 'info',
      devTenantContext: false,
      apiVersion: '1.0.0',
      minSupported: { admin: '0.1.0', collector: '0.1.0', client: '0.1.0' },
      metrics: { host: '127.0.0.1', port: 9464, token: undefined },
      database: { appUrl: 'postgresql://kuota_app_login:ficticio@127.0.0.1:55432/kuota' },
    });
  });

  it('reúne todos los errores en un solo ConfigValidationError', () => {
    try {
      loadConfig({ KUOTA_ENV: 'qa', PORT: 'abc', LOG_LEVEL: 'verbose', API_VERSION: 'v1' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const issues = (error as ConfigValidationError).issues.join('\n');
      for (const name of ['KUOTA_ENV', 'PORT', 'LOG_LEVEL', 'API_VERSION', 'MIN_SUPPORTED_ADMIN', 'DATABASE_URL_APP']) {
        expect(issues).toContain(name);
      }
    }
  });

  it('exige DATABASE_URL_APP de PostgreSQL y rechaza credenciales privilegiadas en runtime (FR-014)', () => {
    expect(() => loadConfig(validEnv({ DATABASE_URL_APP: 'mysql://x@h/db' }))).toThrow(/DATABASE_URL_APP/);
    expect(() => loadConfig(validEnv({ DATABASE_URL_APP: 'no es una url' }))).toThrow(/DATABASE_URL_APP/);
    for (const user of ['kuota_migrator', 'postgres']) {
      const call = () =>
        loadConfig(validEnv({ DATABASE_URL_APP: `postgresql://${user}:ficticio@127.0.0.1:55432/kuota` }));
      expect(call).toThrow(/DATABASE_URL_APP/);
      expect(call).not.toThrow(/ficticio/);
    }
  });

  it('no carga la credencial de migración en la configuración de runtime', () => {
    const config = loadConfig(
      validEnv({ DATABASE_URL_MIGRATOR: 'postgresql://kuota_migrator:ficticio@127.0.0.1/kuota' }),
    );
    expect(JSON.stringify(config)).not.toContain('kuota_migrator');
  });

  it('acepta los niveles de log de pino y valida semver con build opcional', () => {
    expect(loadConfig(validEnv({ LOG_LEVEL: 'debug' })).logLevel).toBe('debug');
    expect(loadConfig(validEnv({ MIN_SUPPORTED_COLLECTOR: '1.4.2+120' })).minSupported.collector).toBe('1.4.2+120');
    expect(() => loadConfig(validEnv({ MIN_SUPPORTED_CLIENT: '1.4' }))).toThrow(/MIN_SUPPORTED_CLIENT/);
  });
});
