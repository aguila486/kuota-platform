import type { ClsService } from 'nestjs-cls';
import { CLS_ACTOR_ID, CLS_TENANT_ID } from '../logging/logger-options.js';
import { type ActorType, CLS_ACTOR_TYPE, TenantContextMissingError } from './tenant-context.js';

/**
 * Único punto que escribe el contexto de tenant en CLS (T038). Solo lo pueden importar los guards de
 * `src/common/tenant-context` (eslint `no-restricted-imports` + dependency-cruiser). Hoy: `DevTenantGuard`; en 002, el
 * guard de identidad.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const ACTOR_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export interface EstablishedContext {
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly actorType: ActorType;
}

/** El contexto ya estaba fijado con otro valor en la misma operación: no se puede cambiar. */
export class TenantContextConflictError extends Error {
  constructor() {
    super('El contexto de tenant ya está establecido en esta operación y no puede cambiarse');
    this.name = 'TenantContextConflictError';
  }
}

/** Valida y fija el contexto. Es inmutable: establecerlo dos veces con valores distintos lanza un error. */
export function establishTenantContext(cls: ClsService, context: EstablishedContext): void {
  if (!cls.isActive()) throw new TenantContextMissingError();
  if (!UUID.test(context.tenantId) || context.tenantId === NIL_UUID) {
    throw new Error('tenantId debe ser un UUID en minúsculas distinto del UUID nulo');
  }
  if (context.actorId !== null && !ACTOR_ID.test(context.actorId)) throw new Error('actorId con formato inválido');

  const existing = cls.get<string | undefined>(CLS_TENANT_ID);
  if (existing !== undefined) {
    const sameActor = (cls.get<string | undefined>(CLS_ACTOR_ID) ?? null) === context.actorId;
    if (existing === context.tenantId && sameActor && cls.get(CLS_ACTOR_TYPE) === context.actorType) return;
    throw new TenantContextConflictError();
  }
  cls.set(CLS_TENANT_ID, context.tenantId);
  if (context.actorId !== null) cls.set(CLS_ACTOR_ID, context.actorId);
  cls.set(CLS_ACTOR_TYPE, context.actorType);
}
