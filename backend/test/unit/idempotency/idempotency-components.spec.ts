import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AUDIT_ORIGIN_HTTP, AuditActorGuard } from '../../../src/common/audit/audit-actor.guard.js';
import { AUDIT_ORIGINS, CLS_AUDIT_ORIGIN } from '../../../src/common/audit/audit.service.js';
import { KuotaProblemError } from '../../../src/common/errors/problem.js';
import {
  IdempotencyRepository,
  type IdempotentRequest,
  type StoredResponse,
} from '../../../src/common/idempotency/idempotency.repository.js';
import { IdempotentInterceptor } from '../../../src/common/idempotency/idempotent.interceptor.js';
import type { TenantContext } from '../../../src/common/tenant-context/tenant-context.js';
import type { TenantPrismaService } from '../../../src/common/tenant-context/tenant-prisma.service.js';

/** Ramas defensivas de idempotencia y auditoría que el flujo HTTP real no recorre (T075–T077). */
const TENANT = '0193b6f0-0000-7000-8000-00000000000a';

function httpContext(request: Record<string, unknown>, handler: () => void = () => undefined) {
  const headers: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string) => (headers[name] = value) };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  return { context, headers };
}

describe('IdempotentInterceptor', () => {
  const cls = { set: () => undefined } as unknown as ClsService;
  const make = (outcome: { replayed: boolean }) => {
    const seen: IdempotentRequest[] = [];
    const repository = {
      run: async (request: IdempotentRequest, command: () => Promise<StoredResponse>) => {
        seen.push(request);
        const response = await command();
        return { ...response, replayed: outcome.replayed };
      },
    } as unknown as IdempotencyRepository;
    return { interceptor: new IdempotentInterceptor(repository, new Reflector(), cls), seen };
  };

  it('valores por defecto de método y URL; GET → 200; @HttpCode tiene prioridad; reproducción marca el encabezado', async () => {
    const { interceptor, seen } = make({ replayed: true });
    const { context, headers } = httpContext({ headers: { 'idempotency-key': 'clave-123' } });
    const body = await lastValueFrom(await interceptor.intercept(context, { handle: () => of({ ok: 1 }) }));
    expect(body).toEqual({ ok: 1 });
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/' });
    expect(headers['Idempotent-Replayed']).toBe('true');

    const handler = () => undefined;
    Reflect.defineMetadata(HTTP_CODE_METADATA, 202, handler);
    const fresh = make({ replayed: false });
    const second = httpContext(
      { method: 'put', url: '/v1/x?q=1', headers: { 'idempotency-key': 'clave-123' }, body: {} },
      handler,
    );
    let status = 0;
    const repository = {
      run: async (_r: IdempotentRequest, command: () => Promise<StoredResponse>) => {
        const response = await command();
        status = response.status;
        return { ...response, replayed: false };
      },
    } as unknown as IdempotencyRepository;
    const withCode = new IdempotentInterceptor(repository, new Reflector(), cls);
    expect(await lastValueFrom(await withCode.intercept(second.context, { handle: () => of(null) }))).toBeNull();
    expect(status).toBe(202);
    expect(second.headers['Idempotent-Replayed']).toBeUndefined();
    expect(fresh.seen).toEqual([]);
  });

  it('un handler sin valor produce null; la clave inválida falla antes de tocar el repositorio', async () => {
    const { interceptor, seen } = make({ replayed: false });
    const { context } = httpContext({
      method: 'POST',
      originalUrl: '/v1/a',
      headers: { 'idempotency-key': 'clave-123' },
    });
    const { EMPTY } = await import('rxjs');
    expect(await lastValueFrom(await interceptor.intercept(context, { handle: () => EMPTY }))).toBeNull();
    const bad = httpContext({ method: 'POST', headers: {} });
    await expect(interceptor.intercept(bad.context, { handle: () => of(1) })).rejects.toBeInstanceOf(KuotaProblemError);
    expect(seen).toHaveLength(1);
  });
});

