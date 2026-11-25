import { Injectable } from '@nestjs/common';
import { KuotaProblemError } from '../errors/problem.js';
import { TenantContext } from '../tenant-context/tenant-context.js';
import { TenantPrismaService } from '../tenant-context/tenant-prisma.service.js';
import { idempotencyLockId } from './request-hash.js';

export interface IdempotentRequest {
  readonly key: string;
  readonly requestHash: string;
  readonly method: string;
  readonly path: string;
}

/** Resultado del comando que se almacena para reproducirlo (solo 2xx: ver `run`). */
export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

export type IdempotentOutcome = StoredResponse & { readonly replayed: boolean };

/** Segundos de `Retry-After` en 409 `idempotency-request-in-progress` (data-model.md; 1 en 001). */
export const RETRY_AFTER_SECONDS = '1';

/**
 * Repositorio de idempotencia (T075; data-model.md `idempotency_keys`; FR-023, FR-024). Todo ocurre en UNA transacción
 * de `withTenant`, la misma del comando:
 *
 * 1. `pg_try_advisory_xact_lock(hash(tenant, key))`; si no se obtiene → 409 `idempotency-request-in-progress` con
 *    `Retry-After: 1`, sin tocar la tabla.
 * 2. Una fila expirada (`expires_at <= now()`) se elimina en la misma transacción y la solicitud se trata como nueva.
 * 3. Fila vigente: hash distinto → 422 `idempotency-key-reused`; `COMPLETED` con el mismo hash → respuesta almacenada
 *    (reproducción, sin ejecutar el comando).
 * 4. Sin fila: `INSERT … IN_PROGRESS` → comando → `COMPLETED` con la respuesta. Si el comando falla, la transacción se
 *    revierte y la fila desaparece con ella: no quedan `IN_PROGRESS` huérfanas y un reintento produce el efecto.
 *
 * Solo se almacenan respuestas 2xx, un subconjunto de lo que data-model.md permite (2xx/4xx deterministas). Guardar un
 * 4xx exigiría confirmar la transacción de un comando fallido. El tenant de la fila lo pone el DEFAULT de la columna y
 * RLS restringe todas las consultas; el tenant del contexto solo se usa para calcular el identificador del bloqueo.
 */
@Injectable()
export class IdempotencyRepository {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly context: TenantContext,
  ) {}

  run(request: IdempotentRequest, command: () => Promise<StoredResponse>): Promise<IdempotentOutcome> {
    const lockId = idempotencyLockId(this.context.require().tenantId, request.key);
    return this.tenantPrisma.withTenant(async (tx): Promise<IdempotentOutcome> => {
      const [lock] = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`;
      if (!lock?.locked) {
        throw new KuotaProblemError('idempotency-request-in-progress', {
          detail: 'Otra solicitud con la misma clave está en proceso; reintenta más tarde',
          headers: { 'Retry-After': RETRY_AFTER_SECONDS },
        });
      }
      await tx.$executeRaw`DELETE FROM kuota.idempotency_keys WHERE key = ${request.key} AND expires_at <= now()`;
      const existing = await tx.idempotency_keys.findFirst({ where: { key: request.key } });
      if (existing) {
        if (existing.request_hash !== request.requestHash) {
          throw new KuotaProblemError('idempotency-key-reused', {
            detail: 'La clave de idempotencia ya se usó con un contenido distinto',
          });
        }
        // Una fila IN_PROGRESS solo es visible en su propia transacción (que tiene el bloqueo): aquí siempre es COMPLETED.
        return { replayed: true, status: existing.response_status!, body: existing.response_body };
      }
      // INSERT con los DEFAULT de la base: `created_at` y `expires_at` salen del mismo `now()` de la transacción, así
      // que expires_at = created_at + 30 días exactamente. Con `create()` de Prisma, `created_at` (@default(now()))
      // tomaría el reloj de la aplicación. Plantilla parametrizada (sin SQL dinámico).
      await tx.$executeRaw`
        INSERT INTO kuota.idempotency_keys (key, request_hash, method, path, status)
        VALUES (${request.key}, ${request.requestHash}, ${request.method}, ${request.path}, 'IN_PROGRESS')`;
      const response = await command();
      if (response.status < 200 || response.status > 299) {
        throw new Error('Solo se almacenan respuestas 2xx en idempotency_keys');
      }
      const body = JSON.parse(JSON.stringify(response.body ?? null)) as Parameters<
        typeof tx.idempotency_keys.updateMany
      >[0]['data']['response_body'];
      await tx.idempotency_keys.updateMany({
        where: { key: request.key },
        data: { status: 'COMPLETED', response_status: response.status, response_body: body },
      });
      return { replayed: false, ...response };
    });
  }
}
