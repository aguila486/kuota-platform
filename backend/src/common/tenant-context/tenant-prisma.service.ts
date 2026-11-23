import { Inject, Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaClient, type Prisma } from '../../generated/prisma/client.js';
import { TenantContext } from './tenant-context.js';

/**
 * Cliente transaccional que reciben los repositorios: solo consultas de modelo y `$queryRaw`/`$executeRaw`
 * parametrizados. Se quitan del tipo el SQL dinámico (`$queryRawUnsafe`, `$executeRawUnsafe`) y `$transaction` (Prisma
 * lo deja en el cliente transaccional; abrir otra transacción escaparía de esta). Prisma ya quita `$connect`,
 * `$disconnect`, `$on`, `$use` y `$extends`.
 */
export type TenantTransaction = Omit<
  Prisma.TransactionClient,
  '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'
>;

export interface TenantPrismaOptions {
  /** Pool propio (pruebas). Por defecto se crea uno con `DATABASE_URL_APP` (kuota_app_login). */
  readonly pool?: Pool;
  /** Espera máxima para obtener conexión (ms). */
  readonly maxWait?: number;
  /** Duración máxima de la transacción (ms). */
  readonly timeout?: number;
}
export const TENANT_PRISMA_OPTIONS = Symbol('TENANT_PRISMA_OPTIONS');

const DEFAULT_MAX_WAIT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** `withTenant` anidado con un tenant distinto del de la transacción activa (ADR-0002, C2-1). */
export class TenantContextMismatchError extends Error {
  constructor() {
    super('withTenant anidado con otro tenant: se revierte toda la transacción');
    this.name = 'TenantContextMismatchError';
  }
}

/** Se pidió el cliente transaccional fuera de `withTenant`. */
export class TenantTransactionRequiredError extends Error {
  constructor() {
    super('Acceso a datos de tenant fuera de withTenant');
    this.name = 'TenantTransactionRequiredError';
  }
}

/** `app.tenant_id` cambió dentro de la transacción (p. ej. un set_config crudo): se revierte antes del COMMIT. */
export class TenantContextTamperedError extends Error {
  constructor() {
    super('app.tenant_id cambió dentro de la transacción: se revierte');
    this.name = 'TenantContextTamperedError';
  }
}

interface ActiveTransaction {
  readonly tx: TenantTransaction;
  readonly tenantId: string;
}
/** Clave CLS privada (símbolo no exportado): nadie fuera de este archivo puede fijar ni sustituir la transacción. */
const ACTIVE_TX = Symbol('kuota.tenantTransaction');

/**
 * Único acceso a datos de tenant (T039; ADR-0004 C4-2; ADR-0002 C2-1; patrón validado en el spike T014, S1–S5).
 *
 * `withTenant(fn)`:
 * 1. Lee el tenant del `TenantContext` (nunca de un argumento): sin contexto → `TenantContextMissingError`, sin tocar
 *    la base.
 * 2. Sin transacción activa: abre una `$transaction` interactiva (una sola conexión del pool) y su PRIMERA sentencia es
 *    `set_config('app.tenant_id'|'app.actor_id'|'app.correlation_id', …, true)` (local a la transacción: desaparece en
 *    COMMIT o ROLLBACK y la conexión vuelve limpia al pool).
 * 3. Con transacción activa del mismo tenant: reutiliza esa transacción (sin BEGIN ni savepoint). De otro tenant:
 *    `TenantContextMismatchError`, que se propaga y revierte toda la transacción.
 * 4. Antes del COMMIT verifica que `app.tenant_id` sigue siendo el del contexto; si no → rollback.
 * Cualquier excepción del callback o de la base revierte la transacción completa.
 *
 * El `PrismaClient` base es privado: no se expone ni se exporta.
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  private readonly logger = new Logger('TenantPrisma');
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly prisma: PrismaClient;
  private readonly txOptions: { maxWait: number; timeout: number };

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly context: TenantContext,
    private readonly cls: ClsService,
    @Optional() @Inject(TENANT_PRISMA_OPTIONS) options: TenantPrismaOptions = {},
  ) {
    this.ownsPool = options.pool === undefined;
    this.pool =
      options.pool ??
      new Pool({
        connectionString: config.database.appUrl,
        connectionTimeoutMillis: 5_000,
        application_name: 'kuota-core',
      });
    // Un error de una conexión inactiva no debe terminar el proceso; la próxima transacción informará el fallo.
    this.pool.on('error', (err) => this.logger.warn({ err }, 'Conexión inactiva de PostgreSQL con error'));
    this.txOptions = {
      maxWait: options.maxWait ?? DEFAULT_MAX_WAIT_MS,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    };
    this.prisma = new PrismaClient({ adapter: new PrismaPg(this.pool), transactionOptions: this.txOptions });
  }

  async withTenant<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const context = this.context.require();
    const active = this.activeTransaction();
    if (active) {
      if (active.tenantId !== context.tenantId) throw new TenantContextMismatchError();
      return fn(active.tx);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true),
                                set_config('app.actor_id', ${context.actorId ?? ''}, true),
                                set_config('app.correlation_id', ${context.correlationId ?? ''}, true)`;
      const store: ActiveTransaction = { tx, tenantId: context.tenantId };
      // Contexto CLS hijo: la transacción solo es visible dentro de esta cadena asíncrona y desaparece al terminar.
      const result = await this.cls.run({ ifNested: 'inherit' }, () => {
        this.cls.set(ACTIVE_TX, store);
        return fn(tx);
      });
      const [check] = await tx.$queryRaw<Array<{ tenant: string | null }>>`
        SELECT current_setting('app.tenant_id', true) AS tenant`;
      if (check?.tenant !== context.tenantId) throw new TenantContextTamperedError();
      return result;
    }, this.txOptions);
  }

  /** Cliente de la transacción activa del tenant actual, para repositorios. Fuera de `withTenant` lanza un error. */
  transaction(): TenantTransaction {
    const active = this.activeTransaction();
    if (!active) throw new TenantTransactionRequiredError();
    if (active.tenantId !== this.context.require().tenantId) throw new TenantContextMismatchError();
    return active.tx;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
    if (this.ownsPool) await this.pool.end();
  }

  private activeTransaction(): ActiveTransaction | undefined {
    return this.cls.isActive() ? this.cls.get<ActiveTransaction | undefined>(ACTIVE_TX) : undefined;
  }
}