describe('IdempotencyRepository: ramas defensivas', () => {
  function repositoryWith(tx: Record<string, unknown>) {
    const tenantPrisma = {
      withTenant: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as TenantPrismaService;
    const context = { require: () => ({ tenantId: TENANT }) } as unknown as TenantContext;
    return new IdempotencyRepository(tenantPrisma, context);
  }
  const request: IdempotentRequest = { key: 'clave-123', requestHash: 'a'.repeat(64), method: 'POST', path: '/v1/x' };
  const baseTx = (locked: unknown) => ({
    $queryRaw: () => Promise.resolve(locked),
    $executeRaw: () => Promise.resolve(0),
    idempotency_keys: {
      findFirst: () => Promise.resolve(null),
      updateMany: (args: unknown): Promise<unknown> => Promise.resolve({ count: 1, args }),
    },
  });

  it('sin fila de resultado del bloqueo → 409 (fail-closed)', async () => {
    await expect(
      repositoryWith(baseTx([])).run(request, () => Promise.resolve({ status: 201, body: {} })),
    ).rejects.toMatchObject({
      code: 'idempotency-request-in-progress',
    });
  });

  it('una respuesta que no es 2xx no se almacena: error y la transacción se revierte', async () => {
    const run = repositoryWith(baseTx([{ locked: true }])).run(request, () =>
      Promise.resolve({ status: 500, body: null }),
    );
    await expect(run).rejects.toThrow('Solo se almacenan respuestas 2xx');
  });

  it('un body undefined se almacena como null', async () => {
    const updates: unknown[] = [];
    const tx = baseTx([{ locked: true }]);
    tx.idempotency_keys.updateMany = (args: unknown) => Promise.resolve(void updates.push(args));
    const out = await repositoryWith(tx).run(request, () => Promise.resolve({ status: 204, body: undefined }));
    expect(out).toMatchObject({ replayed: false, status: 204 });
    expect(updates[0]).toMatchObject({ data: { response_body: null } });
  });
});

describe('AuditActorGuard: origen lógico sin datos de red (minimización, Aprobación 5)', () => {
  const guardWith = (actorId: string | null) => {
    const stored: Record<string, unknown> = {};
    const cls = { set: (k: string, v: unknown) => (stored[k] = v) } as unknown as ClsService;
    const context = { require: () => ({ actorId }) } as unknown as TenantContext;
    return { guard: new AuditActorGuard(context, cls), stored };
  };
  // Solicitud con todas las fuentes de red posibles; si el guard la leyera, el acceso quedaría registrado.
  const networkRequest = () => {
    const touched: string[] = [];
    const request = {
      ip: '203.0.113.7',
      ips: ['198.51.100.23', '203.0.113.7'],
      socket: { remoteAddress: '2001:db8::bad:cafe', remotePort: 51234 },
      headers: {
        'x-forwarded-for': '198.51.100.23, 203.0.113.7',
        'x-real-ip': '198.51.100.23',
        forwarded: 'for="[2001:db8::1]";proto=https',
      },
    };
    const execution = new Proxy({} as ExecutionContext, {
      get: (_target, prop) => {
        touched.push(String(prop));
        return () => ({ getRequest: () => request });
      },
    });
    return { execution, touched };
  };

  it('con actor fija origin = "http" y no consulta la solicitud (ni req.ip, ni socket, ni encabezados de proxy)', () => {
    const { guard, stored } = guardWith('dev:x');
    const { execution, touched } = networkRequest();
    // Nest invoca el guard con el ExecutionContext; la interfaz lo admite aunque la implementación no lo use.
    expect((guard as CanActivate).canActivate(execution)).toBe(true);
    expect(stored[CLS_AUDIT_ORIGIN]).toBe(AUDIT_ORIGIN_HTTP);
    expect(stored[CLS_AUDIT_ORIGIN]).toBe('http');
    expect(touched).toEqual([]);
  });

  it('el origen es una constante: no contiene IPv4, IPv6, ip-hash ni un hash hexadecimal', () => {
    const { guard, stored } = guardWith('dev:x');
    guard.canActivate();
    const origin = String(stored[CLS_AUDIT_ORIGIN]);
    expect(origin).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
    expect(origin).not.toMatch(/[0-9a-f]{0,4}:[0-9a-f]{0,4}:/i);
    expect(origin).not.toMatch(/ip-hash|ip-hmac|[0-9a-f]{32}/);
    expect(AUDIT_ORIGINS).toEqual(['http']);
  });

  it('sin actor → 400 validation-error y no fija origen: el origen no sustituye a la identidad', () => {
    const { guard, stored } = guardWith(null);
    let error: unknown;
    try {
      guard.canActivate();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(KuotaProblemError);
    expect(error).toMatchObject({ code: 'validation-error' });
    expect(stored).toEqual({});
  });
});
