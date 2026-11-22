import { defineConfig } from 'prisma/config';

/**
 * Configuración de Prisma para el spike T014 (ADR-0004). Solo la usa la CLI (migraciones e introspección):
 * - La URL es la del rol de MIGRACIÓN (kuota_migrator) y se lee del entorno; nunca se versiona.
 * - El runtime no usa este archivo: el cliente recibe su propia URL (kuota_app_login) mediante el adaptador pg.
 * - KUOTA_PRISMA_MIGRATIONS_DIR solo existe para que el spike pruebe migraciones fallidas en una copia temporal.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: process.env['KUOTA_PRISMA_MIGRATIONS_DIR'] ?? 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL_MIGRATOR'] ?? '',
  },
});
