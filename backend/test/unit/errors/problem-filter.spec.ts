import { Writable } from 'node:stream';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../../src/common/config/config.module.js';
import { KuotaProblemError } from '../../../src/common/errors/problem.js';
import { ProblemDetailsFilter } from '../../../src/common/errors/problem.filter.js';
import { CORRELATION_HEADER } from '../../../src/common/logging/correlation.js';
import { LoggingModule } from '../../../src/common/logging/logging.module.js';
import { validEnv } from '../../support/env.js';

// T020 · FR-011: toda excepción → application/problem+json (RFC 9457) con code y correlation_id, sin stack ni secretos.
let logs = '';
const stream = new Writable({
  write(chunk: Buffer, _enc, done) {
    logs += chunk.toString();
    done();
  },
});

@Controller('probe-errors')
class ProbeErrorsController {
  @Get('unexpected')
  unexpected(): never {
    throw new Error('fallo interno con password=hunter2 y SELECT * FROM kuota.audit_events');
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('el recurso X del tenant Y no existe');
  }

  @Get('validation')
  validation(): never {
    throw new BadRequestException(['label must not be empty', 'version must be a positive integer']);
  }

  @Get('domain')
  domain(): never {
    throw new KuotaProblemError('version-conflict', { detail: 'La versión enviada no es la vigente.' });
  }

  @Get('domain-validation')
  domainValidation(): never {
    throw new KuotaProblemError('validation-error', {
      errors: [{ field: 'label', message: 'Debe tener entre 1 y 120 caracteres.' }],
    });
  }

  @Get('tenant')
  tenant(): never {
    throw new KuotaProblemError('tenant-context-required');
  }

  @Get('in-progress')
  inProgress(): never {
    throw new KuotaProblemError('idempotency-request-in-progress', { headers: { 'Retry-After': '1' } });
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException('base de datos caída en host-interno:5432');
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedException();
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('detalle interno');
  }

  @Get('upgrade')
  upgrade(): never {
    throw new HttpException('versión antigua', 426);
  }

  @Get('thrown-string')
  thrownString(): never {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw 'cadena con token=abc';
  }
}

describe('filtro problem+json (T020/T021)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(validEnv()), LoggingModule.forRoot({ stream })],
      controllers: [ProbeErrorsController],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoNestLogger));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function call(path: string, correlationId?: string) {
    const res = await fetch(`${baseUrl}/probe-errors/${path}`, {
      headers: correlationId ? { [CORRELATION_HEADER]: correlationId } : {},
    });
    const text = await res.text();
    return { res, text, body: JSON.parse(text) as Record<string, unknown> };
  }

  it('un error inesperado → 500 internal-error, sin stack, mensaje interno ni SQL', async () => {
    logs = '';
    const id = '2f0c2a52-1d4e-4c9b-9a3e-2b7f6c1d8e90';
    const { res, text, body } = await call('unexpected', id);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(body).toEqual({
      type: 'https://errors.kuota.app/internal-error',
      title: 'Error interno',
      status: 500,
      code: 'internal-error',
      correlation_id: id,
    });
    for (const leak of ['hunter2', 'SELECT', 'stack', 'at ProbeErrorsController']) expect(text).not.toContain(leak);
    // El detalle va solo al log (redactado), con la misma correlación.
    expect(logs).toContain(id);
    expect(logs).not.toContain('hunter2');
  });

  it('404 → not-found sin revelar el mensaje interno', async () => {
    const { res, text, body } = await call('not-found');
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ status: 404, code: 'not-found', title: 'No encontrado' });
    expect(text).not.toContain('tenant Y');
    expect(String(body['correlation_id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('400 → validation-error con errors[]', async () => {
    const { res, body } = await call('validation');
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: 'validation-error', status: 400 });
    expect(body['errors']).toEqual([
      { field: 'request', message: 'label must not be empty' },
      { field: 'request', message: 'version must be a positive integer' },
    ]);
  });

  it('errores de dominio tipados conservan su código, estado y detalle seguro', async () => {
    expect((await call('domain')).body).toMatchObject({
      status: 409,
      code: 'version-conflict',
      detail: 'La versión enviada no es la vigente.',
    });
    expect((await call('domain-validation')).body).toMatchObject({
      status: 400,
      code: 'validation-error',
      errors: [{ field: 'label', message: 'Debe tener entre 1 y 120 caracteres.' }],
    });
    expect((await call('tenant')).body).toMatchObject({ status: 401, code: 'tenant-context-required' });
  });

  it('valores lanzados que no son Error también producen internal-error sin filtrar su contenido', async () => {
    const { res, text } = await call('thrown-string');
    expect(res.status).toBe(500);
    expect(text).not.toContain('token=abc');
  });

  it('mapea los estados de HttpException a códigos del contrato sin exponer sus mensajes', async () => {
    const unavailable = await call('unavailable');
    expect(unavailable.res.status).toBe(500);
    expect(unavailable.body['code']).toBe('internal-error');
    expect(unavailable.text).not.toContain('host-interno');
    expect((await call('unauthorized')).body).toMatchObject({ status: 401, code: 'tenant-context-required' });
    expect((await call('upgrade')).body).toMatchObject({ status: 426, code: 'app-version-unsupported' });
    // 403 aún no tiene código propio en el contrato: conserva su estado (decisión pendiente para 002).
    const forbidden = await call('forbidden');
    expect(forbidden.body).toMatchObject({ status: 403, code: 'validation-error' });
    expect(forbidden.text).not.toContain('detalle interno');
  });

  it('aplica los encabezados del error de dominio (Retry-After en 409 idempotency-request-in-progress)', async () => {
    const { res, body } = await call('in-progress');
    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(body['code']).toBe('idempotency-request-in-progress');
  });

  it('una ruta inexistente → 404 not-found en formato problem+json', async () => {
    const res = await fetch(`${baseUrl}/no-existe`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(((await res.json()) as { code: string }).code).toBe('not-found');
  });
});
