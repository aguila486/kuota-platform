import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/common/config/app-config.js';
import { ConfigModule } from '../../src/common/config/config.module.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { CLS_CORRELATION_ID } from '../../src/common/logging/logger-options.js';
import { Money } from '../../src/common/money/index.js';
import { establishTenantContext } from '../../src/common/tenant-context/establish-context.js';
import { TenantContext } from '../../src/common/tenant-context/tenant-context.js';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import {
  TenantPrismaService,
  type TenantTransaction,
  TenantTransactionClosedError,
  TenantTransactionOwnershipError,
} from '../../src/common/tenant-context/tenant-prisma.service.js';
import { PrismaDevProbeRepository } from '../../src/modules/dev-probe/infrastructure/prisma-dev-probe.repository.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { rejection } from '../support/tenant-data.js';

/**
 * T041: primer repositorio tenant-scoped (`PrismaDevProbeRepository`) sobre PostgreSQL 18 real, con el
 * `TenantPrismaService` endurecido (R3). Comprueba RLS, tenant desde el contexto, rollback, reutilización de conexiones
 * y que el cliente transaccional que usa el repositorio no puede reutilizarse fuera de su operación.
 */
let db: TestDatabase;
let pool: Pool;
let moduleRef: TestingModule;
let cls: ClsService;
let config: AppConfig;
let context: TenantContext;
let tenantPrisma: TenantPrismaService;
let repo: PrismaDevProbeRepository;
let admin: Client;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function request<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return cls.run(() => {
    establishTenantContext(cls, { tenantId, actorId: 'dev:repo', actorType: 'DEV' });
    cls.set(CLS_CORRELATION_ID, randomUUID());
    return fn();
  });
}
const tenantOf = async (id: string) =>
  (await admin.query<{ tenant_id: string }>('SELECT tenant_id FROM kuota.dev_probe_items WHERE id = $1', [id])).rows[0]
    ?.tenant_id;

/** Captura el cliente transaccional que recibe el repositorio, como haría código defectuoso que lo retuviera. */
function captureClients(service: TenantPrismaService): { readonly clients: TenantTransaction[]; restore(): void } {
  const clients: TenantTransaction[] = [];
  const original = service.withTenant.bind(service);
  const spy = vi.spyOn(service, 'withTenant').mockImplementation(<T>(fn: (tx: TenantTransaction) => Promise<T>) =>
    original((tx) => {
      clients.push(tx);
      return fn(tx);
    }),
  );
  return { clients, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  db = await startTestDatabase();
  pool = new Pool({ connectionString: db.appUrl, max: 4 });
  config = loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, LOG_LEVEL: 'silent' }));
  moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true }), ConfigModule.forConfig(config), TenantContextModule],
  })
    .overrideProvider(TenantPrismaService)
    .useFactory({
      factory: (c: AppConfig, ctx: TenantContext) => new TenantPrismaService(c, ctx, { pool }),
      inject: [APP_CONFIG, TenantContext],
    })
    .compile();
  cls = moduleRef.get(ClsService);
  context = moduleRef.get(TenantContext);
  tenantPrisma = moduleRef.get(TenantPrismaService);
  repo = new PrismaDevProbeRepository(tenantPrisma);
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await moduleRef?.close();
  await pool?.end();
  await db?.stop();
});

describe('operaciones del repositorio (T041)', () => {
  it('create: tenant del contexto (nunca de un argumento), UUIDv7 del servidor, Money como bigint exacto', async () => {
    const A = randomUUID();
    const item = await request(A, () =>
      repo.create({ label: 'repo', sampleAmount: Money.of(-9223372036854775807n, 'USD') }),
    );
    expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await tenantOf(item.id)).toBe(A);
    expect(item.sampleAmount?.amountMinor).toBe(-9223372036854775807n);
    const { rows } = await admin.query<{ a: string }>(
      'SELECT sample_amount_minor::text AS a FROM kuota.dev_probe_items WHERE id = $1',
      [item.id],
    );
    expect(rows[0]!.a).toBe('-9223372036854775807');
  });

  it('RLS: findById, list, updateLabel y delete de otro tenant no ven ni tocan el registro', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const ofA = await request(A, () => repo.create({ label: 'de-A', sampleAmount: null }));
    await request(B, async () => {
      expect(await repo.findById(ofA.id)).toBeNull();
      expect((await repo.list(100, null)).items).toEqual([]);
      expect(await repo.updateLabel(ofA.id, 'hack', 1)).toEqual({ kind: 'not-found' });
      expect(await repo.delete(ofA.id)).toBeNull();
    });
    const still = await request(A, () => repo.findById(ofA.id));
    expect(still).toMatchObject({ label: 'de-A', version: 1 });
  });

  it('updateLabel: versión vigente → updated; vieja → version-conflict; inexistente → not-found', async () => {
    const A = randomUUID();
    const item = await request(A, () => repo.create({ label: 'v1', sampleAmount: null }));
    await request(A, async () => {
      const ok = await repo.updateLabel(item.id, 'v2', 1);
      expect(ok.kind).toBe('updated');
      expect(ok.kind === 'updated' && ok.item.version).toBe(2);
      expect(await repo.updateLabel(item.id, 'v3', 1)).toEqual({ kind: 'version-conflict' });
      expect(await repo.updateLabel(randomUUID(), 'v3', 1)).toEqual({ kind: 'not-found' });
    });
  });

  it('list: keyset por id con nextAfterId', async () => {
    const A = randomUUID();
    const ids = await request(A, async () => {
      const out: string[] = [];
      for (let i = 0; i < 5; i++) out.push((await repo.create({ label: `k${i}`, sampleAmount: null })).id);
      return out;
    });
    const first = await request(A, () => repo.list(2, null));
    const second = await request(A, () => repo.list(2, first.nextAfterId));
    const third = await request(A, () => repo.list(2, second.nextAfterId));
    expect([...first.items, ...second.items, ...third.items].map((i) => i.id)).toEqual([...ids].sort());
    expect(third.nextAfterId).toBeNull();
  });
});

