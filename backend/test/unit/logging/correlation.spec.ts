import { Writable } from 'node:stream';
import { Controller, Get, Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../../src/common/config/config.module.js';
import { LoggingModule, requestContextMiddleware } from '../../../src/common/logging/logging.module.js';
import { CORRELATION_HEADER, resolveCorrelationId } from '../../../src/common/logging/correlation.js';
import { validEnv } from '../../support/env.js';

// T019 · FR-009: correlation_id propagado o generado (UUIDv7), módulo, nivel y tenant/actor desde CLS.
let logs = '';
const stream = new Writable({
  write(chunk: Buffer, _enc, done) {
    logs += chunk.toString();
    done();
  },
});

@Controller('probe-logging')
class ProbeLoggingController {
  private readonly logger = new Logger('ProbeModule');
  constructor(private readonly cls: ClsService) {}

  @Get()
  handle(): { correlationId: string | undefined } {
    // Simula lo que hará el contexto autenticado (T038): el tenant se fija en el servidor, nunca desde el cliente.
    this.cls.set('tenantId', '0193b6f0-0000-7000-8000-000000000001');
    this.cls.set('actorId', 'dev:tester');
    this.logger.log('procesando');
    return { correlationId: this.cls.get<string>('correlationId') };
  }
}

describe('logging HTTP con correlación y contexto CLS', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(validEnv({ LOG_LEVEL: 'info' })), LoggingModule.forRoot({ stream })],
      controllers: [ProbeLoggingController],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoNestLogger));
    // Igual que createApp (src/bootstrap.ts): el contexto de solicitud se monta para todas las rutas.
    app.use(requestContextMiddleware());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  const records = (): Record<string, unknown>[] =>
    logs
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  it('propaga un X-Correlation-Id válido a la respuesta, al CLS y a cada log', async () => {
    const id = '7f0c2a52-1d4e-4c9b-9a3e-2b7f6c1d8e90';
    logs = '';
    const res = await fetch(`${baseUrl}/probe-logging`, {
      headers: { [CORRELATION_HEADER]: id, authorization: 'Bearer secreto' },
    });
    expect(res.headers.get(CORRELATION_HEADER)).toBe(id);
    expect(((await res.json()) as { correlationId: string }).correlationId).toBe(id);
    const app = records().find((r) => r['msg'] === 'procesando');
    expect(app).toMatchObject({
      correlation_id: id,
      tenant_id: '0193b6f0-0000-7000-8000-000000000001',
      actor_id: 'dev:tester',
      module: 'ProbeModule',
      level: 'info',
    });
    expect(logs).not.toContain('Bearer secreto');
    expect(records().some((r) => r['correlation_id'] === id && r['msg'] === 'request completed')).toBe(true);
    for (const line of logs.trim().split('\n'))
      expect(line.match(/"correlation_id"/g)?.length ?? 0, line).toBeLessThanOrEqual(1);
  });

  it('genera un UUIDv7 si el encabezado falta o no es un UUID', async () => {
    for (const header of [undefined, 'no-es-uuid', "'; DROP TABLE x; --"]) {
      const res = await fetch(`${baseUrl}/probe-logging`, { headers: header ? { [CORRELATION_HEADER]: header } : {} });
      const id = res.headers.get(CORRELATION_HEADER);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(id).not.toBe(header);
    }
  });

  it('resolveCorrelationId normaliza a minúsculas y rechaza valores no UUID', () => {
    expect(resolveCorrelationId('7F0C2A52-1D4E-4C9B-9A3E-2B7F6C1D8E90')).toBe('7f0c2a52-1d4e-4c9b-9a3e-2b7f6c1d8e90');
    expect(resolveCorrelationId(['a', 'b'])).toMatch(/^[0-9a-f-]{36}$/);
  });
});
