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
  // T100: dominio y common/money (listas de permitidos), con distintas formas de importar.
  'src/modules/a/domain/entidad.ts':
    "import { Money } from '../../../common/money/index.js';\nexport const e = Money;\n",
  'src/modules/a/domain/ok.ts':
    "import { e } from './entidad.js';\nimport { randomUUID } from 'node:crypto';\nexport const x = [e, randomUUID];\n",
  'src/modules/a/domain/usa-nest.ts': "import { Injectable } from '@nestjs/common';\nexport const x = Injectable;\n",
  'src/modules/a/domain/tipo-nest.ts': "import type { Logger } from '@nestjs/common';\nexport type L = Logger;\n",
  'src/modules/a/domain/reexporta.ts': "export * from 'pino';\n",
  'src/modules/a/domain/usa-http.ts': "import { request } from 'node:http';\nexport const x = request;\n",
  'src/modules/a/domain/usa-https-sin-prefijo.ts': "import * as https from 'https';\nexport const x = https;\n",
  'src/modules/a/domain/dinamico.ts': "export const load = () => import('node:net');\n",
  'src/modules/a/domain/dinamico-pg.ts': "export const load = () => import('pg');\n",
  'src/modules/a/domain/no-resuelve.ts': "import axios from 'axios';\nexport const x = axios;\n",
  'src/modules/a/domain/usa-fs.ts': "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
  'src/modules/a/domain/usa-infra.ts': "import { r } from '../infrastructure/repo.js';\nexport const x = r;\n",
  'src/modules/a/infrastructure/repo.ts': 'export const r = 1;\n',
  'src/modules/a/domain/usa-contexto.ts':
    "import { establishTenantContext } from '../../../common/tenant-context/establish-context.js';\nexport const x = establishTenantContext;\n",
  'src/modules/a/domain/otro-dominio.ts': "import { y } from '../../b/domain/y.js';\nexport const x = y;\n",
  'src/modules/b/domain/y.ts': 'export const y = 1;\n',
  'src/common/money/index.ts': "export { Money } from './money.js';\n",
  'src/common/money/money.ts':
    "import { Decimal } from 'decimal.js';\nimport { p } from '../errors/problem.js';\nexport const Money = [Decimal, p];\n",
  'src/common/money/usa-logging.ts': "import { l } from '../logging/log.js';\nexport const x = l;\n",
  'src/common/logging/log.ts': 'export const l = 1;\n',
  'src/common/money/usa-red.ts': "import { connect } from 'net';\nexport const x = connect;\n",
  'src/common/money/usa-prisma.ts': "import { Prisma } from '@prisma/client';\nexport const x = Prisma;\n",
  'src/common/errors/problem.ts': "import { l } from '../logging/log.js';\nexport const p = l;\n",
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
    // T100
    ['src/modules/a/domain/usa-nest.ts', ['domain-sin-framework', 'dominio-puro-solo-paquetes-permitidos']],
    ['src/modules/a/domain/tipo-nest.ts', ['domain-sin-framework', 'dominio-puro-solo-paquetes-permitidos']],
    ['src/modules/a/domain/reexporta.ts', ['dominio-puro-solo-paquetes-permitidos']],
    ['src/modules/a/domain/usa-http.ts', ['dominio-puro-sin-red-ni-sistema']],
    ['src/modules/a/domain/usa-https-sin-prefijo.ts', ['dominio-puro-sin-red-ni-sistema']],
    ['src/modules/a/domain/dinamico.ts', ['dominio-puro-sin-red-ni-sistema']],
    ['src/modules/a/domain/dinamico-pg.ts', ['domain-sin-framework', 'dominio-puro-solo-paquetes-permitidos']],
    ['src/modules/a/domain/no-resuelve.ts', ['dominio-puro-sin-dependencias-no-resueltas']],
    ['src/modules/a/domain/usa-fs.ts', ['dominio-puro-sin-red-ni-sistema']],
    ['src/modules/a/domain/usa-infra.ts', ['domain-sin-capas-externas', 'dominio-solo-codigo-propio']],
    [
      'src/modules/a/domain/usa-contexto.ts',
      ['contexto-solo-lo-establece-tenant-context', 'dominio-solo-codigo-propio'],
    ],
    ['src/modules/a/domain/otro-dominio.ts', ['dominio-solo-codigo-propio', 'modulos-solo-api-publica']],
    ['src/common/money/usa-logging.ts', ['money-solo-codigo-propio']],
    ['src/common/money/usa-red.ts', ['dominio-puro-sin-red-ni-sistema']],
    ['src/common/money/usa-prisma.ts', ['cliente-prisma-solo-tenant-context', 'dominio-puro-solo-paquetes-permitidos']],
    ['src/common/errors/problem.ts', ['problema-sin-dependencias']],
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
      // T100: dominio que usa su propio dominio, common/money y node:crypto; money con decimal.js y problem.ts.
      'src/modules/a/domain/ok.ts',
      'src/modules/a/domain/entidad.ts',
      'src/common/money/money.ts',
      'src/common/money/index.ts',
    ]) {
      expect(rulesFor(file), file).toEqual([]);
    }
  });
});
