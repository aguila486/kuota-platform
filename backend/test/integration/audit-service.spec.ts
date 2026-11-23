import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditRecordError, AuditService, CLS_AUDIT_ORIGIN } from '../../src/common/audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../../src/common/config/app-config.js';
import { ConfigModule } from '../../src/common/config/config.module.js';
import { loadConfig } from '../../src/common/config/load-config.js';
import { CLS_ACTOR_ID, CLS_CORRELATION_ID } from '../../src/common/logging/logger-options.js';
import { establishTenantContext } from '../../src/common/tenant-context/establish-context.js';
import { TenantContext } from '../../src/common/tenant-context/tenant-context.js';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module.js';
import {
  TenantContextMismatchError,
  TenantPrismaService,
  type TenantTransaction,
  TenantTransactionClosedError,
  TenantTransactionRequiredError,
} from '../../src/common/tenant-context/tenant-prisma.service.js';
import { DevProbeService } from '../../src/modules/dev-probe/application/dev-probe.service.js';
import { PrismaDevProbeRepository } from '../../src/modules/dev-probe/infrastructure/prisma-dev-probe.repository.js';
import { validEnv } from '../support/env.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { rejection } from '../support/tenant-data.js';

/**
 * T077 y T078 (FR-025; R-07; R3) a nivel de servicio, sobre PostgreSQL 18: `AuditService` y el DELETE de
 * `DevProbeService` con su propio `TestingModule` y `ClsModule.forRoot`, sin aplicación HTTP.
 *
 * Archivo separado de `audit.spec.ts` (2026-11-23) por aislamiento: en nestjs-cls 7, `ClsPluginsHooksHost` es una
 * instancia única por proceso. Cada módulo nuevo la sustituye y, al cerrarse, la libera. Si estos módulos compartieran
 * proceso con la aplicación HTTP de `audit.spec.ts`, cerrarlos dejaría el middleware CLS de esa aplicación sin host y
 * respondería 500 en toda ruta. Vitest aísla cada archivo, así que las pruebas no dependen del orden.
 */
let db: TestDatabase;
let admin: Client;

type Json = Record<string, unknown>;
async function events(where: string, params: unknown[]): Promise<Json[]> {
  const { rows } = await admin.query<Json>(
    `SELECT id, tenant_id, actor_id, actor_type, actor_role, action, entity_type, entity_id, changes, occurred_at,
            device_time, origin, correlation_id, idempotency_key, xmin::text AS xmin
       FROM kuota.audit_events WHERE ${where} ORDER BY id`,
    params,
  );
  return rows;
}
const countAll = async (table: string, tenant: string) =>
  Number(
    (await admin.query<{ n: string }>(`SELECT count(*) AS n FROM kuota.${table} WHERE tenant_id = $1`, [tenant]))
      .rows[0]!.n,
  );

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await db?.stop();
});

