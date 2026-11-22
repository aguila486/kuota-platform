import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import type { AppConfig } from './common/config/app-config.js';
import { ConfigValidationError, loadConfig } from './common/config/load-config.js';

/**
 * Proceso de Kuota Core. La configuración se valida ANTES de crear Nest (T016/T025): si es inválida, el proceso termina
 * con código 1 y una línea JSON que nombra las variables y las reglas incumplidas, nunca sus valores.
 */
async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) throw error;
    process.stderr.write(
      `${JSON.stringify({ level: 'fatal', service: 'kuota-core', msg: 'Configuración inválida: el servicio no arranca', issues: error.issues })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const app = await createApp(config);
  await app.listen(config.port);
}

void main();
