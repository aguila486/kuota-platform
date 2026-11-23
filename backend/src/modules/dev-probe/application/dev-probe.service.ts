import { Injectable } from '@nestjs/common';
import { KuotaProblemError } from '../../../common/errors/problem.js';
import type { Money } from '../../../common/money/index.js';
import { type DevProbeItem, newDevProbeItem, validateLabel, validateVersion } from '../domain/dev-probe-item.js';
import { type DevProbePage, DevProbeRepository } from './dev-probe.repository.js';

/**
 * Casos de uso de `dev-probe` (T042). Un recurso de otro tenant es indistinguible de uno inexistente: RLS lo oculta y
 * la respuesta es 404 `not-found` (US2-1). La idempotencia completa (reproducción, 409, 422) y la auditoría llegan en
 * US6 (T076–T078); aquí no se escriben `idempotency_keys` ni `audit_events`.
 */
@Injectable()
export class DevProbeService {
  constructor(private readonly repository: DevProbeRepository) {}

  createDevProbeItem(label: string, sampleAmount: Money | null): Promise<DevProbeItem> {
    return this.repository.create(newDevProbeItem(label, sampleAmount));
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
    const outcome = await this.repository.updateLabel(id, validateLabel(label), validateVersion(version));
    if (outcome.kind === 'not-found') throw new KuotaProblemError('not-found');
    if (outcome.kind === 'version-conflict') {
      throw new KuotaProblemError('version-conflict', {
        detail: 'La versión enviada no es la vigente; vuelve a leer el registro',
      });
    }
    return outcome.item;
  }

  async deleteDevProbeItem(id: string): Promise<void> {
    if (!(await this.repository.delete(id))) throw new KuotaProblemError('not-found');
  }
}
