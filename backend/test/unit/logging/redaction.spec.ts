import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/common/config/load-config.js';
import { buildLoggerOptions } from '../../../src/common/logging/logger-options.js';
import { maskSensitiveText } from '../../../src/common/logging/redaction.js';
import { validEnv } from '../../support/env.js';
import { recordOutput } from '../../support/log-capture.js';

// T018 · FR-010 · SC-009: los datos sensibles nunca aparecen en la salida de log.
const SENSITIVE = {
  phone: '5512345678',
  email: 'ana.perez@example.com',
  password: 'S3cret-Pass!',
  otp: '481516',
  token: 'tok_live_abcdefghijklmnop',
  tax_id: 'GODE561231GR8',
  curp: 'GODE561231HDFRRN09',
  authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  cookie: 'sid=abcdef123456',
};

function capture(level = 'info'): { logger: pino.Logger; lines: () => string } {
  let buffer = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      buffer += chunk.toString();
      recordOutput(chunk.toString()); // SC-009 · T102: captura de la suite
      done();
    },
  });
  const logger = pino(buildLoggerOptions(loadConfig(validEnv({ LOG_LEVEL: level }))), stream);
  return { logger, lines: () => buffer };
}

describe('redacción de datos sensibles en logs (T018)', () => {
  it('no emite teléfono, correo, contraseña, OTP, token, identificadores fiscales ni encabezados de autorización', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        phone: SENSITIVE.phone,
        email: SENSITIVE.email,
        password: SENSITIVE.password,
        otp: SENSITIVE.otp,
        token: SENSITIVE.token,
        tax_id: SENSITIVE.tax_id,
        curp: SENSITIVE.curp,
        customer: { contact: { phone: SENSITIVE.phone, email: SENSITIVE.email } },
        req: { headers: { authorization: SENSITIVE.authorization, cookie: SENSITIVE.cookie } },
      },
      'registro de prueba',
    );
    const output = lines();
    for (const [name, value] of Object.entries(SENSITIVE)) {
      expect(output, name).not.toContain(value);
    }
    expect(output).toContain('[REDACTED]');
  });

  it('enmascara correos y teléfonos en mensajes libres y en textos no previstos', () => {
    const { logger, lines } = capture();
    logger.info(
      { note: `escribir a ${SENSITIVE.email}` },
      `cliente llamó desde +52 55 1234 5678 y desde ${SENSITIVE.phone}`,
    );
    const output = lines();
    expect(output).not.toContain(SENSITIVE.email);
    expect(output).not.toContain('55 1234 5678');
    expect(output).not.toContain(SENSITIVE.phone);
    expect(output).toContain('[REDACTED:phone]');
    expect(output).toContain('[REDACTED:email]');
  });

  it('no altera identificadores de correlación ni UUID con grupos numéricos', () => {
    const uuid = '01934d5e-1234-7123-8123-123456789012';
    const { logger, lines } = capture();
    logger.info({ correlation_id: uuid, entity_id: uuid }, `procesado ${uuid}`);
    expect(lines().split(uuid).length - 1).toBe(3);
  });

  it('emite JSON con nivel textual y marca de tiempo ISO', () => {
    const { logger, lines } = capture();
    logger.warn('hola');
    const record = JSON.parse(lines().trim()) as Record<string, unknown>;
    expect(record).toMatchObject({ level: 'warn', msg: 'hola', service: 'kuota-core', env: 'local' });
    expect(String(record['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('maskSensitiveText enmascara solo patrones sensibles', () => {
    expect(maskSensitiveText('sin datos')).toBe('sin datos');
    expect(maskSensitiveText('tel 55-1234-5678')).toBe('tel [REDACTED:phone]');
    expect(maskSensitiveText('pedido 12345')).toBe('pedido 12345');
  });
});
