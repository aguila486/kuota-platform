import { describe, expect, it } from 'vitest';
import { KuotaProblemError } from '../../../src/common/errors/problem.js';
import { IdempotencyKeyPipe } from '../../../src/common/idempotency/idempotency-key.pipe.js';
import { Money } from '../../../src/common/money/index.js';
import {
  DevProbeRepository,
  type DevProbePage,
  type UpdateOutcome,
} from '../../../src/modules/dev-probe/application/dev-probe.repository.js';
import type { AuditService } from '../../../src/common/audit/audit.service.js';
import type { TenantPrismaService } from '../../../src/common/tenant-context/tenant-prisma.service.js';
import { DevProbeService } from '../../../src/modules/dev-probe/application/dev-probe.service.js';
import {
  DevProbeInvariantError,
  DevProbeItem,
  type DevProbeItemRecord,
  DevProbeValidationError,
  newDevProbeItem,
  validateLabel,
  validateVersion,
} from '../../../src/modules/dev-probe/domain/dev-probe-item.js';
import {
  asValidationError,
  decodeCursor,
  encodeCursor,
  normalizeId,
  parseCreateBody,
  parseLimit,
  parseUpdateBody,
  toJson,
} from '../../../src/modules/dev-probe/interface/dev-probe.http.js';

const ID = '0193b6f0-0000-7000-8000-000000000001';
const record = (overrides: Partial<DevProbeItemRecord> = {}): DevProbeItemRecord => ({
  id: ID,
  label: 'ok',
  sampleAmountMinor: 9223372036854775807n,
  sampleCurrency: 'USD',
  version: 1,
  createdAt: new Date('2026-11-22T10:00:00.000Z'),
  updatedAt: new Date('2026-11-22T10:00:01.000Z'),
  ...overrides,
});
const problemOf = (fn: () => unknown): KuotaProblemError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof KuotaProblemError) return error;
    throw error;
  }
  throw new Error('se esperaba KuotaProblemError');
};

describe('dominio DevProbeItem (T040)', () => {
  it('label: 1–120 puntos de código', () => {
    expect(validateLabel('a')).toBe('a');
    expect(validateLabel('🙂'.repeat(120))).toHaveLength(240);
    for (const bad of ['', 'a'.repeat(121), '🙂'.repeat(121), 5, null]) {
      expect(() => validateLabel(bad)).toThrow(DevProbeValidationError);
    }
  });

  it('version: entero 1 … 2147483647', () => {
    expect(validateVersion(1)).toBe(1);
    expect(validateVersion(2_147_483_647)).toBe(2_147_483_647);
    for (const bad of [0, -1, 1.5, 2_147_483_648, Number.NaN, '1']) {
      expect(() => validateVersion(bad)).toThrow(DevProbeValidationError);
    }
  });

  it('fromRecord: monto y moneda juntos → Money exacto; ambos nulos → null', () => {
    const item = DevProbeItem.fromRecord(record());
    expect(item.sampleAmount?.amountMinor).toBe(9223372036854775807n);
    expect(Object.isFrozen(item)).toBe(true);
    expect(DevProbeItem.fromRecord(record({ sampleAmountMinor: null, sampleCurrency: null })).sampleAmount).toBeNull();
  });

  it('fromRecord: inconsistencia monto↔moneda o datos inválidos → DevProbeInvariantError', () => {
    for (const bad of [
      record({ sampleCurrency: null }),
      record({ sampleAmountMinor: null }),
      record({ sampleCurrency: 'EUR' }),
      record({ sampleAmountMinor: -9223372036854775808n }),
      record({ label: '' }),
      record({ version: 0 }),
    ]) {
      expect(() => DevProbeItem.fromRecord(bad)).toThrow(DevProbeInvariantError);
    }
  });

  it('newDevProbeItem valida el label y conserva el Money', () => {
    const money = Money.of(5n, 'JPY');
    expect(newDevProbeItem('x', money)).toEqual({ label: 'x', sampleAmount: money });
    expect(() => newDevProbeItem('', null)).toThrow(DevProbeValidationError);
  });
});

