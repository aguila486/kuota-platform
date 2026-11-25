import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_ACTOR_ID, CLS_CORRELATION_ID, CLS_TENANT_ID } from '../logging/logger-options.js';

/** Claves CLS adicionales del contexto (las de tenant, actor y correlación las define el logging, G4). */
export const CLS_ACTOR_TYPE = 'actorType';
export const CLS_ACTOR_ROLE = 'actorRole';

/** En 001 solo existe el actor técnico `DEV` (data-model: `audit_events.actor_type`). 002 añade `USER`/`DEVICE`. */
export type ActorType = 'DEV';

/**
 * Contexto de la operación (T038). Lo fija SOLO un guard de `src/common/tenant-context` a partir de una fuente que el
 * servidor considera confiable; nunca un controlador, servicio o repositorio, y nunca un campo del body.
 *
 * Confiable hoy (001): que el valor fue fijado por el servidor y no cambia durante la solicitud. NO confiable hoy: la
 * identidad. En 001 la fuente es `DevTenantGuard` (encabezado técnico, solo local/testing): no autentica ni autoriza a
 * nadie. La garantía de que el tenant pertenece al solicitante llega con la identidad real de 002.
 */
export interface TenantContextValue {
  readonly tenantId: string;
  /** Actor técnico para auditoría; `null` si no se informó. */
  readonly actorId: string | null;
  readonly actorType: ActorType;
  /** Siempre `null` en 001: el contexto técnico no tiene roles (data-model, `actor_role`). */
  readonly actorRole: null;
  readonly correlationId: string | null;
}

/** No hay contexto de tenant en la operación actual (falta el guard o se ejecuta fuera de una solicitud). */
export class TenantContextMissingError extends Error {
  constructor() {
    super('Operación sin contexto de tenant');
    this.name = 'TenantContextMissingError';
  }
}

/** Lectura del contexto de la operación actual (aislado por solicitud y por cadena asíncrona mediante nestjs-cls). */
@Injectable()
export class TenantContext {
  constructor(private readonly cls: ClsService) {}

  /** Contexto actual o `null`. */
  current(): TenantContextValue | null {
    if (!this.cls.isActive()) return null;
    const tenantId = this.cls.get<string | undefined>(CLS_TENANT_ID);
    if (tenantId === undefined) return null;
    return {
      tenantId,
      actorId: this.cls.get<string | undefined>(CLS_ACTOR_ID) ?? null,
      actorType: this.cls.get<ActorType>(CLS_ACTOR_TYPE),
      actorRole: null,
      correlationId: this.cls.get<string | undefined>(CLS_CORRELATION_ID) ?? null,
    };
  }

  /** Contexto actual; lanza `TenantContextMissingError` si no existe (fail-closed). */
  require(): TenantContextValue {
    const context = this.current();
    if (!context) throw new TenantContextMissingError();
    return context;
  }
}
