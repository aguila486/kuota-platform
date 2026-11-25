/** Entorno mínimo válido para pruebas de configuración (valores ficticios). */
export function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    KUOTA_ENV: 'local',
    DATABASE_URL_APP: 'postgresql://kuota_app_login:ficticio@127.0.0.1:55432/kuota',
    API_VERSION: '1.0.0',
    MIN_SUPPORTED_ADMIN: '0.1.0',
    MIN_SUPPORTED_COLLECTOR: '0.1.0',
    MIN_SUPPORTED_CLIENT: '0.1.0',
    ...overrides,
  };
}

export const STRONG_TOKEN = 'ficticio-token-recolector-0123456789abcdef';
