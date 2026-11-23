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

  it('T028: la sonda de conectividad puede importar pg, pero no Prisma ni fijar contexto', async () => {
    const probe = 'src/common/database/pg-connectivity-probe.ts';
    expect(await ruleViolations("import { Pool } from 'pg';\nexport const p = new Pool();\n", probe)).toEqual([]);
    expect(await ruleViolations(FORBIDDEN['cliente Prisma crudo']!, probe)).not.toHaveLength(0);
    expect(await ruleViolations(FORBIDDEN['set_config en SQL de plantilla']!, probe)).not.toHaveLength(0);
    expect(await ruleViolations(FORBIDDEN['SET ROLE']!, probe)).not.toHaveLength(0);
  });

  it('T028: la excepción de pg no se extiende a otros archivos de common/database ni a health', async () => {
    const code = "import { Pool } from 'pg';\nexport const p = new Pool();\n";
    expect(await ruleViolations(code, 'src/common/database/otro.ts')).not.toHaveLength(0);
    expect(await ruleViolations(code, 'src/modules/health/database.health.ts')).not.toHaveLength(0);
  });

  const CONTEXT_WRITES: Record<string, string> = {
    "cls.set('tenantId')": "declare const cls: any;\ncls.set('tenantId', 'x');\n",
    "cls.set('actorId')": "declare const cls: any;\ncls.set('actorId', 'x');\n",
    "cls.set('actorRole')": "declare const cls: any;\ncls.set('actorRole', 'admin');\n",
    "cls.setIfUndefined('actorType')": "declare const cls: any;\ncls.setIfUndefined('actorType', 'USER');\n",
    'cls.set(CLS_TENANT_ID)':
      "declare const cls: any; declare const CLS_TENANT_ID: string;\ncls.set(CLS_TENANT_ID, 'x');\n",
    'importar establishTenantContext':
      "import { establishTenantContext } from '../../common/tenant-context/establish-context.js';\nexport const f = establishTenantContext;\n",
    'importar el cliente Prisma generado':
      "import { PrismaClient } from '../../../generated/prisma/client.js';\nexport const c = PrismaClient;\n",
  };
  for (const [name, code] of Object.entries(CONTEXT_WRITES)) {
    it(`T038: rechaza fuera de tenant-context: ${name}`, async () => {
      expect(await ruleViolations(code, BUSINESS_FILE)).not.toHaveLength(0);
      expect(await ruleViolations(code, 'src/common/database/otro.ts')).not.toHaveLength(0);
    });
  }

  it('T038: dentro de tenant-context sí se puede fijar el contexto', async () => {
    const code = "declare const cls: any; declare const CLS_TENANT_ID: string;\ncls.set(CLS_TENANT_ID, 'x');\n";
    expect(await ruleViolations(code, 'src/common/tenant-context/otro-guard.ts')).toEqual([]);
  });

  it('T038: leer el contexto o escribir otras claves del CLS está permitido', async () => {
    const code = "declare const cls: any;\ncls.get('tenantId');\ncls.set('correlationIdExtra', 'x');\n";
    expect(await ruleViolations(code, BUSINESS_FILE)).toEqual([]);
  });

  // LÍMITES CONOCIDOS del control estático (auditoría P2): estos patrones NO se detectan. Las pruebas fijan el hueco para
  // que no se dé por cubierto; si una regla futura los detecta, deben actualizarse.
  const KNOWN_GAPS: Record<string, string> = {
    'SQL armado por concatenación en un TemplateStringsArray fabricado':
      "declare const tx: any;\nconst q = Object.assign(['SELECT set_' + 'config($1, $2, true)'], { raw: ['x'] });\ntx.$queryRaw(q, 'app.' + 'tenant_id', 'x');\n",
    'SET search_path (no está en la lista de SET prohibidos)':
      'declare const tx: any;\ntx.$executeRaw`SET LOCAL search_path = pg_temp, kuota`;\n',
  };
  for (const [name, code] of Object.entries(KNOWN_GAPS)) {
    it(`LÍMITE conocido (no detectado por lint): ${name}`, async () => {
      expect(await ruleViolations(code, BUSINESS_FILE)).toEqual([]);
    });
  }

  // R3 (P2): retener el cliente transaccional más allá de su operación.
  const TX = 'type TenantTransaction = { readonly id: string };\n';
  const RETAINED_TX: Record<string, string> = {
    'campo de clase': `${TX}export class Repo {\n  private tx?: TenantTransaction;\n}\n`,
    'campo estático (singleton)': `${TX}export class Holder {\n  static current: TenantTransaction | undefined;\n}\n`,
    'propiedad de parámetro del constructor': `${TX}export class Repo {\n  constructor(private readonly tx: TenantTransaction) {}\n}\n`,
    'variable de módulo': `${TX}let current: TenantTransaction | undefined;\nexport const get = () => current;\n`,
    'variable de módulo exportada': `${TX}export let current: TenantTransaction | null = null;\n`,
    'colección en un campo': `${TX}export class Cache {\n  readonly all: Map<string, TenantTransaction> = new Map();\n}\n`,
  };
  for (const [name, code] of Object.entries(RETAINED_TX)) {
    it(`R3: rechaza retener TenantTransaction (${name})`, async () => {
      expect(await ruleViolations(code, BUSINESS_FILE)).toEqual(['no-restricted-syntax']);
      expect(await ruleViolations(code, TENANT_CONTEXT_FILE)).toEqual([]);
    });
  }

  it('R3: permite TenantTransaction como parámetro, variable local o tipo de callback', async () => {
    const code =
      `${TX}export async function find(tx: TenantTransaction): Promise<string> {\n  const local: TenantTransaction = tx;\n  return local.id;\n}\n` +
      'export class Uow {\n  private readonly run?: (tx: TenantTransaction) => Promise<void>;\n}\n' +
      'export const handler = (tx: TenantTransaction): string => tx.id;\n';
    expect(await ruleViolations(code, BUSINESS_FILE)).toEqual([]);
  });

  const RETAINED_TX_GAPS: Record<string, string> = {
    'asignación a un campo sin anotación de tipo': `${TX}export class Repo {\n  private tx: any;\n  use(tx: TenantTransaction) {\n    this.tx = tx;\n  }\n}\n`,
    'alias del tipo': `${TX}type Tx = TenantTransaction;\nexport class Repo {\n  private tx?: Tx;\n}\n`,
    'cierre que captura el cliente': `${TX}export let later: () => unknown;\nexport function keep(tx: TenantTransaction) {\n  later = () => tx.id;\n}\n`,
  };
  for (const [name, code] of Object.entries(RETAINED_TX_GAPS)) {
    it(`LÍMITE conocido R3 (no detectado por lint; lo cubre el control en tiempo de ejecución): ${name}`, async () => {
      expect(await ruleViolations(code, BUSINESS_FILE)).toEqual([]);
    });
  }

  it('permite SQL parametrizado normal en un módulo de negocio', async () => {
    const code =
      'declare const tx: any; declare const id: string;\ntx.$queryRaw`SELECT id, label FROM kuota.dev_probe_items WHERE id = ${id}`;\n';
    expect(await ruleViolations(code, BUSINESS_FILE)).toEqual([]);
  });
});
