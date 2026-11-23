import { Injectable } from '@nestjs/common';
import { TenantPrismaService, type TenantTransaction } from '../../../common/tenant-context/tenant-prisma.service.js';
import { DevProbeItem, type NewDevProbeItem } from '../domain/dev-probe-item.js';
import { type DevProbePage, DevProbeRepository, type UpdateOutcome } from '../application/dev-probe.repository.js';

type Row = Awaited<ReturnType<TenantTransaction['dev_probe_items']['findMany']>>[number];

const toDomain = (row: Row): DevProbeItem =>
  DevProbeItem.fromRecord({
    id: row.id,
    label: row.label,
    sampleAmountMinor: row.sample_amount_minor,
    sampleCurrency: row.sample_currency,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

/**
 * Repositorio de `dev-probe` sobre Prisma (T041). Primer repositorio tenant-scoped de Kuota:
 * - todo acceso pasa por `withTenant` y usa el cliente protegido que recibe el callback (R3): nunca se guarda en
 *   campos, cachés ni variables, y toda consulta se espera dentro del callback;
 * - el tenant NUNCA es un argumento: `tenant_id` lo pone el DEFAULT de la columna desde `app.tenant_id` y RLS filtra
 *   todas las lecturas y escrituras (FR-012, FR-013);
 * - `id` es UUIDv7 generado por PostgreSQL (`DEFAULT uuidv7()`);
 * - solo API de modelo de Prisma: sin SQL raw.
 * Si hay una transacción activa (caso de uso que ya abrió `withTenant`), se reutiliza (ADR-0002, C2-1).
 */
@Injectable()
export class PrismaDevProbeRepository extends DevProbeRepository {
  constructor(private readonly tenantPrisma: TenantPrismaService) {
    super();
  }

  create(item: NewDevProbeItem): Promise<DevProbeItem> {
    return this.tenantPrisma.withTenant(async (tx) => {
      const row = await tx.dev_probe_items.create({
        data: {
          label: item.label,
          sample_amount_minor: item.sampleAmount?.amountMinor ?? null,
          sample_currency: item.sampleAmount?.currency ?? null,
        },
      });
      return toDomain(row);
    });
  }

  findById(id: string): Promise<DevProbeItem | null> {
    return this.tenantPrisma.withTenant(async (tx) => {
      const row = await tx.dev_probe_items.findUnique({ where: { id } });
      return row ? toDomain(row) : null;
    });
  }

  list(limit: number, afterId: string | null): Promise<DevProbePage> {
    return this.tenantPrisma.withTenant(async (tx) => {
      // Keyset: un elemento de más indica si hay otra página. El cursor de otro tenant solo acota este tenant.
      const rows = await tx.dev_probe_items.findMany({
        where: afterId === null ? {} : { id: { gt: afterId } },
        orderBy: { id: 'asc' },
        take: limit + 1,
      });
      const page = rows.slice(0, limit).map(toDomain);
      return { items: page, nextAfterId: rows.length > limit ? page[page.length - 1]!.id : null };
    });
  }

  updateLabel(id: string, label: string, expectedVersion: number): Promise<UpdateOutcome> {
    return this.tenantPrisma.withTenant(async (tx): Promise<UpdateOutcome> => {
      // Valor anterior (auditoría). Si otra transacción cambia la fila, cambia la versión y la actualización de abajo no
      // la toca (version-conflict): el label leído es siempre el de `expectedVersion` cuando la actualización ocurre.
      const before = await tx.dev_probe_items.findFirst({ where: { id, version: expectedVersion } });
      // Bloqueo optimista: solo actualiza si la versión vigente es la esperada (una sentencia, atómica).
      const [row] = await tx.dev_probe_items.updateManyAndReturn({
        where: { id, version: expectedVersion },
        data: { label, version: { increment: 1 }, updated_at: new Date() },
      });
      if (row && before) {
        return { kind: 'updated', item: toDomain(row), previous: { label: before.label, version: before.version } };
      }
      const exists = await tx.dev_probe_items.count({ where: { id } });
      return exists === 0 ? { kind: 'not-found' } : { kind: 'version-conflict' };
    });
  }

  delete(id: string): Promise<DevProbeItem | null> {
    return this.tenantPrisma.withTenant(async (tx) => {
      // `deleteManyAndReturn` no existe en Prisma 7.10.1. Se comprueba la existencia (RLS) y se borra con `delete`
      // (DELETE … RETURNING), que devuelve los valores exactos borrados, en la misma transacción y sin SQL raw. Si otra
      // transacción ya lo borró entre ambas sentencias, Prisma responde P2025 → «no existe».
      if ((await tx.dev_probe_items.count({ where: { id } })) === 0) return null;
      try {
        return toDomain(await tx.dev_probe_items.delete({ where: { id } }));
      } catch (error) {
        if ((error as { code?: unknown }).code === 'P2025') return null;
        throw error;
      }
    });
  }
}
