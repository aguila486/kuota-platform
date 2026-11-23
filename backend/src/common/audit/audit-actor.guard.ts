import { type CanActivate, Injectable, UseGuards } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { KuotaProblemError } from '../errors/problem.js';
import { TenantContext } from '../tenant-context/tenant-context.js';
import { type AuditOrigin, CLS_AUDIT_ORIGIN } from './audit.service.js';

/** Campo que se informa cuando falta el actor. En 001 la única fuente es el encabezado técnico (solo local/testing). */
export const DEV_ACTOR_FIELD = 'X-Kuota-Dev-Actor';
/** `audit_events.origin` de las operaciones que llegan por HTTP: origen lógico, sin datos de red (data-model.md). */
export const AUDIT_ORIGIN_HTTP: AuditOrigin = 'http';

/**
 * Política de actor aprobada (US6, 2026-11-22): una operación que genera auditoría exige un actor explícito y válido. No
 * hay actor por defecto. Se ejecuta DESPUÉS del guard de contexto y ANTES de cualquier escritura (idempotencia,
 * comando y auditoría):
 * - sin actor → 400 `validation-error` con el campo del actor, sin reflejar valores;
 * - con actor, fija `audit_events.origin` = `http`, el origen lógico. Minimización aprobada el 2026-11-23
 *   (Aprobación 5): el guard NO lee la solicitud, de modo que ni la IP del socket, ni `X-Forwarded-For`/`X-Real-IP`,
 *   ni un hash de ellas pueden llegar a la auditoría. El origen no es identidad ni autorización.
 *
 * El actor procede del `TenantContext`. En 001 lo fija `DevTenantGuard` desde `X-Kuota-Dev-Actor`, que ya validó su
 * formato (400 si es inválido) y solo existe en local/testing. La identidad autenticada de producción es 002.
 */
@Injectable()
export class AuditActorGuard implements CanActivate {
  constructor(
    private readonly context: TenantContext,
    private readonly cls: ClsService,
  ) {}

  canActivate(): boolean {
    const ctx = this.context.require();
    if (ctx.actorId === null) {
      throw new KuotaProblemError('validation-error', {
        detail: 'Esta operación se audita y exige un actor explícito',
        errors: [
          { field: DEV_ACTOR_FIELD, message: 'Obligatorio en operaciones auditadas: 1–64 caracteres [A-Za-z0-9_.:-]' },
        ],
      });
    }
    this.cls.set(CLS_AUDIT_ORIGIN, AUDIT_ORIGIN_HTTP);
    return true;
  }
}

/** Marca una operación como auditada: exige actor y fija el origen (T077, T078). Va después del guard de contexto. */
export const Audited = (): MethodDecorator => UseGuards(AuditActorGuard);
