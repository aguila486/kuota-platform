import type { IncomingMessage } from 'node:http';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { APP_CONFIG, type AppConfig, devTenantContextEnabled } from '../config/app-config.js';
import { KuotaProblemError } from '../errors/problem.js';
import { ACTOR_ID, establishTenantContext } from './establish-context.js';

export const DEV_TENANT_HEADER = 'x-kuota-dev-tenant';
export const DEV_ACTOR_HEADER = 'x-kuota-dev-actor';

const UUID_ANY_CASE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Contexto técnico de tenant para local/testing (T038, R-05). NO es autenticación: no prueba identidad ni permisos.
 *
 * - Fuera de `KUOTA_ENV ∈ {local, testing}` con `KUOTA_DEV_TENANT_CONTEXT=enabled` nunca acepta encabezados: responde
 *   401 `tenant-context-required` (además, en esos entornos los módulos de desarrollo ni se registran y el arranque
 *   aborta si el mecanismo está habilitado).
 * - Solo lee `X-Kuota-Dev-Tenant` y `X-Kuota-Dev-Actor`; cualquier otro encabezado, parámetro o campo del body con un
 *   tenant se ignora. Un encabezado ausente, repetido o que no es un UUID → 401 sin reflejar el valor.
 * - `X-Kuota-Dev-Actor` inválido → 400 `validation-error`. `actorType` = `DEV` lo fija el servidor; `actorRole` es null.
 */
@Injectable()
export class DevTenantGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cls: ClsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!devTenantContextEnabled(this.config)) throw new KuotaProblemError('tenant-context-required');
    const { headers } = context.switchToHttp().getRequest<IncomingMessage>();

    const tenant = headers[DEV_TENANT_HEADER];
    if (typeof tenant !== 'string' || !UUID_ANY_CASE.test(tenant) || tenant === NIL_UUID) {
      throw new KuotaProblemError('tenant-context-required');
    }
    const actor = headers[DEV_ACTOR_HEADER];
    if (actor !== undefined && (typeof actor !== 'string' || !ACTOR_ID.test(actor))) {
      throw new KuotaProblemError('validation-error', {
        errors: [{ field: 'X-Kuota-Dev-Actor', message: 'Formato esperado: 1–64 caracteres [A-Za-z0-9_.:-]' }],
      });
    }
    establishTenantContext(this.cls, { tenantId: tenant.toLowerCase(), actorId: actor ?? null, actorType: 'DEV' });
    return true;
  }
}
