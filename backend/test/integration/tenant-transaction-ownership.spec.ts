import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/common/config/app-config.js';
import { ConfigModule } from '../../src/common/config/config.module.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { CLS_CORRELATION_ID } from '../../src/common/logging/logger-options.js';
import { establishTenantContext } from '../../src/common/tenant-context/establish-context.js';
import { TenantContext } from '../../src/common/tenant-context/tenant-context.js';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import { TenantPrismaService, type TenantTransaction } from '../../src/common/tenant-context/tenant-prisma.service.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { rejection, TENANT_A, TENANT_B } from '../support/tenant-data.js';

/**
 * Riesgo R3 de P2 (docs/security/p2-tenant-context-risk-assessment.md): un cliente transaccional retenido por código
 * defectuoso y usado desde otra operación. PostgreSQL 18 real (Testcontainers), dos tenants con datos distinguibles.
 *
 * REPRODUCCIÓN (estado de T039 en 66c5ea4, antes del hardening): estas pruebas fijan el comportamiento inseguro.
 */
let db: TestDatabase;
let pool: Pool;
let moduleRef: TestingModule;
let tenantPrisma: TenantPrismaService;
let cls: ClsService;
let config: AppConfig;
let raw: PrismaClient;
let rawPool: Pool;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una solicitud independiente: contexto CLS nuevo con su tenant, actor y correlación. */
function request<T>(tenantId: string, fn: () => Promise<T>, actorId: string | null = 'dev:test'): Promise<T> {
  return cls.run(() => {
    establishTenantContext(cls, { tenantId, actorId, actorType: 'DEV' });
    cls.set(CLS_CORRELATION_ID, randomUUID());
    return fn();
  });
}

interface Held<C> {
  readonly client: C;
  /** Termina el callback de la transacción retenida (COMMIT, o ROLLBACK si `fail`). */
  release(fail?: boolean): Promise<void>;
}

/** Abre una transacción, expone su cliente "filtrado" y la mantiene abierta hasta `release()`. */
async function hold<C>(open: (fn: (client: C) => Promise<void>) => Promise<void>): Promise<Held<C>> {
  let leaked: C | undefined;
  let finish!: (fail: boolean) => void;
  const gate = new Promise<boolean>((resolve) => (finish = resolve));
  const done = open(async (client) => {
    leaked = client;
    if (await gate) throw new Error('rollback solicitado por la prueba');
  }).catch(() => undefined);
  while (leaked === undefined) await sleep(2);
  return {
    client: leaked,
    release: async (fail = false) => {
      finish(fail);
      await done;
    },
  };
}

const serviceHold = (tenant: string) =>
  hold<TenantTransaction>((fn) => request(tenant, () => tenantPrisma.withTenant(fn)));

/** Prisma sin guard: el mismo patrón de T039 (set_config como primera sentencia) sobre el cliente crudo. */
function rawWithTenant<T>(tenant: string, fn: (tx: Omit<PrismaClient, never>) => Promise<T>): Promise<T> {
  return raw.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

const tenantsOf = (rows: Array<{ tenant_id: string }>) => [...new Set(rows.map((r) => r.tenant_id))];

beforeAll(async () => {
  db = await startTestDatabase();
  pool = new Pool({ connectionString: db.appUrl, max: 4 });
  config = loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, LOG_LEVEL: 'silent' }));
  moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true }), ConfigModule.forConfig(config), TenantContextModule],
  })
    .overrideProvider(TenantPrismaService)
    .useFactory({
      factory: (c: AppConfig, ctx: TenantContext, service: ClsService) =>
        new TenantPrismaService(c, ctx, service, { pool }),
      inject: [APP_CONFIG, TenantContext, ClsService],
    })
    .compile();
  tenantPrisma = moduleRef.get(TenantPrismaService);
  cls = moduleRef.get(ClsService);
  rawPool = new Pool({ connectionString: db.appUrl, max: 2 });
  raw = new PrismaClient({ adapter: new PrismaPg(rawPool) });

  for (const [tenant, label] of [
    [TENANT_A, 'dato-de-A'],
    [TENANT_B, 'dato-de-B'],
  ] as const) {
    await request(tenant, () => tenantPrisma.withTenant((tx) => tx.dev_probe_items.create({ data: { label } })));
  }
}, 180_000);

