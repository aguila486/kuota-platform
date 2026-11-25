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

/**
 * KUOTA_CORS_ALLOWED_ORIGINS (Aprobación 8): lista separada por comas de orígenes EXACTOS y canónicos
 * (`esquema://host[:puerto]`, como los envía el navegador en `Origin`). Se rechazan comodines, `null`, rutas, barras
 * finales, credenciales y puertos por defecto explícitos. Fuera de local/testing solo `https` y nunca loopback.
 */
function parseCorsOrigins(raw: string | undefined, development: boolean, issues: string[]): string[] {
  if (raw === undefined) return [];
  const name = 'KUOTA_CORS_ALLOWED_ORIGINS';
  const origins: string[] = [];
  raw.split(',').forEach((part, index) => {
    const entry = part.trim();
    const position = `${name}[${index}]`;
    if (entry === '') return void issues.push(`${position} está vacío`);
    if (entry.includes('*')) return void issues.push(`${position}: no se admiten comodines`);
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      return void issues.push(`${position} no es un origen válido (esquema://host[:puerto])`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return void issues.push(`${position} debe usar http o https`);
    }
    if (url.origin !== entry) {
      return void issues.push(
        `${position} debe ser un origen exacto y canónico, sin ruta, barra final ni credenciales`,
      );
    }
    if (!development) {
      if (url.protocol !== 'https:') issues.push(`${position} debe usar https fuera de local/testing`);
      if (isLoopback(url.hostname.replace(/^\[|\]$/g, ''))) {
        issues.push(`${position} no puede ser loopback fuera de local/testing`);
      }
    }
    if (!origins.includes(entry)) origins.push(entry);
  });
  return origins;
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

  const allowedOrigins = parseCorsOrigins(
    read('KUOTA_CORS_ALLOWED_ORIGINS'),
    rawEnv === undefined || isDevelopmentEnv(kuotaEnv),
    issues,
  );

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
    cors: { allowedOrigins },
  };
}
