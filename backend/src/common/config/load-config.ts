import { isIP } from 'node:net';
import {
  type AppConfig,
  isDevelopmentEnv,
  KUOTA_ENVIRONMENTS,
  type KuotaEnv,
  LOG_LEVELS,
  type LogLevel,
} from './app-config.js';

/**
 * Error de configuración: el arranque se aborta (T016). Los mensajes nombran la variable y la regla, nunca el valor,
 * para no filtrar secretos.
 */
export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuración inválida:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigValidationError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const SEMVER = /^\d+\.\d+\.\d+(\+\d+)?$/;
const MIN_METRICS_TOKEN_LENGTH = 32;
/** Usuarios de base de datos que la API nunca debe usar (FR-014): propietario de esquema y superusuario. */
const PRIVILEGED_DB_USERS = new Set(['kuota_migrator', 'postgres']);

function isLoopback(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  return isIP(host) === 4 && host.startsWith('127.');
}

export function loadConfig(env: Env): AppConfig {
  const issues: string[] = [];
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };

  const rawEnv = read('KUOTA_ENV');
  if (!rawEnv || !(KUOTA_ENVIRONMENTS as readonly string[]).includes(rawEnv)) {
    issues.push(`KUOTA_ENV es obligatoria y debe ser una de: ${KUOTA_ENVIRONMENTS.join(', ')}`);
  }
  const kuotaEnv = (rawEnv ?? 'local') as KuotaEnv;

  const port = (name: string, fallback: number): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < 1 || value > 65_535) {
      issues.push(`${name} debe ser un puerto entre 1 y 65535`);
      return fallback;
    }
    return value;
  };

  const rawLevel = read('LOG_LEVEL') ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(rawLevel))
    issues.push(`LOG_LEVEL debe ser uno de: ${LOG_LEVELS.join(', ')}`);

  const rawDevTenant = read('KUOTA_DEV_TENANT_CONTEXT') ?? 'disabled';
  if (rawDevTenant !== 'enabled' && rawDevTenant !== 'disabled') {
    issues.push('KUOTA_DEV_TENANT_CONTEXT debe ser enabled o disabled');
  }
  const devTenantContext = rawDevTenant === 'enabled';
  // R-05 · FR-040: el contexto técnico nunca existe fuera de local/testing.
  if (devTenantContext && rawEnv !== undefined && !isDevelopmentEnv(kuotaEnv)) {
    issues.push(`KUOTA_DEV_TENANT_CONTEXT=enabled está prohibido con KUOTA_ENV=${kuotaEnv} (solo local/testing)`);
  }

  const semver = (name: string): string => {
    const value = read(name);
    if (!value || !SEMVER.test(value)) issues.push(`${name} es obligatoria y debe ser semver (X.Y.Z o X.Y.Z+build)`);
    return value ?? '';
  };
  const apiVersion = semver('API_VERSION');
  const minSupported = {
    admin: semver('MIN_SUPPORTED_ADMIN'),
    collector: semver('MIN_SUPPORTED_COLLECTOR'),
    client: semver('MIN_SUPPORTED_CLIENT'),
  };

  // R-21 · FR-040: métricas internas; token obligatorio fuera de local/testing o si la escucha no es de loopback.
  const metricsHost = read('KUOTA_METRICS_HOST') ?? '127.0.0.1';
  const metricsPort = port('KUOTA_METRICS_PORT', 9464);
  const metricsToken = read('KUOTA_METRICS_TOKEN');
  const tokenRequired = (rawEnv !== undefined && !isDevelopmentEnv(kuotaEnv)) || !isLoopback(metricsHost);
  if (tokenRequired && (metricsToken === undefined || metricsToken.length < MIN_METRICS_TOKEN_LENGTH)) {
    issues.push(
      `KUOTA_METRICS_TOKEN es obligatorio (mínimo ${MIN_METRICS_TOKEN_LENGTH} caracteres) con KUOTA_ENV=${kuotaEnv} o KUOTA_METRICS_HOST fuera de loopback`,
    );
  }

  const appUrl = read('DATABASE_URL_APP');
  if (!appUrl) {
    issues.push('DATABASE_URL_APP es obligatoria (credencial de runtime kuota_app_login)');
  } else {
    let parsed: URL | undefined;
    try {
      parsed = new URL(appUrl);
    } catch {
      issues.push('DATABASE_URL_APP no es una URL válida');
    }
    if (parsed) {
      if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
        issues.push('DATABASE_URL_APP debe usar el esquema postgresql://');
      }
      if (PRIVILEGED_DB_USERS.has(decodeURIComponent(parsed.username))) {
        issues.push(
          'DATABASE_URL_APP no puede usar una credencial privilegiada (propietario o superusuario); usa kuota_app_login',
        );
      }
    }
  }

  const appPort = port('PORT', 3000);
  if (issues.length > 0) throw new ConfigValidationError(issues);

  return {
    env: kuotaEnv,
    port: appPort,
    logLevel: rawLevel as LogLevel,
    devTenantContext,
    apiVersion,
    minSupported,
    metrics: { host: metricsHost, port: metricsPort, token: metricsToken },
    database: { appUrl: appUrl! },
  };
}
