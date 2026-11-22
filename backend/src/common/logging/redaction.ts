import { isDevelopmentEnv, type KuotaEnv } from '../config/app-config.js';

/** Redacción de datos sensibles en logs (FR-010, R-15). */
export const REDACTED = '[REDACTED]';

/** Claves cuyo valor nunca se emite, a cualquier profundidad (comparación sin mayúsculas). */
const SENSITIVE_KEYS = new Set([
  'phone',
  'email',
  'password',
  'otp',
  'pin',
  'token',
  'access_token',
  'refresh_token',
  'tax_id',
  'curp',
  'rfc',
  'authorization',
  'cookie',
  'set-cookie',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 10 a 15 dígitos con separadores opcionales; no empieza ni termina pegado a letras, dígitos o guiones (evita UUID).
const PHONE = /(?<![\w-])\+?\d(?:[\s().-]?\d){9,14}(?![\w-])/g;
const KEY_VALUE_SECRET = /\b(password|passwd|pwd|secret|token|otp|pin|api[_-]?key)(\s*[=:]\s*)[^\s,;&]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

/** Enmascara correos, teléfonos y secretos tipo `clave=valor` o `Bearer …` en texto libre. */
export function maskSensitiveText(text: string): string {
  return text
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(KEY_VALUE_SECRET, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(EMAIL, '[REDACTED:email]')
    .replace(PHONE, '[REDACTED:phone]');
}

const MAX_DEPTH = 8;

/** Copia saneada de un valor de log: redacta claves sensibles y enmascara texto, a cualquier profundidad. */
export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskSensitiveText(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return {
      type: value.name,
      message: maskSensitiveText(value.message),
      stack: value.stack ? maskSensitiveText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, depth + 1));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : sanitizeLogValue(item, depth + 1);
  }
  return out;
}

/** Rutas de `redact` de pino para los objetos que serializa pino-http (encabezados). */
export function buildRedactPaths(env: KuotaEnv): string[] {
  const paths = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];
  // Los encabezados técnicos solo tienen sentido en local/testing; fuera de ahí se tratan como datos no confiables.
  if (!isDevelopmentEnv(env)) paths.push('req.headers["x-kuota-dev-tenant"]', 'req.headers["x-kuota-dev-actor"]');
  return paths;
}
