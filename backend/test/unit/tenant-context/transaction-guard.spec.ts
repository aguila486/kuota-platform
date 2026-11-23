import { describe, expect, it } from 'vitest';
import type { Prisma } from '../../../src/generated/prisma/client.js';
import { guardTransaction, MODEL_OPERATIONS, modelKey } from '../../../src/common/tenant-context/transaction-guard.js';

/**
 * Semántica del cliente protegido sin base de datos (R3): la comprobación ocurre al INICIAR la ejecución, Prisma no
 * recibe la llamada si falla, la ejecución es única y solo existen las capacidades de la lista blanca.
 */
function fakeRaw() {
  const calls: string[] = [];
  const delegate = Object.fromEntries(
    [...MODEL_OPERATIONS, 'fields'].map((op) => [
      op,
      (...args: unknown[]) => {
        calls.push(op);
        return Promise.resolve({ op, args });
      },
    ]),
  );
  const raw = {
    widget: delegate,
    $queryRaw: (...args: unknown[]) => {
      calls.push('$queryRaw');
      return Promise.resolve(args.length);
    },
    $executeRaw: () => {
      calls.push('$executeRaw');
      return Promise.resolve(1);
    },
    $queryRawUnsafe: () => Promise.resolve('NO'),
    $transaction: () => Promise.resolve('NO'),
    _engine: {},
  };
  return { raw: raw as unknown as Prisma.TransactionClient, calls };
}

type Loose = Record<string, Record<string, (...a: unknown[]) => PromiseLike<unknown>>> &
  Record<string, (...a: unknown[]) => PromiseLike<unknown>>;

describe('guardTransaction', () => {
  it('es diferido: crear la consulta no comprueba ni llama a Prisma; la primera espera sí', async () => {
    const { raw, calls } = fakeRaw();
    let checks = 0;
    const tx = guardTransaction(raw, ['Widget'], () => void checks++) as unknown as Loose;
    const query = tx['widget']!['findMany']!({ where: {} });
    expect(checks).toBe(0);
    expect(calls).toEqual([]);
    expect(await query).toEqual({ op: 'findMany', args: [{ where: {} }] });
    expect(checks).toBe(1);
    expect(calls).toEqual(['findMany']);
  });

  it('si la comprobación falla, Prisma no recibe la llamada y then/catch/finally rechazan con ese error', async () => {
    const { raw, calls } = fakeRaw();
    const denied = new Error('denegado');
    const tx = guardTransaction(raw, ['Widget'], () => {
      throw denied;
    }) as unknown as Loose;
    const q = tx['widget']!['create']!({ data: {} }) as Promise<unknown>;
    await expect(Promise.resolve(q)).rejects.toBe(denied);
    expect(await q.catch((e: unknown) => e)).toBe(denied);
    await expect(q.finally(() => undefined)).rejects.toBe(denied);
    await expect(Promise.resolve(tx['$executeRaw']!())).rejects.toBe(denied);
    expect(calls).toEqual([]);
  });

  it('un valor lanzado que no es Error se envuelve en Error', async () => {
    const { raw } = fakeRaw();
    const tx = guardTransaction(raw, [], () => {
      throw 'texto' as unknown as Error;
    }) as unknown as Loose;
    await expect(Promise.resolve(tx['$queryRaw']!())).rejects.toThrow('texto');
  });

  it('ejecuta una sola vez y comprueba una sola vez aunque se espere varias veces', async () => {
    const { raw, calls } = fakeRaw();
    let checks = 0;
    const tx = guardTransaction(raw, ['Widget'], () => void checks++) as unknown as Loose;
    const q = tx['$queryRaw']!(['SELECT ', ''], 1);
    expect(Object.prototype.toString.call(q)).toBe('[object PrismaPromise]');
    expect([await q, await q]).toEqual([2, 2]);
    expect(checks).toBe(1);
    expect(calls).toEqual(['$queryRaw']);
  });

  it('solo expone la lista blanca: los métodos crudos peligrosos y los internos no existen', () => {
    const { raw } = fakeRaw();
    const tx = guardTransaction(raw, ['Widget'], () => undefined) as unknown as Record<string, unknown>;
    expect(Object.keys(tx).sort()).toEqual(['$executeRaw', '$queryRaw', 'widget']);
    for (const key of ['$queryRawUnsafe', '$transaction', '_engine', 'constructor', 'then']) {
      expect(tx[key]).toBeUndefined();
    }
    const delegate = tx['widget'] as Record<string, unknown>;
    expect(delegate['fields']).toBeUndefined();
    expect(Object.keys(delegate)).toEqual([...MODEL_OPERATIONS]);
    expect(tx['widget']).toBe(delegate);
    expect(Object.isFrozen(tx)).toBe(true);
    expect(() => Object.defineProperty(tx, '$transaction', { value: 1 })).toThrow(TypeError);
  });

  it('una operación de la lista blanca ausente en el delegado real falla cerrada (TypeError), sin ejecutar nada', async () => {
    const raw = { widget: {} } as unknown as Prisma.TransactionClient;
    const tx = guardTransaction(raw, ['Widget'], () => undefined) as unknown as Loose;
    await expect(Promise.resolve(tx['widget']!['count']!())).rejects.toThrow(TypeError);
  });

  it('modelKey sigue la convención de Prisma (primera letra en minúscula)', () => {
    expect(modelKey('dev_probe_items')).toBe('dev_probe_items');
    expect(modelKey('AuditEvent')).toBe('auditEvent');
  });
});
