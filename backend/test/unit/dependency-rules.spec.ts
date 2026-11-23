import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Reglas de dependency-cruiser (T010, T028, G7a) ejecutadas con la configuración REAL sobre un árbol temporal con
 * violaciones deliberadas: cada regla debe dispararse, y las dependencias permitidas no deben generar violaciones.
 */
const BACKEND_DIR = join(__dirname, '../..');
let root: string;

const FILES: Record<string, string> = {
  'src/modules/a/index.ts': "export * from './a.service.js';\n",
  'src/modules/a/a.service.ts': 'export const a = 1;\n',
  'src/modules/b/index.ts': 'export const b = 1;\n',
  'src/modules/b/internal.ts': 'export const internal = 1;\n',
  'src/modules/a/ok-otro-modulo.ts': "import { b } from '../b/index.js';\nexport const x = b;\n",
  'src/modules/a/import-profundo.ts': "import { internal } from '../b/internal.js';\nexport const x = internal;\n",
  'src/modules/a/import-propio-index.ts': "import { a } from './index.js';\nexport const x = a;\n",
  'src/modules/a/usa-generado.ts':
    "import { PrismaClient } from '../../generated/prisma/client.js';\nexport const x = PrismaClient;\n",
  'src/modules/a/usa-prisma.ts': "import { PrismaPg } from '@prisma/adapter-pg';\nexport const x = PrismaPg;\n",
  'src/modules/a/usa-sonda.ts':
    "import { DATABASE_PROBE } from '../../common/database/database-probe.js';\nexport const x = DATABASE_PROBE;\n",
  'src/common/otro/fija-contexto.ts':
    "import { establishTenantContext } from '../tenant-context/establish-context.js';\nexport const x = establishTenantContext;\n",
  'src/common/tenant-context/establish-context.ts': 'export const establishTenantContext = 1;\n',
  'src/common/tenant-context/ok-servicio.ts':
    "import { PrismaClient } from '../../generated/prisma/client.js';\nimport { establishTenantContext } from './establish-context.js';\nexport const x = [PrismaClient, establishTenantContext];\n",
  'src/common/database/database-probe.ts': 'export const DATABASE_PROBE = 1;\n',
  'src/modules/health/ok-sonda.ts':
    "import { DATABASE_PROBE } from '../../common/database/database-probe.js';\nexport const x = DATABASE_PROBE;\n",
  'src/generated/prisma/client.ts': 'export const PrismaClient = 1;\n',
};

interface Violation {
  from: string;
  rule: { name: string };
}
let violations: Violation[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kuota-depcruise-'));
  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  cpSync(join(BACKEND_DIR, '.dependency-cruiser.cjs'), join(root, '.dependency-cruiser.cjs'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } }),
  );
  symlinkSync(join(BACKEND_DIR, 'node_modules'), join(root, 'node_modules'));
  const bin = join(BACKEND_DIR, 'node_modules/.bin/depcruise');
  const output = await promisify(execFile)(
    bin,
    ['src', '--config', '.dependency-cruiser.cjs', '--output-type', 'json'],
    {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    },
  ).catch((error: { stdout: string }) => ({ stdout: error.stdout }));
  violations = (JSON.parse(output.stdout) as { summary: { violations: Violation[] } }).summary.violations;
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const rulesFor = (from: string) =>
  violations
    .filter((v) => v.from === from)
    .map((v) => v.rule.name)
    .sort();

describe('reglas de dependencias (configuración real)', () => {
  const EXPECTED: Array<[string, string[]]> = [
    ['src/modules/a/import-profundo.ts', ['modulos-solo-api-publica']],
    ['src/modules/a/import-propio-index.ts', ['modulo-no-importa-su-propio-index']],
    ['src/modules/a/usa-generado.ts', ['cliente-prisma-solo-tenant-context']],
    ['src/modules/a/usa-prisma.ts', ['cliente-prisma-solo-tenant-context']],
    ['src/modules/a/usa-sonda.ts', ['sonda-bd-solo-health']],
    ['src/common/otro/fija-contexto.ts', ['contexto-solo-lo-establece-tenant-context']],
  ];
  for (const [file, rules] of EXPECTED) {
    it(`${file} → ${rules.join(', ')}`, () => {
      expect(rulesFor(file)).toEqual(rules);
    });
  }

  it('las dependencias permitidas no generan violaciones', () => {
    for (const file of [
      'src/modules/a/ok-otro-modulo.ts',
      'src/common/tenant-context/ok-servicio.ts',
      'src/modules/health/ok-sonda.ts',
      'src/modules/a/index.ts',
    ]) {
      expect(rulesFor(file), file).toEqual([]);
    }
  });
});
