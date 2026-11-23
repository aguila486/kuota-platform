import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_TENANT_HEADER } from '../../src/common/tenant-context/dev-tenant.guard.js';

/**
 * Suite reutilizable de acceso cruzado por HTTP (T034; FR-016; US2-1, US2-3, US2-6).
 *
 * Una feature la aplica declarando su recurso:
 *
 * ```ts
 * describeTenantIsolation({ name: 'loans', collectionPath: '/v1/loans', setup, createBody, updateBody, ... });
 * ```
 *
 * Garantías del helper:
 * - **Datos propios y reproducibles:** dos tenants nuevos (UUID aleatorios) por suite y un marcador único por ejecución
 *   en cada registro. No depende de registros preexistentes.
 * - **Servidor y PostgreSQL reales:** `setup()` levanta la aplicación contra una base efímera (Testcontainers) y
 *   `countRows()` cuenta en la base SIN pasar por la API ni por RLS. Así se comprueba que un rechazo no escribió nada.
 *   No hay mocks: si RLS no aislara, estas pruebas fallarían.
 * - **Cierre de recursos:** `close()` en `afterAll`.
 *
 * Casos generados: lectura por id cruzada → 404, listado sin elementos ajenos, update y delete cruzados → 404 sin
 * efecto, `tenant_id` ajeno en el body rechazado o ignorado, tenant en query o en otros encabezados ignorado, sin
 * contexto o con contexto inválido → 401 sin escribir, y ≥ 50 solicitudes concurrentes intercaladas de los dos tenants.
 */

export type Json = Record<string, unknown>;

export interface TenantIsolationEnvironment {
  /** URL base del servidor real (p. ej. `http://127.0.0.1:41234`). */
  readonly baseUrl: string;
  /** Filas del recurso de un tenant, contadas directamente en la base (sin la API y sin RLS). */
  countRows(tenantId: string): Promise<number>;
  close(): Promise<void>;
}

export interface TenantIsolationResource {
  /** Nombre legible del recurso (título de la suite). */
  readonly name: string;
  /** Ruta de la colección: `POST` crea y `GET` lista. El elemento es `${collectionPath}/${id}`. */
  readonly collectionPath: string;
  /** Levanta la aplicación real contra una base efímera. */
  setup(): Promise<TenantIsolationEnvironment>;
  /** Cuerpo válido de creación que incluye `marker` en un campo legible (`markerField`). */
  createBody(marker: string): Json;
  /** Campo de la representación que contiene el marcador. */
  readonly markerField: string;
  /** Cuerpo válido de actualización del elemento `item` (representación devuelta por la API). */
  updateBody(item: Json, marker: string): Json;
  /** Método de actualización. Por defecto `PATCH`. */
  readonly updateMethod?: 'PATCH' | 'PUT';
  /** Encabezados adicionales de la creación (p. ej. `Idempotency-Key`). */
  createHeaders?(): Record<string, string>;
  /** Encabezados que fijan el contexto de un tenant. Por defecto, el contexto técnico `X-Kuota-Dev-Tenant` (001). */
  contextHeaders?(tenantId: string): Record<string, string>;
  /** Elementos y cursor siguiente de una página. Por defecto `{data, next_cursor}` del contrato. */
  pageItems?(page: Json): Json[];
  nextCursor?(page: Json): string | null;
  /** Número de solicitudes concurrentes intercaladas (mínimo y por defecto 60; FR-016 exige ≥ 50). */
  readonly concurrentRequests?: number;
}

interface Response {
  readonly status: number;
  readonly body: Json;
  readonly text: string;
}

