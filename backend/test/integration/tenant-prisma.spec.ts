import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/common/config/app-config.js';
import { ConfigModule } from '../../src/common/config/config.module.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { CLS_CORRELATION_ID, CLS_TENANT_ID } from '../../src/common/logging/logger-options.js';
import {
  establishTenantContext,
  TenantContextConflictError,
} from '../../src/common/tenant-context/establish-context.js';
import { TenantContext, TenantContextMissingError } from '../../src/common/tenant-context/tenant-context.js';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import {
  TenantContextMismatchError,
  TenantContextTamperedError,
  TenantPrismaService,
  type TenantTransaction,
  TenantTransactionClosedError,
  TenantTransactionOwnershipError,
  TenantTransactionRequiredError,
} from '../../src/common/tenant-context/tenant-prisma.service.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { rejection, sqlState, TENANT_A, TENANT_B } from '../support/tenant-data.js';

/**
 * T039 (ADR-0004 C4-2, ADR-0002 C2-1; criterios S1–S5 del spike T014) sobre PostgreSQL 18 real. El servicio usa un
 * pool de UNA conexión: toda operación reutiliza el mismo backend, lo que hace observable cualquier fuga de contexto.
 */
let db: TestDatabase;
let pool: Pool;
let moduleRef: TestingModule;
let tenantPrisma: TenantPrismaService;
let cls: ClsService;
let config: AppConfig;

function asTenant<T>(tenantId: string, fn: () => Promise<T>, actorId: string | null = 'dev:test'): Promise<T> {
  return cls.run(() => {
    establishTenantContext(cls, { tenantId, actorId, actorType: 'DEV' });
    cls.set(CLS_CORRELATION_ID, randomUUID());
    return fn();
  });
}

/** Estado de la conexión fuera de cualquier transacción (mismo backend: el pool tiene una sola conexión). */
async function session(): Promise<{ tenant: string | null; actor: string | null; pid: number; visible: number }> {
  const { rows } = await pool.query<{ tenant: string | null; actor: string | null; pid: number; visible: string }>(
    `SELECT current_setting('app.tenant_id', true) AS tenant, current_setting('app.actor_id', true) AS actor,
            pg_backend_pid() AS pid, (SELECT count(*) FROM kuota.dev_probe_items) AS visible`,
  );
  return { ...rows[0]!, visible: Number(rows[0]!.visible) };
}
const isClean = (value: string | null) => value === null || value === '';

async function txInfo(tx: TenantTransaction): Promise<{ xid: string; pid: number }> {
  const [row] = await tx.$queryRaw<Array<{ xid: string; pid: number }>>`
    SELECT pg_current_xact_id()::text AS xid, pg_backend_pid() AS pid`;
  return row!;
}
const labels = (tenant: string) =>
  asTenant(tenant, () =>
    tenantPrisma.withTenant(async (tx) => (await tx.dev_probe_items.findMany()).map((r) => r.label)),
  );

beforeAll(async () => {
  db = await startTestDatabase();
  pool = new Pool({ connectionString: db.appUrl, max: 1 });
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
  tenantPrisma = moduleRef.get(TenantPrismaService);
  cls = moduleRef.get(ClsService);
}, 180_000);

afterAll(async () => {
  await moduleRef?.close();
  await pool?.end();
  await db?.stop();
});

describe('sin contexto de tenant: falla de forma segura', () => {
  it('withTenant sin contexto lanza TenantContextMissingError sin ejecutar el callback ni tocar la base', async () => {
    let called = false;
    const outside = await rejection(tenantPrisma.withTenant(() => Promise.resolve(void (called = true))));
    const insideWithoutContext = await rejection(
      cls.run(() => tenantPrisma.withTenant(() => Promise.resolve(void (called = true)))),
    );
    expect(outside).toBeInstanceOf(TenantContextMissingError);
    expect(insideWithoutContext).toBeInstanceOf(TenantContextMissingError);
    expect(called).toBe(false);
    expect(pool.totalCount).toBe(0);
  });

  it('el cliente transaccional no existe fuera de withTenant', async () => {
    await asTenant(TENANT_A, () => {
      expect(() => tenantPrisma.transaction()).toThrow(TenantTransactionRequiredError);
      return Promise.resolve();
    });
  });
});