afterAll(async () => {
  await raw?.$disconnect();
  await rawPool?.end();
  await moduleRef?.close();
  await pool?.end();
  await db?.stop();
});

describe('Prisma 7.10.1 sin guard (caracterización del cliente transaccional crudo)', () => {
  it('las operaciones son diferidas: no se ejecutan hasta then/await', async () => {
    const count = await rawWithTenant(TENANT_A, async (tx) => {
      const before = await tx.dev_probe_items.count();
      const pending = tx.dev_probe_items.create({ data: { label: 'diferida' } });
      const notYet = await tx.dev_probe_items.count();
      await pending;
      const after = await tx.dev_probe_items.count();
      throw Object.assign(new Error('rollback'), { counts: [before, notYet, after] });
    }).catch((e: { counts: number[] }) => e.counts);
    expect(count[1]).toBe(count[0]);
    expect(count[2]).toBe(count[0]! + 1);
  });

  it('el cliente crudo no comprueba el contexto: otra operación de B lee como A mientras la transacción sigue abierta', async () => {
    const held = await hold<PrismaClient>((fn) => rawWithTenant(TENANT_A, fn));
    const seen = await request(TENANT_B, () => held.client.dev_probe_items.findMany());
    await held.release();
    expect(tenantsOf(seen)).toEqual([TENANT_A]);
  });
});

describe('REPRODUCCIÓN R3 en TenantPrismaService (T039 antes del hardening)', () => {
  it('cliente de A usado desde una solicitud de B: B lee filas de A', async () => {
    const held = await serviceHold(TENANT_A);
    const seen = await request(TENANT_B, () => held.client.dev_probe_items.findMany());
    await held.release();
    expect(tenantsOf(seen)).toEqual([TENANT_A]);
  });

  it('cliente de A usado desde OTRA solicitud del mismo tenant: escribe dentro de la transacción ajena', async () => {
    const held = await serviceHold(TENANT_A);
    await request(TENANT_A, () =>
      held.client.dev_probe_items.create({ data: { label: 'escrito-por-otra-solicitud' } }),
    );
    // La escritura de la segunda solicitud queda en la transacción de la primera y se pierde con su ROLLBACK.
    await held.release(true);
    const labels = await request(TENANT_A, () =>
      tenantPrisma.withTenant(async (tx) => (await tx.dev_probe_items.findMany()).map((r) => r.label)),
    );
    expect(labels).not.toContain('escrito-por-otra-solicitud');
  });

  it('cliente de A usado desde B dentro de la propia transacción de B: lee como A', async () => {
    const held = await serviceHold(TENANT_A);
    const seen = await request(TENANT_B, () =>
      tenantPrisma.withTenant(async () => held.client.dev_probe_items.findMany()),
    );
    await held.release();
    expect(tenantsOf(seen)).toEqual([TENANT_A]);
  });

  it('consulta diferida construida en A y ejecutada desde B: devuelve filas de A', async () => {
    let pending: PromiseLike<Array<{ tenant_id: string }>> | undefined;
    const held = await hold<TenantTransaction>((fn) =>
      request(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          pending = tx.dev_probe_items.findMany();
          await fn(tx);
        }),
      ),
    );
    const seen = await request(TENANT_B, async () => await pending!);
    await held.release();
    expect(tenantsOf(seen)).toEqual([TENANT_A]);
  });

  it('tras COMMIT o ROLLBACK la referencia retenida falla (lo rechaza Prisma, no el servicio)', async () => {
    const committed = await serviceHold(TENANT_A);
    await committed.release();
    expect(await rejection(request(TENANT_A, () => committed.client.dev_probe_items.findMany()))).toBeDefined();
    const rolledBack = await serviceHold(TENANT_A);
    await rolledBack.release(true);
    expect(await rejection(request(TENANT_A, () => rolledBack.client.dev_probe_items.findMany()))).toBeDefined();
  });

  it('el cliente interno expone el PrismaClient base a quien lea la propiedad privada de TypeScript', () => {
    const exposed = (tenantPrisma as unknown as Record<string, { $transaction?: unknown } | undefined>)['prisma'];
    expect(typeof exposed?.$transaction).toBe('function');
  });
});
