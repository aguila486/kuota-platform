import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vitest 5 + SWC (research R-03): SWC emite los metadatos de decoradores que necesita la inyección de NestJS.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2024',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    // `pnpm spike:rls` (T014) ejecuta solo el spike; el resto de comandos, solo las pruebas.
    include: process.env['KUOTA_SPIKE'] === '1' ? ['scripts/spike-rls.ts'] : ['test/**/*.spec.ts'],
    testTimeout: process.env['KUOTA_SPIKE'] === '1' ? 300_000 : 15_000,
    // Las pruebas con Testcontainers incluyen el arranque del contenedor.
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts solo arranca el proceso; se verifica con el arranque real, no con cobertura.
      exclude: ['src/main.ts', 'src/generated/**'],
      reporter: ['text', 'json-summary'],
      // Constitución X: dominio financiero >= 90 %, resto >= 80 %.
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/common/money/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        '**/domain/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