describe('contexto efectivo dentro de withTenant', () => {
  it('fija tenant, actor y correlación como primera sentencia, con kuota_app_login sin BYPASSRLS', async () => {
    const correlation = randomUUID();
    const state = await cls.run(() => {
      establishTenantContext(cls, { tenantId: TENANT_A, actorId: 'dev:ana', actorType: 'DEV' });
      cls.set(CLS_CORRELATION_ID, correlation);
      return tenantPrisma.withTenant(async (tx) => {
        expect(tenantPrisma.transaction()).toBe(tx);
        const [row] = await tx.$queryRaw<Array<Record<string, unknown>>>`
          SELECT current_setting('app.tenant_id', true) AS tenant, current_setting('app.actor_id', true) AS actor,
                 current_setting('app.correlation_id', true) AS correlation, current_user AS usr,
                 (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
                 (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`;
        return row;
      });
    });
    expect(state).toEqual({
      tenant: TENANT_A,
      actor: 'dev:ana',
      correlation,
      usr: 'kuota_app_login',
      bypass: false,
      superuser: false,
    });
  });
});

describe('aislamiento entre tenants con el cliente transaccional (Prisma + RLS)', () => {
  it('B no lee, no lista, no modifica, no borra ni inserta en nombre de A', async () => {
    const itemA = await asTenant(TENANT_A, () =>
      tenantPrisma.withTenant((tx) => tx.dev_probe_items.create({ data: { label: 'de-A' } })),
    );
    expect(itemA.tenant_id).toBe(TENANT_A);

    await asTenant(TENANT_B, () =>
      tenantPrisma.withTenant(async (tx) => {
        expect(await tx.dev_probe_items.findUnique({ where: { id: itemA.id } })).toBeNull();
        expect((await tx.dev_probe_items.findMany()).some((r) => r.id === itemA.id)).toBe(false);
        expect(
          (await tx.dev_probe_items.updateMany({ where: { id: itemA.id }, data: { label: 'hackeado' } })).count,
        ).toBe(0);
        expect((await tx.dev_probe_items.deleteMany({ where: { id: itemA.id } })).count).toBe(0);
        const [raw] = await tx.$queryRaw<
          Array<{ n: bigint }>
        >`SELECT count(*) AS n FROM kuota.dev_probe_items WHERE id = ${itemA.id}::uuid`;
        expect(Number(raw!.n)).toBe(0);
      }),
    );

    const insertAsA = await rejection(
      asTenant(TENANT_B, () =>
        tenantPrisma.withTenant((tx) => tx.dev_probe_items.create({ data: { label: 'intruso', tenant_id: TENANT_A } })),
      ),
    );
    expect(sqlState(insertAsA)).toBe('42501');

    const stillA = await asTenant(TENANT_A, () =>
      tenantPrisma.withTenant((tx) => tx.dev_probe_items.findUnique({ where: { id: itemA.id } })),
    );
    expect(stillA?.label).toBe('de-A');
    expect(await labels(TENANT_B)).not.toContain('intruso');
  });
});

describe('ciclo de vida de la transacción y de la conexión', () => {
  it('tras el COMMIT la conexión vuelve al pool sin contexto (mismo backend)', async () => {
    const inside = await asTenant(TENANT_A, () =>
      tenantPrisma.withTenant(async (tx) => {
        await tx.dev_probe_items.create({ data: { label: 'commit' } });
        return txInfo(tx);
      }),
    );
    const after = await session();
    expect(after.pid).toBe(inside.pid);
    expect(isClean(after.tenant)).toBe(true);
    expect(isClean(after.actor)).toBe(true);
    expect(after.visible).toBe(0);
    expect(await labels(TENANT_A)).toContain('commit');
  });

  it('una excepción de la aplicación revierte todo y la conexión queda limpia y reutilizable', async () => {
    let pid = 0;
    const appError = new Error('fallo de la aplicación');
    const error = await rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await tx.dev_probe_items.create({ data: { label: 'rollback-app' } });
          pid = (await txInfo(tx)).pid;
          throw appError;
        }),
      ),
    );
    expect(error).toBe(appError);
    expect(await labels(TENANT_A)).not.toContain('rollback-app');
    const after = await session();
    expect(after.pid).toBe(pid);
    expect(isClean(after.tenant)).toBe(true);
  });

  it('un error de la base revierte la escritura previa; la conexión sirve después a otro tenant', async () => {
    let pid = 0;
    const error = await rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await tx.dev_probe_items.create({ data: { label: 'antes-del-error' } });
          pid = (await txInfo(tx)).pid;
          await tx.dev_probe_items.create({ data: { label: '' } }); // CHECK label 1–120 → 23514
        }),
      ),
    );
    expect(sqlState(error)).toBe('23514');
    expect(await labels(TENANT_A)).not.toContain('antes-del-error');

    const reused = await asTenant(TENANT_B, () =>
      tenantPrisma.withTenant(async (tx) => {
        const [row] = await tx.$queryRaw<
          Array<{ tenant: string }>
        >`SELECT current_setting('app.tenant_id', true) AS tenant`;
        return { ...(await txInfo(tx)), tenant: row!.tenant, rows: await tx.dev_probe_items.findMany() };
      }),
    );
    expect(reused.pid).toBe(pid);
    expect(reused.tenant).toBe(TENANT_B);
    expect(reused.rows.every((r) => r.tenant_id === TENANT_B)).toBe(true);
    expect(isClean((await session()).tenant)).toBe(true);
  });
});

