import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const BACKEND_DIR = join(__dirname, '../..');
// Dentro de backend/node_modules: ignorado por git y Node resuelve desde ahí las dependencias del backend.
const CACHE = join(BACKEND_DIR, 'node_modules/.cache');
const LOCK = join(CACHE, 'kuota-nest-build.lock');
const BUILD_TIMEOUT_MS = 120_000;

export interface BuiltMain {
  /** Ruta del `main.js` compilado, en una copia privada de `dist/` para la suite que lo pidió. */
  main: string;
  cleanup: () => void;
}

/**
 * Compila el backend con `nest build` (SWC) y devuelve una copia privada del resultado (T025, T096).
 * `nest build` borra `dist/` antes de compilar (`deleteOutDir`); Vitest ejecuta los archivos de prueba en paralelo,
 * así que la compilación de una suite podía borrar el `dist/main.js` que otra estaba arrancando. Las compilaciones se
 * serializan con un candado de directorio y cada suite ejecuta su propia copia, que ninguna compilación posterior toca.
 */
export async function buildPrivateMain(): Promise<BuiltMain> {
  mkdirSync(CACHE, { recursive: true });
  await acquireLock();
  try {
    await promisify(execFile)(join(BACKEND_DIR, 'node_modules/.bin/nest'), ['build'], {
      cwd: BACKEND_DIR,
      timeout: BUILD_TIMEOUT_MS,
    });
    const dir = mkdtempSync(join(CACHE, 'kuota-test-dist-'));
    cpSync(join(BACKEND_DIR, 'dist'), dir, { recursive: true });
    return { main: join(dir, 'main.js'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

async function acquireLock(): Promise<void> {
  const deadline = Date.now() + BUILD_TIMEOUT_MS + 50_000;
  for (;;) {
    try {
      mkdirSync(LOCK);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    // Un candado más antiguo que el tiempo máximo de compilación quedó de una ejecución interrumpida.
    if (lockAgeMs() > BUILD_TIMEOUT_MS + 10_000) rmSync(LOCK, { recursive: true, force: true });
    if (Date.now() > deadline) throw new Error('no se obtuvo el candado de compilación del backend');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function lockAgeMs(): number {
  try {
    return Date.now() - statSync(LOCK).mtimeMs;
  } catch {
    return 0; // liberado entre el intento y la consulta
  }
}
