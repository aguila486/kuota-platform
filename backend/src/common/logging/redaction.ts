import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

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
/** Sustituye a una solicitud, respuesta o socket que se pase a un log por error (nunca se serializan completos). */
export const OMITTED_HTTP_OBJECT = '[OMITTED:http-object]';
const isHttpObject = (value: object): boolean =>
  value instanceof IncomingMessage || value instanceof ServerResponse || value instanceof Socket;

/** Copia saneada de un valor de log: redacta claves sensibles y enmascara texto, a cualquier profundidad. */
export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskSensitiveText(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (isHttpObject(value)) return OMITTED_HTTP_OBJECT;
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

/**
 * Campos de primer nivel que tienen serializador propio por lista permitida (http-log.ts): `formatters.log` los deja
 * pasar sin tocar para que el serializador reciba el objeto crudo. Cualquier otra aparición de un objeto HTTP se omite.
 */
const SERIALIZED_KEYS = new Set(['req', 'res']);

/** `formatters.log`: sanea el objeto de un log (claves sensibles, texto y objetos HTTP accidentales). */
export function sanitizeLogObject(object: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    out[key] = SERIALIZED_KEYS.has(key)
      ? item
      : SENSITIVE_KEYS.has(key.toLowerCase())
        ? REDACTED
        : sanitizeLogValue(item, 1);
  }
  return out;
}

/**
 * Rutas de `redact` de pino: defensa adicional, NO el mecanismo principal. Con los serializadores por lista permitida
 * estos campos no existen; si un cambio futuro los reintrodujera, se censuran igualmente.
 */
export function buildRedactPaths(): string[] {
  const paths = [
    'req.headers',
    'req.remoteAddress',
    'req.remotePort',
    'req.url',
    'req.query',
    'req.params',
    'req.body',
    'res.headers',
  ];
  return paths;
}