describe('anidamiento (ADR-0002, C2-1)', () => {
  it('mismo tenant: reutiliza la MISMA transacción (mismo xid y backend, mismo cliente, ve lo no confirmado)', async () => {
    const result = await asTenant(TENANT_A, () =>
      tenantPrisma.withTenant(async (outer) => {
        const created = await outer.dev_probe_items.create({ data: { label: 'anidada' } });
        const outerInfo = await txInfo(outer);
        const inner = await tenantPrisma.withTenant(async (tx) => ({
          same: tx === outer,
          info: await txInfo(tx),
          sees: (await tx.dev_probe_items.findUnique({ where: { id: created.id } })) !== null,
        }));
        return { outerInfo, inner };
      }),
    );
    expect(result.inner.same).toBe(true);
    expect(result.inner.info).toEqual(result.outerInfo);
    expect(result.inner.sees).toBe(true);
  });

  it('una excepción en el callback anidado revierte toda la transacción (sin rollback parcial)', async () => {
    await rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async (outer) => {
          await outer.dev_probe_items.create({ data: { label: 'externa-revertida' } });
          await tenantPrisma.withTenant(async (inner) => {
            await inner.dev_probe_items.create({ data: { label: 'interna-revertida' } });
            throw new Error('fallo anidado');
          });
        }),
      ),
    );
    const current = await labels(TENANT_A);
    expect(current).not.toContain('externa-revertida');
    expect(current).not.toContain('interna-revertida');
  });

  it('otro tenant dentro de una transacción activa: TenantContextMismatchError y rollback total', async () => {
    let innerCalled = false;
    const error = await rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await tx.dev_probe_items.create({ data: { label: 'antes-del-cambio' } });
          // Simula un defecto que cambia el tenant del contexto a mitad de la transacción.
          await cls.run({ ifNested: 'inherit' }, () => {
            cls.set(CLS_TENANT_ID, TENANT_B);
            return tenantPrisma.withTenant(() => Promise.resolve(void (innerCalled = true)));
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
    expect(innerCalled).toBe(false);
    expect(await labels(TENANT_A)).not.toContain('antes-del-cambio');
  });

  it('el contexto es inmutable en la operación: establecer otro tenant lanza TenantContextConflictError', async () => {
    const error = await rejection(
      asTenant(TENANT_A, () =>
        Promise.resolve().then(() =>
          establishTenantContext(cls, { tenantId: TENANT_B, actorId: null, actorType: 'DEV' }),
        ),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextConflictError);
  });
});

describe('intento de eludir withTenant: set_config crudo dentro de la transacción (riesgo S5, P2)', () => {
  it('se detecta antes del COMMIT y se revierte todo lo escrito', async () => {
    await asTenant(TENANT_B, () =>
      tenantPrisma.withTenant((tx) => tx.dev_probe_items.create({ data: { label: 'de-B' } })),
    );
    let visibleAfterTamper = -1;
    const error = await rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          // Prohibido por lint en src/ (P2); aquí se simula el bypass.
          await tx.$queryRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
          visibleAfterTamper = (await tx.dev_probe_items.findMany()).length;
          await tx.dev_probe_items.create({ data: { label: 'escrito-tras-manipular' } });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextTamperedError);
    expect(await labels(TENANT_B)).not.toContain('escrito-tras-manipular');
    // LÍMITE: entre la manipulación y el COMMIT, las LECTURAS ya vieron filas de B. La verificación final revierte las
    // escrituras, pero no puede deshacer una lectura: la prevención es estática (lint P2) y de revisión.
    expect(visibleAfterTamper).toBeGreaterThan(0);
  });
});

describe('transaction() dentro de withTenant', () => {
  it('rechaza el cliente activo si el tenant del contexto cambió (TenantContextMismatchError)', async () => {
    await rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async () => {
          await cls.run({ ifNested: 'inherit' }, () => {
            cls.set(CLS_TENANT_ID, TENANT_B);
            expect(() => tenantPrisma.transaction()).toThrow(TenantContextMismatchError);
            return Promise.resolve();
          });
          throw new Error('fin');
        }),
      ),
    );
  });
});

