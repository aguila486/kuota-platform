import { Logger } from '@nestjs/common';
import pino from 'pino';
import { it } from 'vitest';
import { createApp } from '../../../src/bootstrap.js';
import { loadConfig } from '../../../src/common/config/load-config.js';
import { logCapture, recordOutput, registerSensitiveValue, SENSITIVE_TEST_VALUES } from '../../support/log-capture.js';
import { validEnv } from '../../support/env.js';

/**
 * Autoverificación del gate SC-009 (T102): fugas DELIBERADAS por cada vía de captura. Solo se ejecuta con
 * `KUOTA_LOG_PRIVACY_SELFTEST=1` (scripts/ci/tests/log-privacy.test.sh); la suite normal nunca la incluye. La prueba
 * pasa; lo que debe fallar es la comprobación final del `globalSetup`, nombrando cada valor sin imprimirlo.
 */
it('fugas deliberadas por cada vía de captura', async () => {
  // 1. Stream en memoria de una prueba.
  const capture = logCapture();
  pino({}, capture.stream).info({ note: `cliente ${SENSITIVE_TEST_VALUES['CURP']}` }, 'fuga por stream');
  // 2. Logs de una app real sin stream propio (pino → descriptor 1 del worker), por un log de aplicación.
  const app = await createApp(loadConfig(validEnv({ LOG_LEVEL: 'info' })));
  // Un dato que la redacción no reconoce (defecto simulado: un log nuevo que vuelca un campo arbitrario).
  new Logger('Fuga').log(
    { dato: SENSITIVE_TEST_VALUES['dato arbitrario de encabezado'] },
    'fuga por log de aplicación',
  );
  await app.close();
  // 3. Salida de un proceso hijo leída por la prueba.
  recordOutput(`salida de script con ${SENSITIVE_TEST_VALUES['contraseña de URL de base de datos']}`);
  // 4. Valor registrado en ejecución (como las contraseñas de las bases efímeras), en su forma codificada en URL.
  registerSensitiveValue('contraseña generada de prueba', 'gener@da/secreta+1');
  process.stdout.write(`url postgresql://u:${encodeURIComponent('gener@da/secreta+1')}@h/db\n`);
});
