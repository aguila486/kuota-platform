import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service.js';
import { KuotaProblemError } from '../../../common/errors/problem.js';
import { type Money, moneyToJson } from '../../../common/money/index.js';
import { TenantPrismaService } from '../../../common/tenant-context/tenant-prisma.service.js';
import { type DevProbeItem, newDevProbeItem, validateLabel, validateVersion } from '../domain/dev-probe-item.js';
import { type DevProbePage, DevProbeRepository } from './dev-probe.repository.js';

/**
 * Casos de uso de `dev-probe` (T042, T078). Un recurso de otro tenant es indistinguible de uno inexistente: RLS lo oculta
 * y la respuesta es 404 `not-found` (US2-1).
 *
 * Crear y actualizar son UN caso de uso con UNA transacción (`withTenant`; ADR-0002 C2-1): la escritura de negocio y su
 * `audit_event` se confirman o revierten juntos (R-07). Si la auditoría falla, la escritura tampoco se confirma. Solo se
 * auditan operaciones confirmadas: un rechazo (validación, 404, 409) no genera eventos (spec.md, Auditable Events).
 * Eliminar también es un caso de uso auditado (`dev_probe.deleted`, con `label` y `version` del registro borrado),
 * tras la aprobación del 400 en el contrato de `deleteDevProbeItem` (cierre de US6, 2026-11-23).
 */
@Injectable()
export class DevProbeService {
  constructor(
    private readonly repository: DevProbeRepository,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  createDevProbeItem(label: string, sampleAmount: Money | null): Promise<DevProbeItem> {
    const input = newDevProbeItem(label, sampleAmount);
    return this.tenantPrisma.withTenant(async () => {
      const item = await this.repository.create(input);
      await this.audit.record({
        action: 'dev_probe.created',
        entityType: 'dev_probe',
        entityId: item.id,
        changes: {
          label: item.label,
          sample_amount: item.sampleAmount === null ? null : moneyToJson(item.sampleAmount),
          version: item.version,
        },
      });
      return item;
    });
  }

  listDevProbeItems(limit: number, afterId: string | null): Promise<DevProbePage> {
    return this.repository.list(limit, afterId);
  }

  async getDevProbeItem(id: string): Promise<DevProbeItem> {
    const item = await this.repository.findById(id);
    if (!item) throw new KuotaProblemError('not-found');
    return item;
  }

  async updateDevProbeItem(id: string, label: string, version: number): Promise<DevProbeItem> {
    const newLabel = validateLabel(label);
    const expected = validateVersion(version);
    return this.tenantPrisma.withTenant(async () => {
      const outcome = await this.repository.updateLabel(id, newLabel, expected);
      if (outcome.kind === 'not-found') throw new KuotaProblemError('not-found');
      if (outcome.kind === 'version-conflict') {
        throw new KuotaProblemError('version-conflict', {
          detail: 'La versión enviada no es la vigente; vuelve a leer el registro',
        });
      }
      await this.audit.record({
        action: 'dev_probe.updated',
        entityType: 'dev_probe',
        entityId: outcome.item.id,
        changes: {
          label: { before: outcome.previous.label, after: outcome.item.label },
          version: { before: outcome.previous.version, after: outcome.item.version },
        },
      });
      return outcome.item;
    });
  }

  deleteDevProbeItem(id: string): Promise<void> {
    return this.tenantPrisma.withTenant(async () => {
      const deleted = await this.repository.delete(id);
      if (!deleted) throw new KuotaProblemError('not-found');
      await this.audit.record({
        action: 'dev_probe.deleted',
        entityType: 'dev_probe',
        entityId: deleted.id,
        changes: { label: deleted.label, version: deleted.version },
      });
    });
  }
}
