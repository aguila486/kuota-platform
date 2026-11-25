import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, idempotencyLockId, requestHash } from '../../../src/common/idempotency/request-hash.js';

/** T074 (data-model.md `idempotency_keys.request_hash`): SHA-256 de método + ruta + JSON canónico del body. */
describe('request_hash canónico (T074)', () => {
  it('el mismo JSON con distinto orden de claves (también anidadas) produce el mismo hash', () => {
    const a = { label: 'x', sample_amount: { amount_minor: '100', currency: 'MXN' } };
    const b = { sample_amount: { currency: 'MXN', amount_minor: '100' }, label: 'x' };
    expect(requestHash('POST', '/v1/dev/probe-items', a)).toBe(requestHash('POST', '/v1/dev/probe-items', b));
  });

  it('cambia con el contenido, el método, la ruta o el orden de un arreglo', () => {
    const base = requestHash('POST', '/v1/x', { a: [1, 2] });
    expect(requestHash('POST', '/v1/x', { a: [2, 1] })).not.toBe(base);
    expect(requestHash('POST', '/v1/x', { a: [1, 2], b: null })).not.toBe(base);
    expect(requestHash('PUT', '/v1/x', { a: [1, 2] })).not.toBe(base);
    expect(requestHash('POST', '/v1/y', { a: [1, 2] })).not.toBe(base);
    expect(requestHash('post', '/v1/x', { a: [1, 2] })).toBe(base);
  });

  it('formato del contrato de la columna: 64 hex en minúsculas, igual a SHA-256 de la forma documentada', () => {
    const hash = requestHash('POST', '/v1/x', { b: 1, a: 'é' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update('POST\n/v1/x\n{"a":"é","b":1}', 'utf8').digest('hex'));
  });

  it('JSON canónico: claves ordenadas, undefined omitido, sin body → null, sin separador ambiguo', () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null, 'x'], c: undefined } })).toBe(
      '{"a":{"d":[true,null,"x"]},"b":1}',
    );
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(requestHash('POST', '/v1/x', undefined)).toBe(requestHash('POST', '/v1/x', null));
    // La ruta no puede absorber parte del body: las partes van separadas por salto de línea.
    expect(requestHash('POST', '/v1/a', 'b')).not.toBe(requestHash('POST', '/v1/ab', ''));
  });

  it('identificador del bloqueo: entero de 64 bits con signo, estable y distinto por tenant y por clave', () => {
    const id = idempotencyLockId('t1', 'clave-123');
    expect(typeof id).toBe('bigint');
    expect(id).toBe(idempotencyLockId('t1', 'clave-123'));
    expect(id).not.toBe(idempotencyLockId('t2', 'clave-123'));
    expect(id).not.toBe(idempotencyLockId('t1', 'clave-124'));
    expect(id >= -(2n ** 63n) && id < 2n ** 63n).toBe(true);
  });
});
