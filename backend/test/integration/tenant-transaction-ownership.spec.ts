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
import { CLS_ACTOR_ID, CLS_CORRELATION_ID, CLS_TENANT_ID } from '../../src/common/logging/logger-options.js';
import { establishTenantContext } from '../../src/common/tenant-context/establish-context.js';
import { TenantContext, TenantContextMissingError } from '../../src/common/tenant-context/tenant-context.js';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import {
  TenantContextMismatchError,
  TenantPrismaService,
  type TenantTransaction,
  TenantTransactionClosedError,
  TenantTransactionOwnershipError,
} from '../../src/common/tenant-context/tenant-prisma.service.js';
import { MODEL_OPERATIONS } from '../../src/common/tenant-context/transaction-guard.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { rejection, TENANT_A, TENANT_B } from '../support/tenant-data.js';

/**
 * Riesgo R3 de P2 (docs/security/p2-tenant-context-risk-assessment.md): un cliente transaccional retenido por código
 * defectuoso y usado desde otra operación. PostgreSQL 18 real (Testcontainers), dos tenants con datos distinguibles.
 *
 * - "Prisma sin guard": caracterización PERMANENTE del cliente transaccional crudo de Prisma 7.10.1 (el riesgo existe
 *   en la primitiva; lo que lo mitiga es el cliente protegido de T039).
 * - Reproducción contra T039 antes del hardening: commit 1f6057e (las mismas situaciones devolvían filas de A).
 * - Resto: garantías 4.1–4.9 del hardening y los 15 casos obligatorios.
 */
let db: TestDatabase;
let pool: Pool;
let moduleRef: TestingModule;
let tenantPrisma: TenantPrismaService;
let cls: ClsService;
let config: AppConfig;
let context: TenantContext;
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
  /** Termina el callback de la transacción retenida (COMMIT, o ROLLBACK si `fail`) y devuelve su resultado o error. */
  release(fail?: boolean): Promise<unknown>;
}

/** Abre una transacción, expone su cliente "filtrado" y la mantiene abierta hasta `release()`. */
async function hold<C>(
  open: (fn: (client: C) => Promise<string>) => Promise<string>,
  before?: (client: C) => Promise<unknown>,
): Promise<Held<C>> {
  let leaked: C | undefined;
  let finish!: (fail: boolean) => void;
  const gate = new Promise<boolean>((resolve) => (finish = resolve));
  const done = open(async (client) => {
    await before?.(client);
    leaked = client;
    if (await gate) throw new Error('rollback solicitado por la prueba');
    return 'committed';
  }).catch((error: unknown) => error);
  while (leaked === undefined) await sleep(2);
  return {
    client: leaked,
    release: (fail = false) => {
      finish(fail);
      return done;
    },
  };
}

const serviceHold = (
  tenant: string,
  before?: (tx: TenantTransaction) => Promise<unknown>,
  service: TenantPrismaService = tenantPrisma,
) => hold<TenantTransaction>((fn) => request(tenant, () => service.withTenant(fn)), before);

