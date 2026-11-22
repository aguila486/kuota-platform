/**
 * Reglas de gobernanza de migraciones (ADR-0004, condiciones P1 y P4).
 *
 * P1: toda migración declara su transacción: primera sentencia `BEGIN;` y última `COMMIT;`. Las operaciones que
 * PostgreSQL no permite dentro de una transacción (p. ej. CREATE INDEX CONCURRENTLY) van en una migración propia
 * marcada con `-- kuota:non-transactional: <justificación y plan de recuperación>`, que exige revisión explícita.
 */
export const NON_TRANSACTIONAL_MARKER = /^--\s*kuota:non-transactional:\s*\S.{9,}$/m;

const NON_TRANSACTIONAL_STATEMENTS =
  /\b(CREATE|DROP)\s+INDEX\s+CONCURRENTLY\b|\bREINDEX\b[^;]*\bCONCURRENTLY\b|\bVACUUM\b|\b(CREATE|DROP)\s+DATABASE\b|\bALTER\s+SYSTEM\b/i;

export function migrationViolations(sql: string): string[] {
  const statements = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('--'));
  const violations: string[] = [];
  const nonTransactional = NON_TRANSACTIONAL_MARKER.test(sql);
  if (nonTransactional) {
    if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql))
      violations.push('una migración no transaccional no puede contener BEGIN/COMMIT');
  } else {
    if (statements[0] !== 'BEGIN;') violations.push('la primera sentencia debe ser BEGIN;');
    if (statements.at(-1) !== 'COMMIT;') violations.push('la última sentencia debe ser COMMIT;');
    if (NON_TRANSACTIONAL_STATEMENTS.test(sql)) {
      violations.push('contiene operaciones que no admiten transacción: requiere migración propia y marcada');
    }
  }
  if (/\bPASSWORD\b/i.test(sql)) violations.push('no debe contener contraseñas');
  if (/\b(BYPASSRLS|NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY|DISABLE\s+ROW\s+LEVEL\s+SECURITY)\b/i.test(sql)) {
    violations.push('no puede conceder BYPASSRLS ni desactivar RLS/FORCE sin una decisión aprobada');
  }
  return violations;
}

/** Comandos de Prisma que modifican el esquema sin migración revisada (P4). */
export const FORBIDDEN_PRISMA_COMMANDS = /\bprisma\s+(db\s+push|migrate\s+(dev|reset))\b/;
