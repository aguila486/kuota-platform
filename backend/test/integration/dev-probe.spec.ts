import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';

/**
 * T042 + T062 sobre la aplicación real y PostgreSQL 18: contrato de `/v1/dev/probe-items`, validación de Money en la
 * frontera, `Idempotency-Key` (solo formato; la deduplicación es US6), paginación por cursor, bloqueo optimista y
 * errores sin datos internos.
 */
let db: TestDatabase;
let app: INestApplication;
let url = '';
let admin: Client;
const TENANT = randomUUID();
const OTHER = randomUUID();
const PATH = '/v1/dev/probe-items';

type Json = Record<string, unknown>;
interface Res {
  status: number;
  body: Json;
  text: string;
  headers: Headers;
}

async function call(
  method: string,
  path: string,
  options: { tenant?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.tenant !== null) headers['x-kuota-dev-tenant'] = options.tenant ?? TENANT;
  const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (payload !== undefined) headers['content-type'] ??= 'application/json';
  const res = await fetch(`${url}${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const text = await res.text();
  let body: Json;
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = {};
  }
  return { status: res.status, body, text, headers: res.headers };
}
const create = (body: unknown, key: string | null = randomUUID(), tenant?: string) =>
  call('POST', PATH, { body, tenant, headers: key === null ? {} : { 'idempotency-key': key } });

async function rows(
  tenant = TENANT,
): Promise<Array<{ label: string; amount: string | null; currency: string | null }>> {
  const { rows: r } = await admin.query<{ label: string; amount: string | null; currency: string | null }>(
    `SELECT label, sample_amount_minor::text AS amount, sample_currency AS currency
       FROM kuota.dev_probe_items WHERE tenant_id = $1`,
    [tenant],
  );
  return r;
}
const expectValidation = (res: Res, field: string) => {
  expect(res.status, res.text).toBe(400);
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  expect(res.body['code']).toBe('validation-error');
  expect((res.body['errors'] as Array<{ field: string }>).map((e) => e.field)).toContain(field);
};
const noInternals = (res: Res) => {
  expect(res.text).not.toMatch(/prisma|postgres|sql|kuota\.dev_probe_items|stack|tenant_id"\s*:\s*"/i);
};

beforeAll(async () => {
  db = await startTestDatabase();
  app = await createApp(
    loadConfig(
      validEnv({
        KUOTA_ENV: 'testing',
        KUOTA_DEV_TENANT_CONTEXT: 'enabled',
        DATABASE_URL_APP: db.appUrl,
        LOG_LEVEL: 'silent',
      }),
    ),
  );
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await db?.stop();
});

describe('createDevProbeItem', () => {
  it('201 con la representación del contrato; el tenant lo fija el contexto y el id es UUIDv7 del servidor', async () => {
    const res = await create({ label: 'sin-monto' });
    expect(res.status, res.text).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'created_at',
      'id',
      'label',
      'sample_amount',
      'updated_at',
      'version',
    ]);
    expect(res.body).toMatchObject({ label: 'sin-monto', sample_amount: null, version: 1 });
    expect(String(res.body['id'])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Date(String(res.body['created_at'])).toISOString()).toBe(res.body['created_at']);
    const { rows: r } = await admin.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM kuota.dev_probe_items WHERE id = $1',
      [res.body['id']],
    );
    expect(r[0]!.tenant_id).toBe(TENANT);
  });

  it('Money: los límites del dominio simétrico de int64 se guardan como bigint exacto y vuelven como string canónico', async () => {
    for (const [amount, currency] of [
      ['9223372036854775807', 'USD'],
      ['-9223372036854775807', 'JPY'],
      ['0', 'BHD'],
      ['9007199254740993', 'CLF'], // > 2^53: un `number` lo redondearía a …992
    ] as const) {
      const res = await create({ label: `monto-${amount}`, sample_amount: { amount_minor: amount, currency } });
      expect(res.status, res.text).toBe(201);
      expect(res.body['sample_amount']).toEqual({ amount_minor: amount, currency });
      // El texto de la respuesta contiene el string exacto (sin pasar por number).
      expect(res.text).toContain(`"amount_minor":"${amount}"`);
      const stored = (await rows()).find((r) => r.label === `monto-${amount}`);
      expect(stored).toEqual({ label: `monto-${amount}`, amount, currency });
      const read = await call('GET', `${PATH}/${String(res.body['id'])}`);
      expect(read.body['sample_amount']).toEqual({ amount_minor: amount, currency });
    }
  });

  const INVALID_MONEY: Array<[string, unknown, string]> = [
    [
      'fuera de rango por arriba',
      { amount_minor: '9223372036854775808', currency: 'USD' },
      'sample_amount.amount_minor',
    ],
    [
      '−2^63 (fuera del dominio simétrico)',
      { amount_minor: '-9223372036854775808', currency: 'USD' },
      'sample_amount.amount_minor',
    ],
    ['ceros a la izquierda', { amount_minor: '0012', currency: 'USD' }, 'sample_amount.amount_minor'],
    ['cero negativo', { amount_minor: '-0', currency: 'USD' }, 'sample_amount.amount_minor'],
    ['decimales', { amount_minor: '12.50', currency: 'USD' }, 'sample_amount.amount_minor'],
    ['número JSON en lugar de string', { amount_minor: 1250, currency: 'USD' }, 'sample_amount.amount_minor'],
    ['moneda fuera del catálogo', { amount_minor: '100', currency: 'EUR' }, 'sample_amount.currency'],
    ['moneda en minúsculas', { amount_minor: '100', currency: 'mxn' }, 'sample_amount.currency'],
    ['sin moneda', { amount_minor: '100' }, 'sample_amount.currency'],
    ['sin monto', { currency: 'MXN' }, 'sample_amount.amount_minor'],
    ['propiedad extra', { amount_minor: '100', currency: 'MXN', rate: 1.5 }, 'sample_amount'],
    ['null', null, 'sample_amount'],
    ['string suelto', '100 MXN', 'sample_amount'],
  ];
  for (const [name, value, field] of INVALID_MONEY) {
    it(`Money inválido → 400 sin escribir y sin reflejar el valor: ${name}`, async () => {
      const before = (await rows()).length;
      const res = await create({ label: 'money-invalido', sample_amount: value });
      expectValidation(res, field);
      if (typeof value === 'object' && value !== null && 'amount_minor' in value) {
        expect(res.text).not.toContain(String(value.amount_minor));
      }
      expect((await rows()).length).toBe(before);
    });
  }

  it('label: 1 y 120 caracteres (puntos de código) aceptados; vacío, 121, no-string o ausente → 400', async () => {
    expect((await create({ label: 'x' })).status).toBe(201);
    expect((await create({ label: '🙂'.repeat(120) })).status).toBe(201);
    expectValidation(await create({ label: '' }), 'label');
    expectValidation(await create({ label: 'a'.repeat(121) }), 'label');
    expectValidation(await create({ label: 12 }), 'label');
    expectValidation(await create({}), 'label');
  });

  it('cuerpo con tenant_id u otra propiedad → 400 (FR-012); cuerpo no-objeto o JSON malformado → 400', async () => {
    const before = (await rows(OTHER)).length;
    const spoof = await create({ label: 'suplanta', tenant_id: OTHER });
    expectValidation(spoof, 'tenant_id');
    expect(spoof.text).not.toContain(OTHER);
    expect((await rows(OTHER)).length).toBe(before);
    expectValidation(await create(['label']), 'body');
    const malformed = await call('POST', PATH, { raw: '{"label": ', headers: { 'idempotency-key': randomUUID() } });
    expect(malformed.status).toBe(400);
    expect(malformed.body['code']).toBe('validation-error');
    noInternals(malformed);
  });

  it('Idempotency-Key: obligatoria y con formato de data-model (8–128 [A-Za-z0-9_-]); sin reflejar el valor', async () => {
    const before = (await rows()).length;
    for (const key of [null, '1234567', 'a'.repeat(129), 'con espacio', 'ñandú-1234', 'abc$defgh']) {
      const res = await create({ label: 'clave' }, key);
      expectValidation(res, 'Idempotency-Key');
      if (key) expect(res.text).not.toContain(key);
    }
    const repeated = await new Promise<number>((resolve, reject) => {
      const target = new URL(`${url}${PATH}`);
      const req = httpRequest(
        { host: target.hostname, port: target.port, path: target.pathname, method: 'POST' },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.setHeader('x-kuota-dev-tenant', TENANT);
      req.setHeader('content-type', 'application/json');
      req.setHeader('idempotency-key', ['clave-uno-1', 'clave-dos-2']);
      req.end(JSON.stringify({ label: 'clave-repetida' }));
    });
    expect(repeated).toBe(400);
    expect((await rows()).length).toBe(before);
    expect((await create({ label: 'k8' }, 'abcd_-12')).status).toBe(201);
    expect((await create({ label: 'k128' }, 'k'.repeat(128))).status).toBe(201);
  });

  it('sin contexto: 401 antes de validar la clave o el cuerpo', async () => {
    const res = await call('POST', PATH, { tenant: null, body: { label: '' } });
    expect(res.status).toBe(401);
    expect(res.body['code']).toBe('tenant-context-required');
  });
});

describe('getDevProbeItem / listDevProbeItems', () => {
  it('id malformado → 404 (un recurso con ese id no puede existir); id en mayúsculas → mismo recurso', async () => {
    const created = await create({ label: 'mayusculas' });
    const id = String(created.body['id']);
    expect((await call('GET', `${PATH}/no-es-uuid`)).status).toBe(404);
    expect((await call('GET', `${PATH}/${id.toUpperCase()}`)).body['id']).toBe(id);
    expect((await call('GET', `${PATH}/${randomUUID()}`)).status).toBe(404);
  });

  it('paginación por cursor: páginas sin duplicados ni huecos, en orden, hasta next_cursor null', async () => {
    const tenant = randomUUID();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++)
      ids.push(String((await create({ label: `pag-${i}` }, randomUUID(), tenant)).body['id']));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Res = await call('GET', `${PATH}?limit=3${cursor ? `&cursor=${cursor}` : ''}`, { tenant });
      expect(res.status).toBe(200);
      const data = res.body['data'] as Json[];
      expect(data.length).toBeLessThanOrEqual(3);
      seen.push(...data.map((d) => String(d['id'])));
      cursor = res.body['next_cursor'] as string | null;
      pages++;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].sort());
    const all = await call('GET', PATH, { tenant });
    expect((all.body['data'] as Json[]).length).toBe(7);
    expect(all.body['next_cursor']).toBeNull();
  });

  it('limit y cursor inválidos → 400; un cursor con un id de otro tenant no revela nada', async () => {
    for (const limit of ['0', '101', 'abc', '1.5', '-1', ''])
      expectValidation(await call('GET', `${PATH}?limit=${limit}`), 'limit');
    for (const cursor of [
      '%%%',
      Buffer.from('v2:x').toString('base64url'),
      'a'.repeat(513),
      Buffer.from('v1:no-uuid').toString('base64url'),
    ]) {
      expectValidation(await call('GET', `${PATH}?cursor=${cursor}`), 'cursor');
    }
    const foreign = await create({ label: 'ajeno-cursor' }, randomUUID(), OTHER);
    const cursor = Buffer.from(`v1:${String(foreign.body['id'])}`).toString('base64url');
    const page = await call('GET', `${PATH}?cursor=${cursor}`);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('ajeno-cursor');
  });
});

describe('updateDevProbeItem (bloqueo optimista) y deleteDevProbeItem', () => {
  it('PATCH con la versión vigente → 200, version+1 y updated_at nuevo; con versión vieja → 409 version-conflict', async () => {
    const created = await create({ label: 'v1', sample_amount: { amount_minor: '500', currency: 'MXN' } });
    const id = String(created.body['id']);
    const updated = await call('PATCH', `${PATH}/${id}`, { body: { label: 'v2', version: 1 } });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body).toMatchObject({
      id,
      label: 'v2',
      version: 2,
      sample_amount: { amount_minor: '500', currency: 'MXN' },
    });
    expect(Date.parse(String(updated.body['updated_at']))).toBeGreaterThanOrEqual(
      Date.parse(String(created.body['updated_at'])),
    );
    const stale = await call('PATCH', `${PATH}/${id}`, { body: { label: 'v3', version: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body['code']).toBe('version-conflict');
    expect((await call('GET', `${PATH}/${id}`)).body['label']).toBe('v2');
  });

  it('PATCH inválido → 400: version 0, decimal, string, > int32 o ausente; label inválido; propiedades extra', async () => {
    const id = String((await create({ label: 'patch-invalido' })).body['id']);
    for (const version of [0, 1.5, '1', 2_147_483_648]) {
      expectValidation(await call('PATCH', `${PATH}/${id}`, { body: { label: 'x', version } }), 'version');
    }
    expectValidation(await call('PATCH', `${PATH}/${id}`, { body: { label: 'x' } }), 'version');
    expectValidation(await call('PATCH', `${PATH}/${id}`, { body: { label: '', version: 1 } }), 'label');
    expectValidation(
      await call('PATCH', `${PATH}/${id}`, { body: { label: 'x', version: 1, sample_amount: null } }),
      'sample_amount',
    );
    expect((await call('GET', `${PATH}/${id}`)).body).toMatchObject({ label: 'patch-invalido', version: 1 });
  });

  it('PATCH y DELETE de un id inexistente o malformado → 404', async () => {
    expect((await call('PATCH', `${PATH}/${randomUUID()}`, { body: { label: 'x', version: 1 } })).status).toBe(404);
    expect((await call('PATCH', `${PATH}/nope`, { body: { label: 'x', version: 1 } })).status).toBe(404);
    expect((await call('DELETE', `${PATH}/${randomUUID()}`)).status).toBe(404);
    expect((await call('DELETE', `${PATH}/nope`)).status).toBe(404);
  });

  it('DELETE → 204 sin cuerpo; después GET y DELETE → 404', async () => {
    const id = String((await create({ label: 'borrar' })).body['id']);
    const res = await call('DELETE', `${PATH}/${id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await call('GET', `${PATH}/${id}`)).status).toBe(404);
    expect((await call('DELETE', `${PATH}/${id}`)).status).toBe(404);
  });

  it('los errores son problem+json con correlation_id y sin detalles internos', async () => {
    const res = await call('GET', `${PATH}/${randomUUID()}`, { headers: { 'x-correlation-id': randomUUID() } });
    expect(res.body).toMatchObject({ status: 404, code: 'not-found' });
    expect(res.body['correlation_id']).toBe(res.headers.get('x-correlation-id'));
    noInternals(res);
  });
});
