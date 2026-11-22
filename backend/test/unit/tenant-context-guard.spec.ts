import { join } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/**
 * Condición P2 de ADR-0004: solo src/common/tenant-context puede fijar el contexto de tenant o cambiar la identidad de
 * la sesión. Estas pruebas ejecutan la configuración REAL de ESLint del backend sobre código virtual.
 *
 * Limitación conocida (no la cubre el lint): SQL armado por concatenación de fragmentos o funciones definidas en la base
 * de datos. Las defensas de fondo son RLS forzado, privilegios mínimos, consultas parametrizadas y revisión.
 */
const BACKEND_DIR = join(__dirname, '../..');
// Las reglas probadas no necesitan información de tipos; así se pueden analizar archivos que no existen en disco.
const eslint = new ESLint({
  cwd: BACKEND_DIR,
  overrideConfig: [{ files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked }],
});

async function ruleViolations(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(BACKEND_DIR, file) });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax' || m.ruleId === 'no-restricted-imports')
    .map((m) => m.ruleId!);
}

const BUSINESS_FILE = 'src/modules/probe/infrastructure/probe.repository.ts';
const TENANT_CONTEXT_FILE = 'src/common/tenant-context/tenant-prisma.service.ts';

const FORBIDDEN: Record<string, string> = {
  'set_config en SQL de plantilla':
    "declare const tx: any; declare const t: string;\ntx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true)`;\n",
  'SET LOCAL app.tenant_id en literal': 'export const sql = "SET LOCAL app.tenant_id = \'otro\'";\n',
  'referencia a app.tenant_id': 'export const sql = "SELECT current_setting(\'app.tenant_id\')";\n',
  'SET ROLE': 'declare const tx: any;\ntx.$executeRaw`SET ROLE kuota_migrator`;\n',
  'SET SESSION AUTHORIZATION': "export const sql = 'SET SESSION AUTHORIZATION kuota_migrator';\n",
  'SET row_security = off': "export const sql = 'SET row_security = off';\n",
  'RESET ALL': "export const sql = 'RESET ALL';\n",
  '$executeRawUnsafe (SQL dinámico)':
    'declare const prisma: any; declare const q: string;\nprisma.$executeRawUnsafe(q);\n',
  '$queryRawUnsafe (SQL dinámico)': 'declare const prisma: any; declare const q: string;\nprisma.$queryRawUnsafe(q);\n',
  'Prisma.raw (SQL dinámico)':
    'declare const Prisma: any; declare const q: string;\nexport const frag = Prisma.raw(q);\n',
  'conexión directa con pg': "import { Pool } from 'pg';\nexport const pool = new Pool();\n",
  'cliente Prisma crudo': "import { PrismaClient } from '@prisma/client';\nexport const client = new PrismaClient();\n",
};

describe('P2 — protección del contexto de tenant (ESLint)', () => {
  for (const [name, code] of Object.entries(FORBIDDEN)) {
    it(`rechaza en un módulo de negocio: ${name}`, async () => {
      expect(await ruleViolations(code, BUSINESS_FILE)).not.toHaveLength(0);
    });
  }

  it('permite fijar el contexto dentro de src/common/tenant-context', async () => {
    const code =
      "import { Pool } from 'pg';\nexport const pool = new Pool();\ndeclare const tx: any; declare const t: string;\n" +
      "tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true)`;\n";
    expect(await ruleViolations(code, TENANT_CONTEXT_FILE)).toEqual([]);
  });

  it('permite SQL parametrizado normal en un módulo de negocio', async () => {
    const code =
      'declare const tx: any; declare const id: string;\ntx.$queryRaw`SELECT id, label FROM kuota.dev_probe_items WHERE id = ${id}`;\n';
    expect(await ruleViolations(code, BUSINESS_FILE)).toEqual([]);
  });
});
