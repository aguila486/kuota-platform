/** Configuración validada de Kuota Core (T016). Se construye una sola vez al arrancar con `loadConfig`. */
export const KUOTA_ENVIRONMENTS = ['local', 'testing', 'staging', 'production'] as const;
export type KuotaEnv = (typeof KUOTA_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  readonly env: KuotaEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Contexto técnico de tenant (R-05). Solo puede ser true en local/testing. */
  readonly devTenantContext: boolean;
  readonly apiVersion: string;
  readonly minSupported: { readonly admin: string; readonly collector: string; readonly client: string };
  /** Escucha interna de métricas (R-21). `token` es obligatorio fuera de local/testing o fuera de loopback. */
  readonly metrics: { readonly host: string; readonly port: number; readonly token: string | undefined };
  /** Solo la credencial de runtime (kuota_app_login). La de migración nunca se carga en la API. */
  readonly database: { readonly appUrl: string };
  /**
   * CORS (Aprobación 8): orígenes exactos que pueden leer las respuestas desde un navegador (Kuota Admin en Flutter
   * Web). Vacío → sin CORS: el navegador bloquea toda lectura de otro origen. Nunca comodines ni orígenes reflejados.
   */
  readonly cors: { readonly allowedOrigins: readonly string[] };
}

/** Token de inyección de la configuración. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export function isDevelopmentEnv(env: KuotaEnv): boolean {
  return env === 'local' || env === 'testing';
}

/** R-05 · FR-040: el contexto técnico de tenant solo existe en local/testing con KUOTA_DEV_TENANT_CONTEXT=enabled. */
export function devTenantContextEnabled(config: Pick<AppConfig, 'env' | 'devTenantContext'>): boolean {
  return isDevelopmentEnv(config.env) && config.devTenantContext;
}
