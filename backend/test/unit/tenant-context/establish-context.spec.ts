import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLS_CORRELATION_ID } from '../../../src/common/logging/logger-options.js';
import {
  establishTenantContext,
  TenantContextConflictError,
} from '../../../src/common/tenant-context/establish-context.js';
import { TenantContext, TenantContextMissingError } from '../../../src/common/tenant-context/tenant-context.js';

/** Ramas defensivas de T038 que el guard nunca alcanza (valida antes): se prueban directamente. */
const A = '0193b6f0-0000-7000-8000-00000000000a';
const B = '0193b6f0-0000-7000-8000-00000000000b';
let cls: ClsService;
let context: TenantContext;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true })],
    providers: [TenantContext],
  }).compile();
  cls = moduleRef.get(ClsService);
  context = moduleRef.get(TenantContext);
});

describe('establishTenantContext (T038)', () => {
  it('fuera de un contexto CLS activo → TenantContextMissingError', () => {
    expect(() => establishTenantContext(cls, { tenantId: A, actorId: null, actorType: 'DEV' })).toThrow(
      TenantContextMissingError,
    );
  });

  it('rechaza tenantId que no sea UUID en minúsculas o que sea el UUID nulo', () => {
    for (const tenantId of [A.toUpperCase(), 'x', '', '00000000-0000-0000-0000-000000000000', `${A} `]) {
      cls.run(() => {
        expect(() => establishTenantContext(cls, { tenantId, actorId: null, actorType: 'DEV' }), tenantId).toThrow(
          /UUID/,
        );
        expect(context.current()).toBeNull();
      });
    }
  });

  it('rechaza actorId con formato inválido', () => {
    cls.run(() => {
      expect(() => establishTenantContext(cls, { tenantId: A, actorId: 'con espacio', actorType: 'DEV' })).toThrow(
        /actorId/,
      );
      expect(context.current()).toBeNull();
    });
  });

  it('establecerlo dos veces con los mismos valores es idempotente', () => {
    cls.run(() => {
      establishTenantContext(cls, { tenantId: A, actorId: 'dev:a', actorType: 'DEV' });
      establishTenantContext(cls, { tenantId: A, actorId: 'dev:a', actorType: 'DEV' });
      expect(context.require()).toMatchObject({ tenantId: A, actorId: 'dev:a' });
    });
  });

  it('cambiar el tenant o el actor ya establecidos → TenantContextConflictError', () => {
    cls.run(() => {
      establishTenantContext(cls, { tenantId: A, actorId: 'dev:a', actorType: 'DEV' });
      expect(() => establishTenantContext(cls, { tenantId: B, actorId: 'dev:a', actorType: 'DEV' })).toThrow(
        TenantContextConflictError,
      );
      expect(() => establishTenantContext(cls, { tenantId: A, actorId: 'dev:otro', actorType: 'DEV' })).toThrow(
        TenantContextConflictError,
      );
      expect(() => establishTenantContext(cls, { tenantId: A, actorId: null, actorType: 'DEV' })).toThrow(
        TenantContextConflictError,
      );
      expect(context.require().tenantId).toBe(A);
    });
  });

  it('TenantContext: sin correlación ni actor devuelve null en esos campos; fuera de CLS, current() es null', () => {
    expect(context.current()).toBeNull();
    expect(() => context.require()).toThrow(TenantContextMissingError);
    cls.run(() => {
      establishTenantContext(cls, { tenantId: A, actorId: null, actorType: 'DEV' });
      expect(context.require()).toEqual({
        tenantId: A,
        actorId: null,
        actorType: 'DEV',
        actorRole: null,
        correlationId: null,
      });
      cls.set(CLS_CORRELATION_ID, 'c');
      expect(context.require().correlationId).toBe('c');
    });
  });
});