describe('frontera HTTP (T042, T062)', () => {
  it('parseCreateBody: Money compartido (bigint exacto) y rechazo de propiedades no permitidas', () => {
    const input = parseCreateBody({
      label: 'x',
      sample_amount: { amount_minor: '-9223372036854775807', currency: 'CLF' },
    });
    expect(input.sampleAmount?.amountMinor).toBe(-9223372036854775807n);
    expect(parseCreateBody({ label: 'x' }).sampleAmount).toBeNull();
    expect(problemOf(() => parseCreateBody({ label: 'x', tenant_id: 'otro' })).options.errors).toEqual([
      { field: 'tenant_id', message: 'Propiedad no permitida' },
    ]);
    for (const bad of [
      null,
      [],
      'x',
      { label: 1 },
      { label: 'x', sample_amount: { amount_minor: '1', currency: 'EUR' } },
    ]) {
      expect(problemOf(() => parseCreateBody(bad)).code).toBe('validation-error');
    }
  });

  it('parseUpdateBody exige label (texto) y version (número)', () => {
    expect(parseUpdateBody({ label: 'x', version: 3 })).toEqual({ label: 'x', version: 3 });
    for (const bad of [
      { label: 'x' },
      { version: 1 },
      { label: 'x', version: '1' },
      { label: 'x', version: 1, id: 'y' },
    ]) {
      expect(problemOf(() => parseUpdateBody(bad)).code).toBe('validation-error');
    }
  });

  it('parseLimit: 1–100, por defecto 50', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('100')).toBe(100);
    for (const bad of ['0', '101', '01', '1e2', ' 5', ['5'], ''])
      expect(() => parseLimit(bad)).toThrow(KuotaProblemError);
  });

  it('cursor opaco: ida y vuelta; inválidos → 400', () => {
    expect(encodeCursor(null)).toBeNull();
    expect(decodeCursor(encodeCursor(ID))).toBe(ID);
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(Buffer.from(`v1:${ID.toUpperCase()}`).toString('base64url'))).toBe(ID);
    for (const bad of [
      '',
      '***',
      'a'.repeat(513),
      Buffer.from('v1:x').toString('base64url'),
      Buffer.from(ID).toString('base64url'),
      5,
    ]) {
      expect(() => decodeCursor(bad)).toThrow(KuotaProblemError);
    }
  });

  it('normalizeId y toJson (Money como string canónico, fechas ISO)', () => {
    expect(normalizeId(ID.toUpperCase())).toBe(ID);
    expect(normalizeId('x')).toBeNull();
    expect(toJson(DevProbeItem.fromRecord(record()))).toEqual({
      id: ID,
      label: 'ok',
      sample_amount: { amount_minor: '9223372036854775807', currency: 'USD' },
      version: 1,
      created_at: '2026-11-22T10:00:00.000Z',
      updated_at: '2026-11-22T10:00:01.000Z',
    });
  });

  it('asValidationError traduce errores de dominio (síncronos o asíncronos) y deja pasar los demás', async () => {
    await expect(asValidationError(() => validateLabel(''))).rejects.toMatchObject({ code: 'validation-error' });
    await expect(
      asValidationError(() => Promise.reject(new DevProbeValidationError('version', 'x'))),
    ).rejects.toMatchObject({ options: { errors: [{ field: 'version', message: 'x' }] } });
    const other = new Error('otro');
    await expect(asValidationError(() => Promise.reject(other))).rejects.toBe(other);
    await expect(asValidationError(() => 7)).resolves.toBe(7);
  });
});

