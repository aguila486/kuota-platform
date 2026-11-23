import { describe, expect, it } from 'vitest';
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_EXPOSED_HEADERS,
  corsOptionsFor,
} from '../../../src/common/http/cors.js';

describe('corsOptionsFor (Aprobación 8)', () => {
  it('sin orígenes, CORS desactivado', () => {
    expect(corsOptionsFor({ cors: { allowedOrigins: [] } })).toBeUndefined();
  });

  it('lista exacta, solo GET, encabezados del contrato y sin credenciales', () => {
    const options = corsOptionsFor({ cors: { allowedOrigins: ['http://localhost:8080'] } });
    expect(options).toEqual({
      origin: ['http://localhost:8080'],
      methods: ['GET'],
      allowedHeaders: ['X-Correlation-Id', 'X-App-Version'],
      exposedHeaders: ['X-Correlation-Id'],
      credentials: false,
      maxAge: 600,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });
    // Nunca `true` (reflejar cualquier origen), comodín ni expresiones regulares.
    expect(options?.origin).not.toBe(true);
    expect(CORS_ALLOWED_METHODS).toEqual(['GET']);
    expect(CORS_ALLOWED_HEADERS.map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(CORS_EXPOSED_HEADERS).toEqual(['X-Correlation-Id']);
  });
});
