import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_IDEMPOTENCY_KEY } from '../idempotency/idempotent.interceptor.js';
import { TenantContext } from '../tenant-context/tenant-context.js';
import { TenantPrismaService } from '../tenant-context/tenant-prisma.service.js';

/** Clave CLS con el origen de la operación auditada (`audit_events.origin`), fijada por `AuditActorGuard`. */
export const CLS_AUDIT_ORIGIN = 'auditOrigin';

/**
 * Lista permitida por tipo de entidad (data-model.md `audit_events.changes`): acciones de la tabla Auditable Events de
 * spec.md y los ÚNICOS campos que `changes` puede contener. Nunca PII en claro ni cuerpos completos de solicitudes.
 * Una entidad nueva se añade aquí con revisión.
 */
export const AUDIT_ENTITIES = {
  dev_probe: {
    actions: ['dev_probe.created', 'dev_probe.updated', 'dev_probe.deleted'],
    changeFields: ['label', 'sample_amount', 'version'],
  },
} as const satisfies Record<string, { actions: readonly string[]; changeFields: readonly string[] }>;

export type AuditEntityType = keyof typeof AUDIT_ENTITIES;
export type AuditAction = (typeof AUDIT_ENTITIES)[AuditEntityType]['actions'][number];

export interface AuditRecord {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  /** Valores relevantes, solo con campos de la lista permitida de la entidad. */
  readonly changes: Readonly<Record<string, unknown>>;
}

/** La operación auditada no tiene actor. El guard lo impide antes (400); esto es la defensa en profundidad. */
export class AuditActorRequiredError extends Error {
  constructor() {
    super('Operación auditada sin actor en el contexto');
    this.name = 'AuditActorRequiredError';
  }
}

/** Uso indebido de `AuditService` (sin origen o correlación, acción o campos no permitidos). */
export class AuditRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditRecordError';
  }
}

/**
 * `AuditService.record()` (T077; FR-025; R-07). Escribe un `audit_event` en la MISMA transacción de `withTenant` que el
 * comando auditado (usa `transaction()`: sin transacción activa falla, y el cliente protegido rechaza un uso fuera de
 * su operación). Si la escritura de auditoría falla, la excepción revierte también el comando.
 *
 * Valores:
 * - `id`: UUIDv7 por DEFAULT de la columna. `tenant_id`: DEFAULT desde `app.tenant_id`, nunca un argumento.
 * - Actor desde `TenantContext`: `actor_id` obligatorio (sin valor por defecto inventado), `actor_type`, y
 *   `actor_role`, que es siempre `NULL` en 001. Ningún encabezado ni campo del body puede fijarlos.
 * - `occurred_at`: hora del servidor de base de datos (DEFAULT `now()`). `device_time`: nulo en 001.
 * - `origin` fijado por `AuditActorGuard` (`ip-hash:<sha256>`), `correlation_id` de la solicitud e `idempotency_key`
 *   de `@Idempotent()` (nulo si la operación no es idempotente).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly context: TenantContext,
    private readonly cls: ClsService,
  ) {}

  async record(event: AuditRecord): Promise<void> {
    const ctx = this.context.require();
    if (ctx.actorId === null) throw new AuditActorRequiredError();
    if (ctx.correlationId === null) throw new AuditRecordError('Operación auditada sin correlation_id');
    const origin = this.cls.get<string | undefined>(CLS_AUDIT_ORIGIN);
    if (!origin) throw new AuditRecordError('Operación auditada sin origen: falta @Audited() en la ruta');

    const entity = AUDIT_ENTITIES[event.entityType];
    if (!(entity.actions as readonly string[]).includes(event.action)) {
      throw new AuditRecordError(`Acción no permitida para ${event.entityType}`);
    }
    const disallowed = Object.keys(event.changes).filter(
      (field) => !(entity.changeFields as readonly string[]).includes(field),
    );
    if (disallowed.length > 0) throw new AuditRecordError(`Campos de changes no permitidos para ${event.entityType}`);

    const tx = this.tenantPrisma.transaction();
    const changes = JSON.parse(JSON.stringify(event.changes)) as Parameters<
      typeof tx.audit_events.create
    >[0]['data']['changes'];
    await tx.audit_events.create({
      data: {
        actor_id: ctx.actorId,
        actor_type: ctx.actorType,
        actor_role: ctx.actorRole,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        changes,
        device_time: null,
        origin,
        correlation_id: ctx.correlationId,
        idempotency_key: this.cls.get<string | undefined>(CLS_IDEMPOTENCY_KEY) ?? null,
      },
    });
  }
}