describe('IdempotencyKeyPipe (T042)', () => {
  const pipe = new IdempotencyKeyPipe();
  it('acepta 8–128 [A-Za-z0-9_-]; rechaza el resto sin reflejar el valor', () => {
    expect(pipe.transform('abcdEF_-')).toBe('abcdEF_-');
    expect(pipe.transform('x'.repeat(128))).toHaveLength(128);
    for (const bad of [
      undefined,
      '',
      '1234567',
      'x'.repeat(129),
      'a b c d e',
      'clave-uno-1, clave-dos-2',
      ['abcdefgh'],
    ]) {
      const error = problemOf(() => pipe.transform(bad));
      expect(error.code).toBe('validation-error');
      expect(JSON.stringify(error.options)).not.toContain('clave-uno');
    }
  });
});

describe('casos de uso DevProbeService (T042)', () => {
  class FakeRepository extends DevProbeRepository {
    outcome: UpdateOutcome = { kind: 'not-found' };
    found: DevProbeItem | null = null;
    deleted: DevProbeItem | null = null;
    create = (item: { label: string }) => Promise.resolve(DevProbeItem.fromRecord(record({ label: item.label })));
    findById = () => Promise.resolve(this.found);
    list = (): Promise<DevProbePage> => Promise.resolve({ items: [], nextAfterId: null });
    updateLabel = () => Promise.resolve(this.outcome);
    delete = () => Promise.resolve(this.deleted);
  }
  const repo = new FakeRepository();
  const recorded: unknown[] = [];
  const tenantPrisma = { withTenant: <T>(fn: () => Promise<T>) => fn() } as unknown as TenantPrismaService;
  const audit = { record: (event: unknown) => Promise.resolve(void recorded.push(event)) } as unknown as AuditService;
  const service = new DevProbeService(repo, tenantPrisma, audit);

  it('get/delete inexistente → not-found; update → not-found o version-conflict según el repositorio', async () => {
    await expect(service.getDevProbeItem(ID)).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.deleteDevProbeItem(ID)).rejects.toMatchObject({ code: 'not-found' });
    await expect(service.updateDevProbeItem(ID, 'x', 1)).rejects.toMatchObject({ code: 'not-found' });
    repo.outcome = { kind: 'version-conflict' };
    await expect(service.updateDevProbeItem(ID, 'x', 1)).rejects.toMatchObject({ code: 'version-conflict' });
    const item = DevProbeItem.fromRecord(record());
    repo.outcome = { kind: 'updated', item, previous: { label: 'antes', version: 1 } };
    await expect(service.updateDevProbeItem(ID, 'x', 1)).resolves.toBe(item);
    repo.found = item;
    await expect(service.getDevProbeItem(ID)).resolves.toBe(item);
    repo.deleted = item;
    await expect(service.deleteDevProbeItem(ID)).resolves.toBeUndefined();
    await expect(service.createDevProbeItem('nuevo', null)).resolves.toMatchObject({ label: 'nuevo' });
    await expect(service.listDevProbeItems(10, null)).resolves.toEqual({ items: [], nextAfterId: null });
    // Solo las escrituras confirmadas se auditan (update, delete y create exitosos), con la lista permitida.
    expect(recorded).toEqual([
      {
        action: 'dev_probe.updated',
        entityType: 'dev_probe',
        entityId: ID,
        changes: { label: { before: 'antes', after: 'ok' }, version: { before: 1, after: 1 } },
      },
      { action: 'dev_probe.deleted', entityType: 'dev_probe', entityId: ID, changes: { label: 'ok', version: 1 } },
      {
        action: 'dev_probe.created',
        entityType: 'dev_probe',
        entityId: ID,
        changes: {
          label: 'nuevo',
          sample_amount: { amount_minor: '9223372036854775807', currency: 'USD' },
          version: 1,
        },
      },
    ]);
  });

  it('valida label y version antes de tocar el repositorio', async () => {
    await expect(service.updateDevProbeItem(ID, '', 1)).rejects.toBeInstanceOf(DevProbeValidationError);
    await expect(service.updateDevProbeItem(ID, 'x', 0)).rejects.toBeInstanceOf(DevProbeValidationError);
    expect(() => service.createDevProbeItem('', null)).toThrow(DevProbeValidationError);
  });
});
