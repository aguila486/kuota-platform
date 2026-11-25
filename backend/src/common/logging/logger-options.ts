import { ClsServiceManager } from 'nestjs-cls';
import pino, { type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/app-config.js';
import { buildRedactPaths, maskSensitiveText, REDACTED, sanitizeLogObject } from './redaction.js';

/** Claves del CLS que lee el logging. Las fija el contexto de tenant (T038); el cliente nunca las aporta. */
export const CLS_TENANT_ID = 'tenantId';
export const CLS_ACTOR_ID = 'actorId';
export const CLS_CORRELATION_ID = 'correlationId';

function contextFields(_merge: object, _level: number, logger: Logger): Record<string, unknown> {
  const cls = ClsServiceManager.getClsService();
  if (!cls.isActive()) return {};
  const fields: Record<string, unknown> = {};
  // El log de acceso de pino-http ya trae correlation_id como binding; no se duplica la clave.
  const correlationId = cls.get<string | undefined>(CLS_CORRELATION_ID);
  if (correlationId !== undefined && !('correlation_id' in logger.bindings())) fields['correlation_id'] = correlationId;
  const tenantId = cls.get<string | undefined>(CLS_TENANT_ID);
  const actorId = cls.get<string | undefined>(CLS_ACTOR_ID);
  if (tenantId !== undefined) fields['tenant_id'] = tenantId;
  if (actorId !== undefined) fields['actor_id'] = actorId;
  return fields;
}

/** Opciones de pino de Kuota Core (FR-009, FR-010, R-15): JSON, nivel textual, hora ISO y redacción. */
export function buildLoggerOptions(config: AppConfig): LoggerOptions {
  return {
    level: config.logLevel,
    base: { service: 'kuota-core', env: config.env },
    messageKey: 'msg',
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: contextFields,
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => sanitizeLogObject(object),
    },
    hooks: {
      logMethod(args, method) {
        const masked = args.map((arg: unknown) => (typeof arg === 'string' ? maskSensitiveText(arg) : arg));
        method.apply(this, masked as Parameters<typeof method>);
      },
    },
    redact: { paths: buildRedactPaths(), censor: REDACTED },
  };
}