export function describeTenantIsolation(resource: TenantIsolationResource): void {
  const run = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const contextHeaders = (tenant: string): Record<string, string> =>
    resource.contextHeaders ? resource.contextHeaders(tenant) : { [DEV_TENANT_HEADER]: tenant };
  const pageItems = (page: Json): Json[] => (resource.pageItems ? resource.pageItems(page) : (page['data'] as Json[]));
  const nextCursor = (page: Json): string | null =>
    resource.nextCursor ? resource.nextCursor(page) : (page['next_cursor'] as string | null);
  const concurrent = Math.max(50, resource.concurrentRequests ?? 60);
  const itemPath = (id: string) => `${resource.collectionPath}/${id}`;
  let env: TenantIsolationEnvironment;
  let seq = 0;
  const marker = (label: string) => `${label}-${run}-${++seq}`;

  async function call(method: string, path: string, headers: Record<string, string>, body?: Json): Promise<Response> {
    const res = await fetch(`${env.baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: Json;
    try {
      parsed = text ? (JSON.parse(text) as Json) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: parsed, text };
  }
  const as = (tenant: string) => contextHeaders(tenant);
  const create = async (tenant: string, label: string): Promise<Json> => {
    const res = await call(
      'POST',
      resource.collectionPath,
      { ...as(tenant), ...(resource.createHeaders?.() ?? {}) },
      resource.createBody(marker(label)),
    );
    expect(res.status, res.text).toBe(201);
    return res.body;
  };
  const getOwn = async (tenant: string, id: string) => call('GET', itemPath(id), as(tenant));
  async function listAll(tenant: string, extraQuery = '', headers: Record<string, string> = {}): Promise<Json[]> {
    const items: Json[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const query = new URLSearchParams(extraQuery);
      if (cursor) query.set('cursor', cursor);
      const qs = query.toString();
      const res = await call('GET', `${resource.collectionPath}${qs ? `?${qs}` : ''}`, { ...as(tenant), ...headers });
      expect(res.status, res.text).toBe(200);
      items.push(...pageItems(res.body));
      cursor = nextCursor(res.body);
      if (cursor === null) return items;
    }
    throw new Error('Paginación sin fin');
  }
  const expectNotFound = (res: Response, foreign: Json) => {
    expect(res.status, res.text).toBe(404);
    expect(res.body['code']).toBe('not-found');
    // No revela la existencia ni el contenido del recurso ajeno.
    expect(res.text).not.toContain(String(foreign[resource.markerField]));
  };

  describe(`aislamiento entre tenants: ${resource.name} (describeTenantIsolation)`, () => {
    let itemA: Json;
    let itemB: Json;

    beforeAll(async () => {
      env = await resource.setup();
      itemA = await create(TENANT_A, 'propio-A');
      itemB = await create(TENANT_B, 'propio-B');
    }, 180_000);
    afterAll(async () => env?.close());

    it('control positivo: cada tenant lee su propio registro', async () => {
      expect((await getOwn(TENANT_A, String(itemA['id']))).status).toBe(200);
      expect((await getOwn(TENANT_B, String(itemB['id']))).status).toBe(200);
    });

    it('lectura por id de otro tenant → 404 sin revelar su existencia (US2-1), en ambos sentidos', async () => {
      expectNotFound(await getOwn(TENANT_A, String(itemB['id'])), itemB);
      expectNotFound(await getOwn(TENANT_B, String(itemA['id'])), itemA);
    });

    it('el listado (todas las páginas) solo contiene registros propios', async () => {
      const ofA = await listAll(TENANT_A);
      const ofB = await listAll(TENANT_B);
      const ids = (items: Json[]) => items.map((i) => i['id']);
      expect(ids(ofA)).toContain(itemA['id']);
      expect(ids(ofA)).not.toContain(itemB['id']);
      expect(ids(ofB)).toContain(itemB['id']);
      expect(ids(ofB)).not.toContain(itemA['id']);
      expect(ofA).toHaveLength(await env.countRows(TENANT_A));
      expect(ofB).toHaveLength(await env.countRows(TENANT_B));
    });

    it('update cruzado → 404 y sin efecto, en ambos sentidos', async () => {
      for (const [attacker, victim] of [
        [TENANT_A, itemB],
        [TENANT_B, itemA],
      ] as const) {
        const owner = attacker === TENANT_A ? TENANT_B : TENANT_A;
        const before = (await getOwn(owner, String(victim['id']))).body;
        const res = await call(
          resource.updateMethod ?? 'PATCH',
          itemPath(String(victim['id'])),
          as(attacker),
          resource.updateBody(victim, marker('intruso')),
        );
        expectNotFound(res, victim);
        expect((await getOwn(owner, String(victim['id']))).body).toEqual(before);
      }
    });

    it('delete cruzado → 404 y sin efecto, en ambos sentidos', async () => {
      const rows = { A: await env.countRows(TENANT_A), B: await env.countRows(TENANT_B) };
      expectNotFound(await call('DELETE', itemPath(String(itemB['id'])), as(TENANT_A)), itemB);
      expectNotFound(await call('DELETE', itemPath(String(itemA['id'])), as(TENANT_B)), itemA);
      expect((await getOwn(TENANT_B, String(itemB['id']))).status).toBe(200);
      expect((await getOwn(TENANT_A, String(itemA['id']))).status).toBe(200);
      expect({ A: await env.countRows(TENANT_A), B: await env.countRows(TENANT_B) }).toEqual(rows);
    });

    it('un tenant_id ajeno en el body se rechaza o se ignora: nunca crea ni modifica datos del otro tenant (US2-3)', async () => {
      const rowsB = await env.countRows(TENANT_B);
      const body = { ...resource.createBody(marker('suplantacion')), tenant_id: TENANT_B };
      const res = await call(
        'POST',
        resource.collectionPath,
        { ...as(TENANT_A), ...(resource.createHeaders?.() ?? {}) },
        body,
      );
      if (res.status === 201) {
        expect((await getOwn(TENANT_A, String(res.body['id']))).status).toBe(200);
        expect((await getOwn(TENANT_B, String(res.body['id']))).status).toBe(404);
      } else {
        expect(res.status, res.text).toBe(400);
        expect(res.text).not.toContain(TENANT_B);
      }
      const update = await call(resource.updateMethod ?? 'PATCH', itemPath(String(itemA['id'])), as(TENANT_A), {
        ...resource.updateBody((await getOwn(TENANT_A, String(itemA['id']))).body, marker('suplantacion')),
        tenant_id: TENANT_B,
      });
      expect([200, 400]).toContain(update.status);
      expect(await env.countRows(TENANT_B)).toBe(rowsB);
      expect((await getOwn(TENANT_B, String(itemA['id']))).status).toBe(404);
    });

    it('el tenant en la query o en otros encabezados no cambia el contexto', async () => {
      const spoofHeaders = { 'x-tenant-id': TENANT_B, 'x-kuota-tenant': TENANT_B };
      const items = await listAll(TENANT_A, `tenant_id=${TENANT_B}&tenantId=${TENANT_B}`, spoofHeaders);
      expect(items.map((i) => i['id'])).not.toContain(itemB['id']);
      expect(items.map((i) => i['id'])).toContain(itemA['id']);
    });

    it('sin contexto o con contexto inválido → 401 y nada escrito (fail-closed)', async () => {
      const rows = { A: await env.countRows(TENANT_A), B: await env.countRows(TENANT_B) };
      const invalidContexts: Array<Record<string, string>> = [
        {},
        { [DEV_TENANT_HEADER]: 'no-es-uuid' },
        { [DEV_TENANT_HEADER]: '' },
      ];
      for (const headers of invalidContexts) {
        const created = await call(
          'POST',
          resource.collectionPath,
          { ...headers, ...(resource.createHeaders?.() ?? {}) },
          resource.createBody(marker('sin-contexto')),
        );
        expect(created.status, created.text).toBe(401);
        expect(created.body['code']).toBe('tenant-context-required');
        expect((await call('GET', resource.collectionPath, headers)).status).toBe(401);
        expect((await call('GET', itemPath(String(itemA['id'])), headers)).status).toBe(401);
        expect((await call('DELETE', itemPath(String(itemA['id'])), headers)).status).toBe(401);
      }
      expect({ A: await env.countRows(TENANT_A), B: await env.countRows(TENANT_B) }).toEqual(rows);
    });

    it(`${concurrent} solicitudes concurrentes intercaladas de 2 tenants: ninguna observa datos del otro (US2-6)`, async () => {
      const rows = { A: await env.countRows(TENANT_A), B: await env.countRows(TENANT_B) };
      const results = await Promise.all(
        Array.from({ length: concurrent }, async (_, i) => {
          const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
          const created = await create(tenant, `conc-${i}`);
          const read = await getOwn(tenant, String(created['id']));
          const list = await call('GET', `${resource.collectionPath}?limit=100`, as(tenant));
          const foreign = tenant === TENANT_A ? itemB['id'] : itemA['id'];
          return {
            ok: read.status === 200 && read.body[resource.markerField] === created[resource.markerField],
            leaked: pageItems(list.body).some((item) => item['id'] === foreign),
          };
        }),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.filter((r) => r.leaked)).toHaveLength(0);
      expect(await env.countRows(TENANT_A)).toBe(rows.A + Math.ceil(concurrent / 2));
      expect(await env.countRows(TENANT_B)).toBe(rows.B + Math.floor(concurrent / 2));
    }, 60_000);
  });
}