describe('transacción, rollback y conexiones', () => {
  it('dentro de un withTenant externo el repositorio reutiliza la transacción; una excepción revierte su escritura', async () => {
    const A = randomUUID();
    const failure = new Error('fallo del caso de uso');
    let seenInside = false;
    const error = await rejection(
      request(A, () =>
        tenantPrisma.withTenant(async (tx) => {
          const created = await repo.create({ label: 'revertido', sampleAmount: null });
          seenInside = (await tx.dev_probe_items.findUnique({ where: { id: created.id } })) !== null;
          throw failure;
        }),
      ),
    );
    expect(error).toBe(failure);
    expect(seenInside).toBe(true);
    expect((await admin.query("SELECT 1 FROM kuota.dev_probe_items WHERE label = 'revertido'")).rowCount).toBe(0);
  });

  it('pool de 1 conexión: tenants alternados reutilizan el mismo backend sin mezclar datos', async () => {
    const single = new Pool({ connectionString: db.appUrl, max: 1 });
    const service = new TenantPrismaService(config, context, { pool: single });
    const singleRepo = new PrismaDevProbeRepository(service);
    try {
      const [A, B] = [randomUUID(), randomUUID()];
      const pids = new Set<number>();
      for (let i = 0; i < 6; i++) {
        const tenant = i % 2 === 0 ? A : B;
        const page = await request(tenant, async () => {
          await singleRepo.create({ label: `pool-${i}`, sampleAmount: null });
          const [row] = await service.withTenant(
            (tx) => tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`,
          );
          pids.add(row!.pid);
          return singleRepo.list(100, null);
        });
        expect(page.items.every((item) => item.label.startsWith('pool-'))).toBe(true);
        expect(page.items).toHaveLength(Math.floor(i / 2) + 1);
      }
      expect(pids.size).toBe(1);
    } finally {
      await service.onModuleDestroy();
      await single.end();
    }
  });

  it('50 llamadas concurrentes al repositorio de 2 tenants: ninguna ve datos del otro', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(i % 2 ? B : A, async () => {
          await repo.create({ label: `c${i}`, sampleAmount: null });
          await sleep(i % 4);
          return { tenant: i % 2 ? B : A, ids: (await repo.list(100, null)).items.map((x) => x.id) };
        }),
      ),
    );
    for (const r of results) {
      for (const id of r.ids) expect(await tenantOf(id)).toBe(r.tenant);
    }
  }, 60_000);
});

describe('R3 sobre el primer repositorio real: el cliente que usa no sirve fuera de su operación', () => {
  it('cliente retenido tras terminar la operación (COMMIT): rechazado en el mismo y en otro tenant', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const capture = captureClients(tenantPrisma);
    await request(A, () => repo.create({ label: 'retenido', sampleAmount: null }));
    capture.restore();
    const retained = capture.clients[0]!;
    expect(await rejection(request(A, () => retained.dev_probe_items.findMany()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
    expect(await rejection(request(B, () => retained.dev_probe_items.findMany()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
  });

  it('transacción abierta: el cliente del repositorio usado desde otro tenant, desde otra solicitud del mismo tenant o como consulta diferida → rechazado sin datos; la operación original se revierte', async () => {
    const [A, B] = [randomUUID(), randomUUID()];
    const capture = captureClients(tenantPrisma);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let deferred: PromiseLike<unknown> | undefined;
    let ready = false;
    const holder = rejection(
      request(A, () =>
        tenantPrisma.withTenant(async () => {
          await repo.create({ label: 'operacion-A', sampleAmount: null });
          deferred = capture.clients[0]!.dev_probe_items.findMany();
          ready = true;
          await gate;
        }),
      ),
    );
    while (!ready) await sleep(2);
    capture.restore();
    const leaked = capture.clients[0]!;
    // Mientras tanto, el repositorio de B usa SU propia transacción y solo ve lo suyo.
    await request(B, () => repo.create({ label: 'operacion-B', sampleAmount: null }));
    const fromB = await rejection(request(B, () => leaked.dev_probe_items.findMany()));
    const fromA2 = await rejection(request(A, () => leaked.dev_probe_items.findMany()));
    const deferredInB = await rejection(request(B, async () => await deferred!));
    const bOwn = await request(B, () => repo.list(100, null));
    release();
    const outcome = await holder;
    expect(fromB).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(fromA2).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(deferredInB).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(bOwn.items.map((i) => i.label)).toEqual(['operacion-B']);
    expect(outcome).toBe(fromB);
    expect((await admin.query("SELECT 1 FROM kuota.dev_probe_items WHERE label = 'operacion-A'")).rowCount).toBe(0);
    expect(await rejection(request(A, () => leaked.dev_probe_items.count()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
  });
});
