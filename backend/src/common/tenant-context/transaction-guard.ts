import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Cliente transaccional protegido (hardening de T039 frente al riesgo R3 de P2).
 *
 * Es un objeto construido explícitamente con una LISTA BLANCA de capacidades, no un `Proxy` sobre el cliente de Prisma:
 * solo existen los delegados de los modelos (con las operaciones de `MODEL_OPERATIONS`), `$queryRaw` y `$executeRaw`
 * con plantilla etiquetada. No hay `$transaction`, SQL dinámico, `$queryRawTyped` ni propiedades internas de Prisma;
 * los objetos no tienen prototipo, están congelados y no contienen referencias al cliente original (solo los cierres).
 *
 * Las operaciones de Prisma 7 son diferidas: no se ejecutan hasta `then`/`await`. Por eso la comprobación de propiedad
 * (`assertUsable`) se ejecuta al INICIAR la ejecución (primer `then`, `catch` o `finally`), en el contexto asíncrono de
 * quien la espera, y no al invocar el método. Si falla, Prisma ni siquiera recibe la llamada.
 */
export const MODEL_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

type ModelKey = Uncapitalize<Prisma.ModelName>;

/**
 * Cliente que reciben los repositorios: delegados de modelo y `$queryRaw`/`$executeRaw` parametrizados. No incluye SQL
 * dinámico (`$queryRawUnsafe`, `$executeRawUnsafe`), `$transaction` (abrir otra transacción escaparía de esta) ni el
 * resto de miembros del cliente de Prisma. La API fluida de relaciones no está disponible (en 001 no hay relaciones);
 * si un módulo la necesitara, se amplía este archivo con revisión.
 */
export type TenantTransaction = Readonly<Pick<Prisma.TransactionClient, ModelKey | '$queryRaw' | '$executeRaw'>>;

type Execute = () => PromiseLike<unknown>;

/** Consulta diferida: comprueba la propiedad al iniciar la ejecución y solo entonces llama a Prisma (una única vez). */
class GuardedQuery<T> implements PromiseLike<T> {
  #started: Promise<T> | undefined;

  constructor(
    private readonly assertUsable: () => void,
    private readonly execute: Execute,
  ) {}

  get [Symbol.toStringTag](): string {
    return 'PrismaPromise';
  }

  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.start().then(onFulfilled, onRejected);
  }

  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T | R> {
    return this.start().catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<T> {
    return this.start().finally(onFinally);
  }

  private start(): Promise<T> {
    if (this.#started === undefined) {
      try {
        this.assertUsable();
        const pending = this.execute();
        this.#started = new Promise<T>((resolve, reject) => {
          pending.then((value) => resolve(value as T), reject);
        });
      } catch (error) {
        this.#started = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return this.#started;
  }
}

type Method = (...args: unknown[]) => PromiseLike<unknown>;
const method = (target: unknown, name: string): Method => {
  const fn = (target as Record<string, unknown>)[name];
  if (typeof fn !== 'function') throw new TypeError(`Operación no disponible en el cliente transaccional: ${name}`);
  return (fn as Method).bind(target);
};

function guardDelegate(raw: Prisma.TransactionClient, model: string, assertUsable: () => void): object {
  const delegate = Object.create(null) as Record<string, unknown>;
  for (const operation of MODEL_OPERATIONS) {
    delegate[operation] = (...args: unknown[]) =>
      new GuardedQuery(assertUsable, () =>
        method((raw as unknown as Record<string, unknown>)[model], operation)(...args),
      );
  }
  return Object.freeze(delegate);
}

/** Propiedad del cliente en Prisma para un modelo: el nombre con la primera letra en minúscula. */
export const modelKey = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Construye el cliente protegido sobre el cliente transaccional crudo. `assertUsable` lanza si la operación actual no
 * puede usar esta transacción; se invoca antes de cada ejecución.
 */
export function guardTransaction(
  raw: Prisma.TransactionClient,
  models: readonly string[],
  assertUsable: () => void,
): TenantTransaction {
  const client = Object.create(null) as Record<string, unknown>;
  for (const model of models) {
    const key = modelKey(model);
    let delegate: object | undefined;
    Object.defineProperty(client, key, {
      enumerable: true,
      get: () => (delegate ??= guardDelegate(raw, key, assertUsable)),
    });
  }
  client['$queryRaw'] = (...args: unknown[]) => new GuardedQuery(assertUsable, () => method(raw, '$queryRaw')(...args));
  client['$executeRaw'] = (...args: unknown[]) =>
    new GuardedQuery(assertUsable, () => method(raw, '$executeRaw')(...args));
  return Object.freeze(client) as unknown as TenantTransaction;
}