describe('AuditService a nivel de servicio (T077)', () => {
  let moduleRef: TestingModule;
  let pool: Pool;
  let cls: ClsService;
  let tenantPrisma: TenantPrismaService;
  let audit: AuditService;
  const event = {
    action: 'dev_probe.created',
    entityType: 'dev_probe',
    entityId: 'x',
    changes: { label: 'x' },
  } as const;

  beforeAll(async () => {
    pool = new Pool({ connectionString: db.appUrl, max: 2 });
    const config = loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, LOG_LEVEL: 'silent' }));
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
    tenantPrisma = moduleRef.get(TenantPrismaService);
    audit = new AuditService(tenantPrisma, moduleRef.get(TenantContext), cls);
  });
  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
  });

  function operation<T>(
    tenant: string,
    actor: string | null,
    fn: () => Promise<T>,
    origin: string | null = 'http',
  ): Promise<T> {
    return cls.run(() => {
      establishTenantContext(cls, { tenantId: tenant, actorId: actor, actorType: 'DEV' });
      cls.set(CLS_CORRELATION_ID, randomUUID());
      if (origin) cls.set(CLS_AUDIT_ORIGIN, origin);
      return fn();
    });
  }

  it('fuera de withTenant falla (no hay transacción) y no escribe', async () => {
    const tenant = randomUUID();
    expect(await rejection(operation(tenant, 'dev:svc', () => audit.record(event)))).toBeInstanceOf(
      TenantTransactionRequiredError,
    );
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('sin actor, sin origen, acción o campos no permitidos → error antes de llegar a PostgreSQL', async () => {
    const tenant = randomUUID();
    const inTx = (actor: string | null, e: unknown, origin: string | null = 'http') =>
      rejection(operation(tenant, actor, () => tenantPrisma.withTenant(() => audit.record(e as typeof event)), origin));
    expect((await inTx(null, event)) as Error).toMatchObject({ name: 'AuditActorRequiredError' });
    expect(await inTx('dev:svc', event, null)).toBeInstanceOf(AuditRecordError);
    // Solo orígenes lógicos de AUDIT_ORIGINS: un valor de red o derivado de él nunca llega a PostgreSQL.
    for (const origin of [
      '203.0.113.7',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      `ip-hash:${'a'.repeat(64)}`,
      `ip-hmac:v1:${'b'.repeat(64)}`,
      'HTTP',
      'http ',
      'job',
    ]) {
      const error = await inTx('dev:svc', event, origin);
      expect(error, origin).toBeInstanceOf(AuditRecordError);
      expect((error as Error).message, origin).not.toContain(origin.trim() || origin);
    }
    expect(await inTx('dev:svc', { ...event, action: 'dev_probe.inventado' })).toBeInstanceOf(AuditRecordError);
    expect(await inTx('dev:svc', { ...event, changes: { label: 'x', password: 'secreto' } })).toBeInstanceOf(
      AuditRecordError,
    );
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('anidado: el evento usa la transacción externa y se revierte con ella', async () => {
    const tenant = randomUUID();
    const failure = new Error('fallo posterior');
    const error = await rejection(
      operation(tenant, 'dev:svc', () =>
        tenantPrisma.withTenant(async () => {
          await tenantPrisma.withTenant(() => audit.record(event));
          throw failure;
        }),
      ),
    );
    expect(error).toBe(failure);
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('cambiar el actor durante la transacción → TenantContextMismatchError y rollback (R3)', async () => {
    const tenant = randomUUID();
    const error = await rejection(
      operation(tenant, 'dev:svc', () =>
        tenantPrisma.withTenant(async () => {
          await audit.record(event);
          await cls.run({ ifNested: 'inherit' }, async () => {
            cls.set(CLS_ACTOR_ID, 'dev:suplantado');
            await audit.record(event);
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
    expect(await countAll('audit_events', tenant)).toBe(0);
  });

  it('commit correcto: el evento persiste con el actor de la operación', async () => {
    const tenant = randomUUID();
    await operation(tenant, 'dev:svc', () => tenantPrisma.withTenant(() => audit.record(event)));
    expect((await events('tenant_id = $1', [tenant]))[0]).toMatchObject({
      actor_id: 'dev:svc',
      origin: 'http',
    });
  });
});

describe('DELETE a nivel de servicio: actor cambiado y cliente retenido (T078, R3)', () => {
  let moduleRef: TestingModule;
  let pool: Pool;
  let cls: ClsService;
  let tenantPrisma: TenantPrismaService;
  let service: DevProbeService;
  let repo: PrismaDevProbeRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: db.appUrl, max: 2 });
    const config = loadConfig(validEnv({ DATABASE_URL_APP: db.appUrl, LOG_LEVEL: 'silent' }));
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
    tenantPrisma = moduleRef.get(TenantPrismaService);
    repo = new PrismaDevProbeRepository(tenantPrisma);
    service = new DevProbeService(
      repo,
      tenantPrisma,
      new AuditService(tenantPrisma, moduleRef.get(TenantContext), cls),
    );
  });
  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
  });

  const operation = <T>(tenant: string, fn: () => Promise<T>) =>
    cls.run(() => {
      establishTenantContext(cls, { tenantId: tenant, actorId: 'dev:svc', actorType: 'DEV' });
      cls.set(CLS_CORRELATION_ID, randomUUID());
      cls.set(CLS_AUDIT_ORIGIN, 'http');
      return fn();
    });
  const rowExists = async (id: string) =>
    (await admin.query('SELECT 1 FROM kuota.dev_probe_items WHERE id = $1', [id])).rowCount === 1;

  it('cambiar el actor durante la transacción del DELETE → TenantContextMismatchError; el borrado se revierte', async () => {
    const tenant = randomUUID();
    const item = await operation(tenant, () => service.createDevProbeItem('actor-cambiado', null));
    const error = await rejection(
      operation(tenant, () =>
        tenantPrisma.withTenant(async () => {
          await cls.run({ ifNested: 'inherit' }, async () => {
            cls.set(CLS_ACTOR_ID, 'dev:suplantado');
            await service.deleteDevProbeItem(item.id);
          });
        }),
      ),
    );
    expect(error).toBeInstanceOf(TenantContextMismatchError);
    expect(await rowExists(item.id)).toBe(true);
    expect((await events('entity_id = $1', [item.id])).map((e) => e['action'])).toEqual(['dev_probe.created']);
  });

  it('el cliente que usó el DELETE, retenido, no sirve después: rechazado sin borrar nada', async () => {
    const tenant = randomUUID();
    const [keep, victim] = await operation(tenant, async () => [
      await service.createDevProbeItem('se-queda', null),
      await service.createDevProbeItem('victima', null),
    ]);
    let retained: TenantTransaction | undefined;
    await operation(tenant, () =>
      tenantPrisma.withTenant(async (tx) => {
        retained = tx;
        await service.deleteDevProbeItem(victim.id);
      }),
    );
    const misuse = await rejection(operation(tenant, () => retained!.dev_probe_items.deleteMany({})));
    expect(misuse).toBeInstanceOf(TenantTransactionClosedError);
    expect(await rowExists(keep.id)).toBe(true);
    expect(await rowExists(victim.id)).toBe(false);
  });

  it('DELETE concurrente (P2025): si otra transacción borró la fila tras la comprobación, responde no-encontrado sin evento', async () => {
    const tenant = randomUUID();
    const item = await operation(tenant, () => service.createDevProbeItem('carrera-p2025', null));
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => operation(tenant, () => service.deleteDevProbeItem(item.id))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(r.reason).toMatchObject({ code: 'not-found' });
    }
    expect((await events('entity_id = $1', [item.id])).filter((e) => e['action'] === 'dev_probe.deleted')).toHaveLength(
      1,
    );
  });
});
