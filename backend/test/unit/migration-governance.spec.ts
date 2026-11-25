import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PRISMA_COMMANDS, migrationViolations } from '../support/migration-rules.js';

const BACKEND_DIR = join(__dirname, '../..');
const MIGRATIONS_DIR = join(BACKEND_DIR, 'prisma/migrations');

describe('P1/P4 — gobernanza de migraciones (estático)', () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  it('hay migraciones versionadas', () => {
    expect(migrations).toContain('0001_foundation');
  });

  for (const name of migrations) {
    it(`${name} cumple la convención (transacción explícita, sin contraseñas, sin debilitar RLS)`, () => {
      expect(migrationViolations(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))).toEqual([]);
    });
  }

  it('las reglas rechazan migraciones defectuosas (pruebas negativas)', () => {
    expect(migrationViolations('CREATE TABLE kuota.x (id int);\n')).toEqual([
      'la primera sentencia debe ser BEGIN;',
      'la última sentencia debe ser COMMIT;',
    ]);
    expect(migrationViolations('BEGIN;\nCREATE INDEX CONCURRENTLY i ON kuota.x (id);\nCOMMIT;\n')).toContain(
      'contiene operaciones que no admiten transacción: requiere migración propia y marcada',
    );
    expect(migrationViolations("BEGIN;\nALTER ROLE kuota_app PASSWORD 'x';\nCOMMIT;\n")).toContain(
      'no debe contener contraseñas',
    );
    expect(migrationViolations('BEGIN;\nALTER TABLE kuota.x NO FORCE ROW LEVEL SECURITY;\nCOMMIT;\n')).toContain(
      'no puede conceder BYPASSRLS ni desactivar RLS/FORCE sin una decisión aprobada',
    );
    const marked =
      '-- kuota:non-transactional: índice concurrente; si falla, DROP INDEX CONCURRENTLY y reintentar\n' +
      'CREATE INDEX CONCURRENTLY i ON kuota.x (id);\n';
    expect(migrationViolations(marked)).toEqual([]);
    expect(migrationViolations(`${marked}BEGIN;\n`)).toContain(
      'una migración no transaccional no puede contener BEGIN/COMMIT',
    );
  });

  it('ningún script del backend ni de la raíz usa prisma db push, migrate dev ni migrate reset', () => {
    for (const file of [join(BACKEND_DIR, 'package.json'), join(BACKEND_DIR, '../package.json')]) {
      const scripts = (JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const [name, command] of Object.entries(scripts)) {
        expect(FORBIDDEN_PRISMA_COMMANDS.test(command), `${file} → ${name}`).toBe(false);
      }
    }
    expect(FORBIDDEN_PRISMA_COMMANDS.test('prisma migrate dev --name x')).toBe(true);
    expect(FORBIDDEN_PRISMA_COMMANDS.test('prisma db push')).toBe(true);
    expect(FORBIDDEN_PRISMA_COMMANDS.test('prisma migrate deploy')).toBe(false);
  });
});