describe('R3 de P2 (mitigado): referencia filtrada del cliente transaccional', () => {
  it('otra operación que use el `tx` retenido de A mientras sigue abierto se rechaza sin leer; A se revierte', async () => {
    // Antes del hardening (1f6057e) B leía las filas de A. Detalle: tenant-transaction-ownership.spec.ts.
    let leaked: TenantTransaction | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holder = rejection(
      asTenant(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await tx.dev_probe_items.create({ data: { label: 'filtrado-A' } });
          leaked = tx;
          await gate;
        }),
      ),
    );
    while (!leaked) await new Promise((r) => setTimeout(r, 5));
    const fromB = await rejection(asTenant(TENANT_B, () => leaked!.dev_probe_items.findMany()));
    release();
    expect(fromB).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(await holder).toBe(fromB);
    expect(await labels(TENANT_A)).not.toContain('filtrado-A');
    expect(await rejection(asTenant(TENANT_A, () => leaked!.dev_probe_items.findMany()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
  });
});

describe('concurrencia: 2 tenants intercalados sobre un pool pequeño (criterio S2)', () => {
  it('100 operaciones (50 por tenant) con pool de 3: 0 filas cruzadas y backends reutilizados entre tenants', async () => {
    const concurrentPool = new Pool({ connectionString: db.appUrl, max: 3 });
    const service = new TenantPrismaService(config, moduleRef.get(TenantContext), { pool: concurrentPool });
    const before = { A: (await labels(TENANT_A)).length, B: (await labels(TENANT_B)).length };
    let seed = 20261122;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const ops = Array.from({ length: 100 }, (_, i) => ({
      i,
      tenant: i % 2 === 0 ? TENANT_A : TENANT_B,
      delay: Math.floor(random() * 10),
    }));
    const completed: Array<{ tenant: string; pid: number; cross: number; settingOk: boolean }> = [];
    try {
      await Promise.all(
        ops.map((op) =>
          asTenant(op.tenant, () =>
            service.withTenant(async (tx) => {
              await tx.dev_probe_items.create({ data: { label: `conc-${op.i}` } });
              await new Promise((r) => setTimeout(r, op.delay));
              const rows = await tx.dev_probe_items.findMany();
              const [s] = await tx.$queryRaw<Array<{ tenant: string; pid: number }>>`
                SELECT current_setting('app.tenant_id', true) AS tenant, pg_backend_pid() AS pid`;
              completed.push({
                tenant: op.tenant,
                pid: s!.pid,
                cross: rows.filter((r) => r.tenant_id !== op.tenant).length,
                settingOk: s!.tenant === op.tenant,
              });
            }),
          ),
        ),
      );
      expect(completed).toHaveLength(100);
      expect(completed.reduce((sum, c) => sum + c.cross, 0)).toBe(0);
      expect(completed.every((c) => c.settingOk)).toBe(true);
      const pids = new Set(completed.map((c) => c.pid));
      expect(pids.size).toBeLessThanOrEqual(3);
      let switches = 0;
      for (const pid of pids) {
        const seq = completed.filter((c) => c.pid === pid);
        for (let k = 1; k < seq.length; k++) if (seq[k]!.tenant !== seq[k - 1]!.tenant) switches++;
      }
      expect(switches).toBeGreaterThanOrEqual(10);
      expect((await labels(TENANT_A)).length).toBe(before.A + 50);
      expect((await labels(TENANT_B)).length).toBe(before.B + 50);
    } finally {
      await service.onModuleDestroy();
      await concurrentPool.end();
    }
  }, 60_000);
});

/* eslint-disable @typescript-eslint/no-unsafe-call -- comprobación de tipos intencional: estas llamadas NO deben compilar */
// Verificación de tipos (pnpm typecheck): el cliente transaccional no expone SQL dinámico ni control de transacciones.
export function typeLevelChecks(tx: TenantTransaction): void {
  // @ts-expect-error $queryRawUnsafe no existe en TenantTransaction
  void tx.$queryRawUnsafe('SELECT 1');
  // @ts-expect-error $executeRawUnsafe no existe en TenantTransaction
  void tx.$executeRawUnsafe('SELECT 1');
  // @ts-expect-error no se pueden abrir transacciones anidadas propias
  void tx.$transaction;
}
/* eslint-enable @typescript-eslint/no-unsafe-call */
