import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { TenantContext, TenantContextMissingError, type TenantContextValue } from './tenant-context.js';
import { guardTransaction, type TenantTransaction } from './transaction-guard.js';

export type { TenantTransaction } from './transaction-guard.js';

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

/** Cliente transaccional usado después de terminar su transacción (COMMIT, ROLLBACK o timeout). R3. */
export class TenantTransactionClosedError extends Error {
  constructor() {
    super('Cliente transaccional usado después de terminar su transacción');
    this.name = 'TenantTransactionClosedError';
  }
}

/** Cliente transaccional usado fuera de la operación `withTenant` que lo creó (otra solicitud u operación). R3. */
export class TenantTransactionOwnershipError extends Error {
  constructor() {
    super('Cliente transaccional usado fuera de la operación que abrió su transacción');
    this.name = 'TenantTransactionOwnershipError';
  }
}

type Owner = Pick<TenantContextValue, 'tenantId' | 'actorId' | 'actorType'>;

/**
 * Vínculo entre UNA transacción y la operación que la abrió. Es la identidad de propiedad: solo existe en el cierre de
 * `withTenant` y en el `AsyncLocalStorage` privado de la instancia del servicio; la aplicación no puede leerlo,
 * fabricarlo ni sustituirlo.
 */
class TransactionBinding {
  closed = false;
  violation: Error | undefined;
  client!: TenantTransaction;

  constructor(
    readonly owner: Owner,
    readonly deadline: number,
  ) {}
}

const MODELS: readonly string[] = Object.values(Prisma.ModelName);

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
 * Propiedad del cliente transaccional (R3 de P2): el callback recibe un cliente protegido (`transaction-guard.ts`)
 * vinculado a esta transacción. Antes de CADA ejecución se comprueba, en memoria y sin consultas adicionales, que:
 * - la transacción sigue abierta y no superó su timeout (si no → `TenantTransactionClosedError`);
 * - quien ejecuta está dentro de la cadena asíncrona de ESTE `withTenant` (`AsyncLocalStorage` privado de la
 *   instancia; si no, aunque sea el mismo tenant → `TenantTransactionOwnershipError`);
 * - el tenant, el actor y el tipo de actor del `TenantContext` actual son los de la apertura (si no →
 *   `TenantContextMismatchError`).
 * Una violación no ejecuta la consulta, marca la transacción como comprometida y hace que su `withTenant` termine con
 * ese error: rollback total. Esto no cubre SQL arbitrario que cambie `app.tenant_id` (R1/R2) ni la credencial (R6).
 *
 * El `PrismaClient` base y el pool son campos privados de ECMAScript (`#`): no son accesibles desde fuera.
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  readonly #logger = new Logger('TenantPrisma');
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #prisma: PrismaClient;
  readonly #txOptions: { maxWait: number; timeout: number };
  readonly #context: TenantContext;
  /** Transacción de la operación actual. Privado: nadie fuera de esta instancia puede entrar en él ni sustituirlo. */
  readonly #active = new AsyncLocalStorage<TransactionBinding>();

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    context: TenantContext,
    @Optional() @Inject(TENANT_PRISMA_OPTIONS) options: TenantPrismaOptions = {},
  ) {
    this.#context = context;
    this.#ownsPool = options.pool === undefined;
    this.#pool =
      options.pool ??
      new Pool({
        connectionString: config.database.appUrl,
        connectionTimeoutMillis: 5_000,
        application_name: 'kuota-core',
      });
    // Un error de una conexión inactiva no debe terminar el proceso; la próxima transacción informará el fallo.
    this.#pool.on('error', (err) => this.#logger.warn({ err }, 'Conexión inactiva de PostgreSQL con error'));
    this.#txOptions = {
      maxWait: options.maxWait ?? DEFAULT_MAX_WAIT_MS,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    };
    this.#prisma = new PrismaClient({ adapter: new PrismaPg(this.#pool), transactionOptions: this.#txOptions });
  }

  async withTenant<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const context = this.#context.require();
    const active = this.#active.getStore();
    if (active) {
      this.#assertUsable(active);
      return await fn(active.client);
    }

    return this.#prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true),
                                set_config('app.actor_id', ${context.actorId ?? ''}, true),
                                set_config('app.correlation_id', ${context.correlationId ?? ''}, true)`;
      const binding = new TransactionBinding(
        { tenantId: context.tenantId, actorId: context.actorId, actorType: context.actorType },
        performance.now() + this.#txOptions.timeout,
      );
      binding.client = guardTransaction(tx, MODELS, () => this.#assertUsable(binding));
      try {
        // `await` DENTRO del ámbito: si el callback devuelve una consulta diferida sin esperarla
        // (`withTenant((tx) => tx.m.create(…))`), Prisma la ejecuta al resolverla, y eso debe ocurrir como propietario.
        const result = await this.#active.run(binding, async () => await fn(binding.client));
        if (binding.violation) throw binding.violation;
        const [check] = await tx.$queryRaw<Array<{ tenant: string | null }>>`
          SELECT current_setting('app.tenant_id', true) AS tenant`;
        if (check?.tenant !== context.tenantId) throw new TenantContextTamperedError();
        return result;
      } finally {
        // Desde aquí cualquier uso del cliente (retenido, diferido o de un temporizador) se rechaza.
        binding.closed = true;
      }
    }, this.#txOptions);
  }

  /** Cliente de la transacción activa de la operación actual, para repositorios. Fuera de `withTenant` lanza un error. */
  transaction(): TenantTransaction {
    const active = this.#active.getStore();
    if (!active) throw new TenantTransactionRequiredError();
    this.#assertUsable(active);
    return active.client;
  }

  /**
   * Estado del pool para las métricas técnicas (T094; FR-039): solo contadores, sin datos de conexión. El pool sigue
   * siendo privado; esto no da acceso a conexiones ni cambia `withTenant`.
   */
  poolStats(): { total: number; idle: number; waiting: number } {
    return { total: this.#pool.totalCount, idle: this.#pool.idleCount, waiting: this.#pool.waitingCount };
  }

  async onModuleDestroy(): Promise<void> {
    await this.#prisma.$disconnect();
    if (this.#ownsPool) await this.#pool.end();
  }

  /** Comprobación en memoria antes de cada ejecución (R3). Fail-closed: una violación compromete la transacción. */
  #assertUsable(binding: TransactionBinding): void {
    if (binding.closed) throw new TenantTransactionClosedError();
    if (binding.violation) throw binding.violation;
    if (performance.now() >= binding.deadline) {
      binding.closed = true;
      throw new TenantTransactionClosedError();
    }
    if (this.#active.getStore() !== binding) throw (binding.violation = new TenantTransactionOwnershipError());
    const current = this.#context.current();
    if (!current) throw (binding.violation = new TenantContextMissingError());
    const { owner } = binding;
    if (
      current.tenantId !== owner.tenantId ||
      current.actorId !== owner.actorId ||
      current.actorType !== owner.actorType
    ) {
      throw (binding.violation = new TenantContextMismatchError());
    }
  }
}
