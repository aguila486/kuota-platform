import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import type { AppConfig } from './common/config/app-config.js';
import { ConfigValidationError, loadConfig } from './common/config/load-config.js';
import { MetricsRuntime } from './common/metrics/metrics.module.js';

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
  // Escucha de métricas separada y protegida (T094; FR-039, FR-040): nunca en el puerto de la API. Si no puede abrirse
  // (p. ej. puerto ocupado), el servicio no arranca a medias: termina con código 1.
  try {
    await app.get(MetricsRuntime).listen();
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? 'error';
    process.stderr.write(
      `${JSON.stringify({ level: 'fatal', service: 'kuota-core', msg: 'No se pudo abrir la escucha de métricas: el servicio no arranca', reason })}\n`,
    );
    await app.close();
    process.exitCode = 1;
  }
}

void main();
