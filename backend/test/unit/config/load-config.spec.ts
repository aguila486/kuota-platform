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
      cors: { allowedOrigins: [] },
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

  describe('KUOTA_CORS_ALLOWED_ORIGINS (Aprobación 8)', () => {
    const origins = (env: Record<string, string>) => loadConfig(validEnv(env)).cors.allowedOrigins;

    it('sin variable (o vacía) no hay orígenes permitidos', () => {
      expect(origins({})).toEqual([]);
      expect(origins({ KUOTA_CORS_ALLOWED_ORIGINS: '  ' })).toEqual([]);
    });

    it('acepta orígenes exactos separados por comas, sin duplicados', () => {
      expect(
        origins({ KUOTA_CORS_ALLOWED_ORIGINS: 'http://localhost:8080, http://127.0.0.1:8080,http://localhost:8080' }),
      ).toEqual(['http://localhost:8080', 'http://127.0.0.1:8080']);
      expect(
        origins({
          KUOTA_ENV: 'production',
          KUOTA_METRICS_TOKEN: 'x'.repeat(32),
          KUOTA_CORS_ALLOWED_ORIGINS: 'https://admin.example.test',
        }),
      ).toEqual(['https://admin.example.test']);
    });

    it.each([
      ['*', /comodines/],
      ['https://*.example.test', /comodines/],
      ['null', /origen válido/],
      ['localhost:8080', /http o https/],
      ['ftp://example.test', /http o https/],
      ['http://localhost:8080/', /exacto y canónico/],
      ['http://localhost:8080/admin', /exacto y canónico/],
      ['http://LOCALHOST:8080', /exacto y canónico/],
      ['http://localhost:80', /exacto y canónico/],
      ['http://user:pw@localhost:8080', /exacto y canónico/],
      ['http://localhost:8080,', /\[1\] está vacío/],
    ])('rechaza %s', (value, message) => {
      expect(() => origins({ KUOTA_CORS_ALLOWED_ORIGINS: value })).toThrow(message);
    });

    it('fuera de local/testing exige https y prohíbe loopback', () => {
      const prod = (value: string) =>
        origins({ KUOTA_ENV: 'staging', KUOTA_METRICS_TOKEN: 'x'.repeat(32), KUOTA_CORS_ALLOWED_ORIGINS: value });
      expect(() => prod('http://admin.example.test')).toThrow(/https fuera de local\/testing/);
      expect(() => prod('https://localhost:8080')).toThrow(/loopback/);
      expect(() => prod('https://127.0.0.1')).toThrow(/loopback/);
      expect(() => prod('https://[::1]:8443')).toThrow(/loopback/);
      expect(origins({ KUOTA_ENV: 'testing', KUOTA_CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:8080' })).toEqual([
        'http://127.0.0.1:8080',
      ]);
    });
  });
});