/** Prisma sin guard: el mismo patrón de T039 (set_config como primera sentencia) sobre el cliente crudo. */
function rawWithTenant<T>(tenant: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return raw.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

const tenantsOf = (rows: Array<{ tenant_id: string }>) => [...new Set(rows.map((r) => r.tenant_id))];
const labelsOf = (tenant: string, service: TenantPrismaService = tenantPrisma) =>
  request(tenant, () => service.withTenant(async (tx) => (await tx.dev_probe_items.findMany()).map((r) => r.label)));
const txInfo = async (tx: TenantTransaction) =>
  (
    await tx.$queryRaw<Array<{ xid: string; pid: number; tenant: string }>>`
    SELECT pg_current_xact_id()::text AS xid, pg_backend_pid() AS pid,
           current_setting('app.tenant_id', true) AS tenant`
  )[0]!;

function newService(options: { pool: Pool; timeout?: number }): TenantPrismaService {
  return new TenantPrismaService(config, context, options);
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
  tenantPrisma = moduleRef.get(TenantPrismaService);
  cls = moduleRef.get(ClsService);
  context = moduleRef.get(TenantContext);
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

describe('Prisma 7.10.1 sin guard (caracterización permanente del cliente transaccional crudo)', () => {
  it('las operaciones son diferidas: no se ejecutan hasta then/await', async () => {
    const counts = await rawWithTenant(TENANT_A, async (tx) => {
      const before = await tx.dev_probe_items.count();
      const pending = tx.dev_probe_items.create({ data: { label: 'diferida' } });
      const notYet = await tx.dev_probe_items.count();
      await pending;
      const after = await tx.dev_probe_items.count();
      throw Object.assign(new Error('rollback'), { counts: [before, notYet, after] });
    }).catch((e: { counts: number[] }) => e.counts);
    expect(counts[1]).toBe(counts[0]);
    expect(counts[2]).toBe(counts[0]! + 1);
  });

  it('el cliente crudo no comprueba el contexto: otra operación de B lee como A mientras la transacción sigue abierta', async () => {
    const held = await hold<PrismaClient>((fn) => rawWithTenant(TENANT_A, fn));
    const seen = await request(TENANT_B, () => held.client.dev_probe_items.findMany());
    await held.release();
    expect(tenantsOf(seen)).toEqual([TENANT_A]);
  });

  it('el cliente crudo expone $transaction, SQL dinámico e internos que el cliente protegido no tiene', async () => {
    const held = await hold<PrismaClient>((fn) => rawWithTenant(TENANT_A, fn));
    const rawTx = held.client as unknown as Record<string, unknown>;
    const exposed = ['$queryRawUnsafe', '$executeRawUnsafe', '$transaction'].filter((k) => rawTx[k] !== undefined);
    await held.release();
    expect(exposed.length).toBeGreaterThan(0);
  });
});

describe('4.1 misma operación: el cliente funciona en su transacción y contexto (casos 1, 2)', () => {
  it('consulta correcta desde A y desde B: cada uno ve solo lo suyo', async () => {
    const fromA = await request(TENANT_A, () => tenantPrisma.withTenant((tx) => tx.dev_probe_items.findMany()));
    const fromB = await request(TENANT_B, () => tenantPrisma.withTenant((tx) => tx.dev_probe_items.findMany()));
    expect(tenantsOf(fromA)).toEqual([TENANT_A]);
    expect(tenantsOf(fromB)).toEqual([TENANT_B]);
  });

  it('todas las rutas de ejecución funcionan dentro de la operación: modelo, raw, then/catch/finally, Promise.all', async () => {
    const out = await request(TENANT_A, () =>
      tenantPrisma.withTenant(async (tx) => {
        const created = await tx.dev_probe_items.create({ data: { label: 'rutas-ok' } });
        const unique = await tx.dev_probe_items.findUnique({ where: { id: created.id } });
        const updated = await tx.dev_probe_items.update({ where: { id: created.id }, data: { label: 'rutas-ok-2' } });
        const viaThen = await tx.dev_probe_items.count().then((n) => n);
        const viaCatch = await tx.dev_probe_items.count().catch(() => -1);
        let finallyRan = false;
        await tx.dev_probe_items.count().finally(() => (finallyRan = true));
        const [raws, executed] = await Promise.all([
          tx.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`,
          tx.$executeRaw`UPDATE kuota.dev_probe_items SET label = 'rutas-ok-3' WHERE id = ${created.id}::uuid`,
        ]);
        const deleted = await tx.dev_probe_items.delete({ where: { id: created.id } });
        const nested = await tenantPrisma.withTenant((inner) => Promise.resolve(inner === tx));
        return { unique, updated, viaThen, viaCatch, finallyRan, raws, executed, deleted, nested };
      }),
    );
    expect(out.unique?.label).toBe('rutas-ok');
    expect(out.updated.label).toBe('rutas-ok-2');
    expect(out.viaThen).toBeGreaterThan(0);
    expect(out.viaCatch).toBe(out.viaThen);
    expect(out.finallyRan).toBe(true);
    expect(out.raws).toEqual([{ one: 1 }]);
    expect(out.executed).toBe(1);
    expect(out.deleted.label).toBe('rutas-ok-3');
    expect(out.nested).toBe(true);
  });
});

describe('4.2 tenant distinto: el cliente de A usado desde B falla antes de devolver datos (caso 3)', () => {
  it('desde una solicitud de B sin transacción: TenantTransactionOwnershipError, sin filas; A se revierte', async () => {
    const held = await serviceHold(TENANT_A, (tx) => tx.dev_probe_items.create({ data: { label: 'A-comprometida' } }));
    const fromB = await rejection(request(TENANT_B, () => held.client.dev_probe_items.findMany()));
    const outcome = await held.release();
    expect(fromB).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(outcome).toBe(fromB);
    expect(await labelsOf(TENANT_A)).not.toContain('A-comprometida');
  });

  it('desde B dentro de su propia transacción: rechazado; la transacción de B sigue sana', async () => {
    const held = await serviceHold(TENANT_A);
    const result = await request(TENANT_B, () =>
      tenantPrisma.withTenant(async (tx) => ({
        misuse: await rejection(held.client.dev_probe_items.findMany()),
        own: tenantsOf(await tx.dev_probe_items.findMany()),
      })),
    );
    await held.release();
    expect(result.misuse).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(result.own).toEqual([TENANT_B]);
  });

  it('cada operación (lectura, escritura y raw) se rechaza y ninguna escritura llega a la base', async () => {
    const held = await serviceHold(TENANT_A);
    const [anyRow] = await request(TENANT_A, () => tenantPrisma.withTenant((tx) => tx.dev_probe_items.findMany()));
    const tx = held.client;
    const attempts = await request(TENANT_B, () =>
      Promise.all([
        rejection(tx.dev_probe_items.findMany()),
        rejection(tx.dev_probe_items.findUnique({ where: { id: anyRow!.id } })),
        rejection(tx.dev_probe_items.create({ data: { label: 'intruso-B' } })),
        rejection(tx.dev_probe_items.update({ where: { id: anyRow!.id }, data: { label: 'intruso-B' } })),
        rejection(tx.dev_probe_items.delete({ where: { id: anyRow!.id } })),
        rejection(tx.$queryRaw`SELECT count(*) FROM kuota.dev_probe_items`),
        rejection(tx.$executeRaw`UPDATE kuota.dev_probe_items SET label = 'intruso-B'`),
      ]),
    );
    await held.release();
    expect(attempts.every((e) => e instanceof TenantTransactionOwnershipError)).toBe(true);
    const labels = await labelsOf(TENANT_A);
    expect(labels).not.toContain('intruso-B');
    expect(labels).toContain(anyRow!.label);
  });
});

describe('4.3 mismo tenant, distinta solicitud (caso 4)', () => {
  it('otra solicitud de A no puede reutilizar el cliente; la transacción original se revierte entera', async () => {
    const held = await serviceHold(TENANT_A, (tx) => tx.dev_probe_items.create({ data: { label: 'solicitud-1' } }));
    const other = await rejection(
      request(TENANT_A, () => held.client.dev_probe_items.create({ data: { label: 'solicitud-2' } })),
    );
    const outcome = await held.release();
    expect(other).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(outcome).toBe(other);
    const labels = await labelsOf(TENANT_A);
    expect(labels).not.toContain('solicitud-1');
    expect(labels).not.toContain('solicitud-2');
  });

  it('tampoco desde otra solicitud de A con su propia transacción abierta', async () => {
    const held = await serviceHold(TENANT_A);
    const misuse = await request(TENANT_A, () =>
      tenantPrisma.withTenant(async () => rejection(held.client.dev_probe_items.findMany())),
    );
    await held.release();
    expect(misuse).toBeInstanceOf(TenantTransactionOwnershipError);
  });
});

describe('4.4 transacción terminada (casos 5, 6)', () => {
  it('después del COMMIT el cliente retenido se rechaza en el servicio (sin llegar a Prisma)', async () => {
    const held = await serviceHold(TENANT_A);
    expect(await held.release()).toBe('committed');
    expect(await rejection(request(TENANT_A, () => held.client.dev_probe_items.findMany()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
    expect(await rejection(request(TENANT_B, () => held.client.dev_probe_items.findMany()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
  });

  it('después del ROLLBACK, igual', async () => {
    const held = await serviceHold(TENANT_A);
    expect(await held.release(true)).toBeInstanceOf(Error);
    expect(await rejection(request(TENANT_A, () => held.client.$queryRaw`SELECT 1`))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
  });

  it('una consulta lanzada desde la operación pero ejecutada después de terminar el callback se rechaza', async () => {
    let late: Promise<unknown> | undefined;
    await request(TENANT_A, () =>
      tenantPrisma.withTenant(async (tx) => {
        late = sleep(30).then(() => tx.dev_probe_items.findMany());
        return Promise.resolve();
      }),
    );
    expect(await rejection(late!)).toBeInstanceOf(TenantTransactionClosedError);
  });
});

describe('4.5 timeout (caso 7)', () => {
  it('una transacción expirada no admite nuevas consultas con el cliente anterior', async () => {
    const shortPool = new Pool({ connectionString: db.appUrl, max: 2 });
    const service = newService({ pool: shortPool, timeout: 300 });
    try {
      let afterTimeout: unknown;
      const outcome = await rejection(
        request(TENANT_A, () =>
          service.withTenant(async (tx) => {
            await tx.dev_probe_items.create({ data: { label: 'antes-del-timeout' } });
            await sleep(450);
            afterTimeout = await rejection(tx.dev_probe_items.findMany());
            await tx.dev_probe_items.create({ data: { label: 'despues-del-timeout' } });
          }),
        ),
      );
      expect(afterTimeout).toBeInstanceOf(TenantTransactionClosedError);
      expect(outcome).toBeInstanceOf(TenantTransactionClosedError);
      const labels = await labelsOf(TENANT_A, service);
      expect(labels).not.toContain('antes-del-timeout');
      expect(labels).not.toContain('despues-del-timeout');
    } finally {
      await service.onModuleDestroy();
      await shortPool.end();
    }
  });
});

describe('4.6 operaciones asíncronas: consulta diferida (caso 8)', () => {
  it('construida en A y ejecutada desde B: rechazada sin filas (then, catch, finally y Promise.all)', async () => {
    let pending: ReturnType<TenantTransaction['dev_probe_items']['findMany']>[] = [];
    const held = await serviceHold(TENANT_A, (tx) => {
      pending = [0, 1, 2, 3].map(() => tx.dev_probe_items.findMany());
      return Promise.resolve();
    });
    const viaAwait = await request(TENANT_B, () => rejection(Promise.resolve(pending[0])));
    const viaCatch = await request(TENANT_B, () => pending[1]!.catch((e: unknown) => e));
    const viaFinally = await request(TENANT_B, () => rejection(pending[2]!.finally(() => undefined)));
    const viaAll = await request(TENANT_B, () => rejection(Promise.all([pending[3]])));
    await held.release();
    for (const error of [viaAwait, viaCatch, viaFinally, viaAll]) {
      expect(error).toBeInstanceOf(TenantTransactionOwnershipError);
    }
  });

  it('una consulta ya iniciada en A conserva su resultado: no se vuelve a ejecutar en otro contexto', async () => {
    let started: ReturnType<TenantTransaction['dev_probe_items']['count']> | undefined;
    const held = await serviceHold(TENANT_A, async (tx) => {
      started = tx.dev_probe_items.count();
      await started;
    });
    const again = await request(TENANT_B, async () => await started!);
    expect(await held.release()).toBe('committed');
    expect(typeof again).toBe('number');
  });
});

describe('4.7 anidamiento (caso 9)', () => {
  it('withTenant anidado reutiliza la misma transacción y el mismo cliente; una consulta diferida del externo funciona dentro', async () => {
    const out = await request(TENANT_A, () =>
      tenantPrisma.withTenant(async (outer) => {
        const deferred = outer.dev_probe_items.count();
        const outerInfo = await txInfo(outer);
        return tenantPrisma.withTenant(async (inner) => ({
          same: inner === outer && tenantPrisma.transaction() === outer,
          outerInfo,
          innerInfo: await txInfo(inner),
          deferred: await deferred,
        }));
      }),
    );
    expect(out.same).toBe(true);
    expect(out.innerInfo).toEqual(out.outerInfo);
    expect(typeof out.deferred).toBe('number');
  });
});

describe('4.8 fallos: cambio de contexto y excepciones (casos 10, 11, 14)', () => {
  it('cambio de tenant dentro de la operación: TenantContextMismatchError y rollback total', async () => {
    const error = await rejection(
      request(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await tx.dev_probe_items.create({ data: { label: 'antes-de-cambiar-tenant' } });
          await cls.run({ ifNested: 'inherit' }, async () => {
            cls.set(CLS_TENANT_ID, TENANT_B);
            await tx.dev_probe_items.findMany();
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
    expect(await labelsOf(TENANT_A)).not.toContain('antes-de-cambiar-tenant');
  });

  it('cambio de actor dentro de la operación: también se rechaza (no basta con el tenant)', async () => {
    const error = await rejection(
      request(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await cls.run({ ifNested: 'inherit' }, async () => {
            cls.set(CLS_ACTOR_ID, 'dev:otro');
            await tx.dev_probe_items.findMany();
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
  });

  it('una violación captura el error: aunque el callback lo silencie, la transacción se revierte', async () => {
    const outcome = await rejection(
      request(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await tx.dev_probe_items.create({ data: { label: 'silenciada' } });
          await cls.run({ ifNested: 'inherit' }, () => {
            cls.set(CLS_TENANT_ID, TENANT_B);
            return tx.dev_probe_items.findMany().catch(() => []);
          });
          // Tras la violación, ni el propietario puede seguir usando el cliente.
          expect(await rejection(tx.dev_probe_items.count())).toBeInstanceOf(TenantContextMismatchError);
          return 'ok';
        }),
      ),
    );
    expect(outcome).toBeInstanceOf(TenantContextMismatchError);
    expect(await labelsOf(TENANT_A)).not.toContain('silenciada');
  });

  it('excepción de la aplicación dentro de la transacción: rollback y el cliente queda cerrado', async () => {
    let kept: TenantTransaction | undefined;
    const appError = new Error('fallo de aplicación');
    const outcome = await rejection(
      request(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          kept = tx;
          await tx.dev_probe_items.create({ data: { label: 'excepcion-app' } });
          throw appError;
        }),
      ),
    );
    expect(outcome).toBe(appError);
    expect(await labelsOf(TENANT_A)).not.toContain('excepcion-app');
    expect(await rejection(request(TENANT_A, () => kept!.dev_probe_items.count()))).toBeInstanceOf(
      TenantTransactionClosedError,
    );
  });

  it('contexto ausente: el cliente usado fuera de toda solicitud o con el contexto CLS reemplazado se rechaza', async () => {
    const held = await serviceHold(TENANT_A);
    const outside = await rejection(Promise.resolve(held.client.dev_probe_items.findMany()));
    const emptyCls = await rejection(
      cls.run({ ifNested: 'override' }, async () => await held.client.dev_probe_items.findMany()),
    );
    await held.release();
    expect(outside).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(emptyCls).toBeInstanceOf(TenantTransactionOwnershipError);

    const replaced = await rejection(
      request(TENANT_A, () =>
        tenantPrisma.withTenant(async (tx) => {
          await cls.run({ ifNested: 'override' }, async () => await tx.dev_probe_items.findMany());
        }),
      ),
    );
    expect(replaced).toBeInstanceOf(TenantContextMissingError);
  });
});

describe('reutilización de conexiones del pool (caso 12)', () => {
  it('pool de 1: B reutiliza el backend de A, y el cliente retenido de A no se ejecuta en la transacción de B', async () => {
    const singlePool = new Pool({ connectionString: db.appUrl, max: 1 });
    const service = newService({ pool: singlePool });
    try {
      let leaked: TenantTransaction | undefined;
      const infoA = await request(TENANT_A, () =>
        service.withTenant(async (tx) => {
          leaked = tx;
          return txInfo(tx);
        }),
      );
      const inB = await request(TENANT_B, () =>
        service.withTenant(async (tx) => ({
          info: await txInfo(tx),
          misuse: await rejection(leaked!.dev_probe_items.create({ data: { label: 'fantasma-A' } })),
          own: tenantsOf(await tx.dev_probe_items.findMany()),
        })),
      );
      expect(inB.info.pid).toBe(infoA.pid);
      expect(inB.info.xid).not.toBe(infoA.xid);
      expect(inB.info.tenant).toBe(TENANT_B);
      expect(inB.misuse).toBeInstanceOf(TenantTransactionClosedError);
      expect(inB.own).toEqual([TENANT_B]);
      expect(await labelsOf(TENANT_A, service)).not.toContain('fantasma-A');
      expect(await labelsOf(TENANT_B, service)).not.toContain('fantasma-A');
    } finally {
      await service.onModuleDestroy();
      await singlePool.end();
    }
  });
});

describe('concurrencia entre solicitudes (caso 13)', () => {
  it('60 solicitudes intercaladas: las legítimas no ven filas cruzadas; todo uso del cliente retenido se rechaza', async () => {
    const held = await serviceHold(TENANT_A, (tx) => tx.dev_probe_items.create({ data: { label: 'retenida-conc' } }));
    const ops = Array.from({ length: 60 }, (_, i) => ({
      i,
      tenant: i % 2 === 0 ? TENANT_A : TENANT_B,
      misuse: i % 3 === 0,
    }));
    const results = await Promise.all(
      ops.map((op) =>
        request(op.tenant, async () => {
          await sleep(op.i % 7);
          if (op.misuse) return { op, error: await rejection(held.client.dev_probe_items.findMany()) };
          return tenantPrisma.withTenant(async (tx) => {
            await tx.dev_probe_items.create({ data: { label: `conc-r3-${op.i}` } });
            await sleep(op.i % 5);
            const rows = await tx.dev_probe_items.findMany();
            return { op, cross: rows.filter((r) => r.tenant_id !== op.tenant).length };
          });
        }),
      ),
    );
    const outcome = await held.release();
    const misuses = results.filter((r) => 'error' in r);
    const legit = results.filter((r) => 'cross' in r);
    expect(misuses).toHaveLength(20);
    expect(misuses.every((r) => r.error instanceof TenantTransactionOwnershipError)).toBe(true);
    expect(legit).toHaveLength(40);
    expect(legit.reduce((sum, r) => sum + r.cross, 0)).toBe(0);
    expect(outcome).toBeInstanceOf(TenantTransactionOwnershipError);
    expect(await labelsOf(TENANT_A)).not.toContain('retenida-conc');
  }, 60_000);
});

describe('4.9 encapsulación (caso 15)', () => {
  it('el cliente protegido solo expone la lista blanca: sin prototipo, congelado, sin $transaction ni internos', async () => {
    const shape = await request(TENANT_A, () =>
      tenantPrisma.withTenant((tx) => {
        const client = tx as unknown as Record<string | symbol, unknown>;
        const delegate = tx.dev_probe_items as unknown as Record<string, unknown>;
        return Promise.resolve({
          keys: Object.keys(client).sort(),
          symbols: Object.getOwnPropertySymbols(client).length,
          proto: Object.getPrototypeOf(client) as unknown,
          frozen: Object.isFrozen(client) && Object.isFrozen(delegate),
          forbidden: [
            '$transaction',
            '$queryRawUnsafe',
            '$executeRawUnsafe',
            '$queryRawTyped',
            '$connect',
            '$disconnect',
            '$extends',
            '_engine',
            '_originalClient',
            '_requestHandler',
            'constructor',
          ].filter((k) => client[k] !== undefined),
          delegateKeys: Object.keys(delegate).sort(),
          delegateProto: Object.getPrototypeOf(delegate) as unknown,
        });
      }),
    );
    expect(shape.keys).toEqual(['$executeRaw', '$queryRaw', 'audit_events', 'dev_probe_items', 'idempotency_keys']);
    expect(shape.symbols).toBe(0);
    expect(shape.proto).toBeNull();
    expect(shape.frozen).toBe(true);
    expect(shape.forbidden).toEqual([]);
    expect(shape.delegateKeys).toEqual([...MODEL_OPERATIONS].sort());
    expect(shape.delegateProto).toBeNull();
  });

  it('el servicio no expone el PrismaClient base ni el pool (campos privados de ECMAScript)', () => {
    const service = tenantPrisma as unknown as Record<string, unknown>;
    expect(service['prisma']).toBeUndefined();
    expect(service['pool']).toBeUndefined();
    expect(service['cls']).toBeUndefined();
    expect(Object.keys(service)).toEqual([]);
  });

  it('cada operación de la lista blanca existe en el delegado real de Prisma 7.10.1', async () => {
    const missing = await rawWithTenant(TENANT_A, (tx) =>
      Promise.resolve(
        MODEL_OPERATIONS.filter(
          (op) => typeof (tx.dev_probe_items as unknown as Record<string, unknown>)[op] !== 'function',
        ),
      ),
    );
    expect(missing).toEqual([]);
  });
});
