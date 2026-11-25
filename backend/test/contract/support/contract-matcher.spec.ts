import { describe, expect, it } from 'vitest';
import { type ContractResponse, contractViolations, expectToMatchContract, loadContract } from './contract-matcher.js';

/** T066: el matcher detecta respuestas fuera de contrato (no valida en vacío). Respuestas sintéticas, sin servidor. */
const CORRELATION = '0193b6f0-0000-7000-8000-0000000000c1';
const ITEM_ID = '0193b6f0-0000-7000-8000-0000000000d1';

function res(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  type = 'application/json',
): ContractResponse {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: new Headers({ ...(text ? { 'content-type': `${type}; charset=utf-8` } : {}), ...headers }),
    body: text,
  };
}
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  type: `https://errors.kuota.app/${code}`,
  title: 'x',
  status,
  code,
  correlation_id: CORRELATION,
  ...extra,
});
const item = {
  id: ITEM_ID,
  label: 'x',
  sample_amount: { amount_minor: '-9223372036854775807', currency: 'MXN' },
  version: 1,
  created_at: '2026-11-23T10:00:00.000Z',
  updated_at: '2026-11-23T10:00:00.000Z',
};

describe('expectToMatchContract (T066)', () => {
  it('el bundle se genera desde contracts/openapi y contiene las 8 operaciones', () => {
    for (const id of [
      'getLiveness',
      'getReadiness',
      'getCompatibility',
      'createDevProbeItem',
      'listDevProbeItems',
      'getDevProbeItem',
      'updateDevProbeItem',
      'deleteDevProbeItem',
    ]) {
      expect(loadContract().operation(id).op['operationId']).toBe(id);
    }
    expect(() => loadContract().operation('noExiste')).toThrow('operationId desconocido');
  });

  it('acepta respuestas conformes (JSON, problem+json, 204 sin cuerpo, encabezado entero requerido)', () => {
    expectToMatchContract(res(200, { status: 'ok' }), 'getLiveness');
    expectToMatchContract(res(201, item, { 'idempotent-replayed': 'true' }), 'createDevProbeItem');
    expectToMatchContract(res(404, problem(404, 'not-found'), {}, 'application/problem+json'), 'getDevProbeItem');
    expectToMatchContract(res(204, undefined), 'deleteDevProbeItem');
    expectToMatchContract(
      res(409, problem(409, 'idempotency-request-in-progress'), { 'retry-after': '1' }, 'application/problem+json'),
      'createDevProbeItem',
    );
  });

  const NEGATIVE: Array<[string, ContractResponse, string, RegExp]> = [
    [
      'código no declarado',
      res(500, problem(500, 'internal-error'), {}, 'application/problem+json'),
      'getDevProbeItem',
      /no está declarado/,
    ],
    [
      'propiedad extra (additionalProperties: false)',
      res(200, { status: 'ok', host: 'db-1' }),
      'getLiveness',
      /additional/i,
    ],
    ['enum violado', res(200, { status: 'up' }), 'getLiveness', /allowed values/i],
    [
      'falta un campo requerido',
      res(200, { ...item, version: undefined }),
      'getDevProbeItem',
      /required property 'version'/,
    ],
    ['formato uuid inválido', res(200, { ...item, id: 'no-uuid' }), 'getDevProbeItem', /format "uuid"/],
    [
      'formato date-time inválido',
      res(200, { ...item, created_at: '23/11/2026' }),
      'getDevProbeItem',
      /format "date-time"/,
    ],
    [
      'dinero como número',
      res(200, { ...item, sample_amount: { amount_minor: 5, currency: 'MXN' } }),
      'getDevProbeItem',
      /must be string/,
    ],
    [
      'Content-Type no declarado (error como application/json)',
      res(404, problem(404, 'not-found')),
      'getDevProbeItem',
      /Content-Type/,
    ],
    [
      'problem sin correlation_id',
      res(404, { ...problem(404, 'not-found'), correlation_id: undefined }, {}, 'application/problem+json'),
      'getDevProbeItem',
      /correlation_id/,
    ],
    [
      'falta Retry-After (requerido)',
      res(409, problem(409, 'idempotency-request-in-progress'), {}, 'application/problem+json'),
      'createDevProbeItem',
      /Retry-After/,
    ],
    [
      'Retry-After no entero',
      res(
        409,
        problem(409, 'idempotency-request-in-progress'),
        { 'retry-after': 'pronto' },
        'application/problem+json',
      ),
      'createDevProbeItem',
      /Retry-After inválido/,
    ],
    [
      'Idempotent-Replayed fuera del enum',
      res(201, item, { 'idempotent-replayed': 'yes' }),
      'createDevProbeItem',
      /Idempotent-Replayed inválido/,
    ],
    ['cuerpo en un 204', res(204, { x: 1 }), 'deleteDevProbeItem', /no declara cuerpo/],
    ['cuerpo que no es JSON', res(200, 'no json'), 'getLiveness', /no es JSON/],
  ];
  for (const [name, response, operationId, message] of NEGATIVE) {
    it(`rechaza: ${name}`, () => {
      const violations = contractViolations(response, operationId);
      expect(violations.join(' | ')).toMatch(message);
    });
  }
});
