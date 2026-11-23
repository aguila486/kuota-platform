import type { DevProbeItem, NewDevProbeItem } from '../domain/dev-probe-item.js';

/** Página de resultados por cursor (keyset sobre `dev_probe_items.id`, UUIDv7 ordenado en el tiempo). */
export interface DevProbePage {
  readonly items: readonly DevProbeItem[];
  /** Id del último elemento si hay más resultados; `null` si es la última página. */
  readonly nextAfterId: string | null;
}

export type UpdateOutcome =
  | {
      readonly kind: 'updated';
      readonly item: DevProbeItem;
      /** Valores vigentes antes de la actualización (para la auditoría `dev_probe.updated`). */
      readonly previous: { readonly label: string; readonly version: number };
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'version-conflict' };

/**
 * Puerto de persistencia de `dev-probe` (T041). Ningún método recibe el tenant: lo fija el contexto de la operación y
 * lo aplica RLS. La implementación accede a datos solo mediante `withTenant`.
 */
export abstract class DevProbeRepository {
  abstract create(item: NewDevProbeItem): Promise<DevProbeItem>;
  abstract findById(id: string): Promise<DevProbeItem | null>;
  abstract list(limit: number, afterId: string | null): Promise<DevProbePage>;
  abstract updateLabel(id: string, label: string, expectedVersion: number): Promise<UpdateOutcome>;
  /** Registro eliminado (valores en el momento del borrado) o `null` si no existe en el tenant del contexto. */
  abstract delete(id: string): Promise<DevProbeItem | null>;
}
