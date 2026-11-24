import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  httpErrorObject,
  httpSuccessObject,
  routeTemplate,
  serializeHttpRequest,
  serializeHttpResponse,
  UNMATCHED_ROUTE,
} from '../../../src/common/logging/http-log.js';
import { buildLoggerOptions } from '../../../src/common/logging/logger-options.js';
import { OMITTED_HTTP_OBJECT, sanitizeLogObject } from '../../../src/common/logging/redaction.js';
import { loadConfig } from '../../../src/common/config/load-config.js';
import { validEnv } from '../../support/env.js';
import { recordOutput } from '../../support/log-capture.js';

/** Hotfix de privacidad de logs HTTP (2026-11-23): serializadores por lista permitida y omisión de objetos HTTP. */
const FICTITIOUS = {
  ip: '203.0.113.7',
  ipv6: '2001:db8::cafe',
  token: 'FICTICIO-TOKEN-XYZ',
};

function rawRequest(): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  Object.assign(req, {
    method: 'POST',
    url: `/v1/dev/probe-items/0193b6f0-0000-7000-8000-000000000001?token=${FICTITIOUS.token}`,
    headers: { 'x-forwarded-for': FICTITIOUS.ip, authorization: `Bearer ${FICTITIOUS.token}`, 'x-nuevo': 'dato' },
    id: '01a20000-0000-7000-8000-000000000001',
    route: { path: '/v1/dev/probe-items/:id' },
    body: { password: 'FICTICIA' },
  });
  return req;
}

describe('serializadores HTTP por lista permitida', () => {
  it('req → solo el método; nada de URL, query, encabezados, IP, puerto ni cuerpo', () => {
    expect(serializeHttpRequest(rawRequest())).toEqual({ method: 'POST' });
    expect(serializeHttpRequest({ method: 'BREW' })).toEqual({ method: 'OTHER' });
    expect(serializeHttpRequest(null)).toEqual({ method: 'OTHER' });
  });

  it('res → solo el código de estado', () => {
    const res = new ServerResponse(rawRequest());
    res.statusCode = 201;
    res.setHeader('set-cookie', 'sid=FICTICIA');
    expect(serializeHttpResponse(res)).toEqual({ statusCode: 201 });
    expect(serializeHttpResponse(undefined)).toEqual({ statusCode: null });
  });

  it('route → plantilla registrada; sin plantilla fiable → unmatched', () => {
    expect(routeTemplate(rawRequest())).toBe('/v1/dev/probe-items/:id');
    expect(routeTemplate({ route: { path: '/health/{*path}' } })).toBe('/health/{*path}');
    for (const path of [undefined, 42, '/x?token=1', '/x y', 'sin-barra', `/${'a'.repeat(300)}`]) {
      expect(routeTemplate({ route: { path } }), String(path)).toBe(UNMATCHED_ROUTE);
    }
    expect(routeTemplate({})).toBe(UNMATCHED_ROUTE);
  });

  it('objetos del log de acceso: correlación, ruta y solo la categoría del error', () => {
    const req = rawRequest();
    const res = new ServerResponse(req);
    expect(httpSuccessObject(req, res, { responseTime: 3 })).toEqual({
      responseTime: 3,
      correlation_id: '01a20000-0000-7000-8000-000000000001',
      route: '/v1/dev/probe-items/:id',
    });
    const error = new TypeError(`fallo con ${FICTITIOUS.ip}`);
    expect(httpErrorObject(req, res, error, { err: error })).toMatchObject({ err: { type: 'TypeError' } });
    expect(JSON.stringify(httpErrorObject(req, res, error, { err: error }))).not.toContain(FICTITIOUS.ip);
    expect(httpErrorObject({} as IncomingMessage, res, null as unknown as Error, {})).toEqual({
      route: UNMATCHED_ROUTE,
      err: { type: 'Error' },
    });
  });
});

describe('objetos HTTP pasados por error a un log', () => {
  it('sanitizeLogObject omite solicitudes, respuestas y sockets bajo cualquier clave salvo req/res', () => {
    const req = rawRequest();
    const out = sanitizeLogObject({
      request: req,
      nested: { response: new ServerResponse(req), socket: new Socket() },
      list: [req],
      req,
      authorization: 'x',
    });
    expect(out).toMatchObject({
      request: OMITTED_HTTP_OBJECT,
      nested: { response: OMITTED_HTTP_OBJECT, socket: OMITTED_HTTP_OBJECT },
      list: [OMITTED_HTTP_OBJECT],
      authorization: '[REDACTED]',
    });
    expect(out['req']).toBe(req); // la serializa su serializador por lista permitida
  });

  it('el JSON real de pino con la configuración de Kuota no contiene datos de la solicitud', () => {
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        output += chunk.toString();
        recordOutput(chunk.toString()); // SC-009 · T102: captura de la suite
        done();
      },
    });
    const logger = pino(
      {
        ...buildLoggerOptions(loadConfig(validEnv({ LOG_LEVEL: 'info' }))),
        serializers: { req: serializeHttpRequest, res: serializeHttpResponse },
      },
      stream,
    );
    const req = rawRequest();
    logger.child({ req }).info({ res: new ServerResponse(req), request: req, socket: req.socket }, 'prueba');
    const line = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ req: { method: 'POST' }, res: { statusCode: 200 }, request: OMITTED_HTTP_OBJECT });
    for (const value of [FICTITIOUS.ip, FICTITIOUS.token, 'x-nuevo', 'FICTICIA', 'probe-items', 'remote']) {
      expect(output, value).not.toContain(value);
    }
  });
});
