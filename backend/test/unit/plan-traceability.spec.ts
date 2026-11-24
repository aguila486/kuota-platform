import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T105 (Constitución I): todo artefacto de base de datos y todo script operativo del backend debe figurar en la
 * estructura de `plan.md` de 001. Si se añade una migración, un script de `backend/scripts/` o un script de
 * aprovisionamiento de `infra/docker/postgres/init/` sin registrarlo en el plan, esta prueba falla.
 */
const ROOT = join(__dirname, '../../..');
const PLAN = readFileSync(join(ROOT, 'specs/001-platform-foundation/plan.md'), 'utf8');

function entries(dir: string, filter: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir)).filter(filter).sort();
}

export function untraced(plan: string, names: readonly string[]): string[] {
  return names.filter((name) => !plan.includes(name));
}

describe('trazabilidad de la estructura de plan.md (T105)', () => {
  const groups: Array<[string, string[]]> = [
    ['migraciones', entries('backend/prisma/migrations', (name) => /^\d{4}_/.test(name))],
    ['scripts del backend', entries('backend/scripts', (name) => name.endsWith('.ts'))],
    ['aprovisionamiento de PostgreSQL', entries('infra/docker/postgres/init', (name) => name.endsWith('.sql'))],
  ];

  for (const [group, names] of groups) {
    it(`toda pieza de ${group} figura en plan.md`, () => {
      expect(names.length, group).toBeGreaterThan(0);
      expect(untraced(PLAN, names)).toEqual([]);
    });
  }

  it('detecta una pieza no registrada (control negativo)', () => {
    expect(untraced(PLAN, ['0004_no_registrada', 'scripts-fantasma.ts'])).toEqual([
      '0004_no_registrada',
      'scripts-fantasma.ts',
    ]);
    const sinPreflight = PLAN.replaceAll('migration-preflight.ts', '');
    expect(untraced(sinPreflight, ['migration-preflight.ts'])).toEqual(['migration-preflight.ts']);
  });
});
