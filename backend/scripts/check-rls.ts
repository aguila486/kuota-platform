/**
 * Verificador de catálogo `db:check-rls` (T043; FR-015; US2-4; data-model.md §Verificación automática de RLS).
 *
 * Falla (exit 1) y nombra cada violación si en el esquema revisado (por defecto `kuota`):
 * - [T043] una tabla con columna `tenant_id` no tiene RLS habilitado, no lo tiene forzado o no tiene políticas;
 * - una política de esa tabla no compara `tenant_id` con `app.tenant_id` (en USING y en WITH CHECK) o no aplica a
 *   `kuota_app`;
 * - su propietario no es `kuota_migrator` (C4-1), o PUBLIC tiene privilegios, o un rol de runtime tiene `TRUNCATE`
 *   (ignora RLS) o `TRIGGER`;
 * - un rol de runtime (`kuota_app`, `kuota_app_login`) es superusuario, tiene BYPASSRLS, es propietario de objetos del
 *   esquema o puede crear objetos en él o en `public`.
 * Lista blanca de tablas sin tenant: vacía en 001 (toda excepción futura se declara aquí con justificación).
 *
 * No sustituye la validación del esquema efectivo contra las migraciones (P4, pruebas de gobernanza de migraciones).
 *
 * Uso: `pnpm --filter backend db:check-rls [--schema <nombre>]`. Conexión: `DATABASE_URL_CHECK` o, si no está,
 * `DATABASE_URL_APP` (solo lee el catálogo).
 */
import { Client } from 'pg';

export const TENANT_TABLE_ALLOWLIST: readonly string[] = [];
export const RUNTIME_ROLES = ['kuota_app', 'kuota_app_login'] as const;
export const EXPECTED_OWNER = 'kuota_migrator';
const POLICY_ROLE = 'kuota_app';

export interface Queryable {
  query<R extends object>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface CheckRlsOptions {
  readonly schema?: string;
  readonly allowlist?: readonly string[];
}

interface TableRow {
  table: string;
  owner: string;
  rls: boolean;
  force: boolean;
  public_privs: string | null;
}
interface PolicyRow {
  table: string;
  policy: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
  cmd: string;
}

/** Devuelve la lista de violaciones (vacía si todo cumple). Solo lee el catálogo. */
export async function checkRls(db: Queryable, options: CheckRlsOptions = {}): Promise<string[]> {
  const schema = options.schema ?? 'kuota';
  const allowlist = new Set(options.allowlist ?? TENANT_TABLE_ALLOWLIST);
  const violations: string[] = [];

  const tables = (
    await db.query<TableRow>(
      `SELECT c.relname AS table, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls,
              c.relforcerowsecurity AS force,
              (SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
                 FROM aclexplode(c.relacl) a WHERE a.grantee = 0) AS public_privs
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY c.relname`,
      [schema],
    )
  ).rows.filter((t) => !allowlist.has(t.table));

  const policies = (
    await db.query<PolicyRow>(
      `SELECT c.relname AS table, p.polname AS policy, p.polcmd::text AS cmd,
              ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r)::text END FROM unnest(p.polroles) r)::text[] AS roles,
              pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1`,
      [schema],
    )
  ).rows;

  const runtimePrivs = (
    await db.query<{ table: string; role: string; privilege: string }>(
      `SELECT c.relname AS table, r.rolname AS role, a.privilege_type AS privilege
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname = $1 AND r.rolname = ANY($2) AND a.privilege_type IN ('TRUNCATE', 'TRIGGER')`,
      [schema, RUNTIME_ROLES],
    )
  ).rows;

  for (const t of tables) {
    const name = `${schema}.${t.table}`;
    if (!t.rls) violations.push(`${name}: tiene tenant_id y RLS no está habilitado (relrowsecurity = false)`);
    if (!t.force) violations.push(`${name}: tiene tenant_id y RLS no está forzado (relforcerowsecurity = false)`);
    const own = policies.filter((p) => p.table === t.table);
    if (own.length === 0) violations.push(`${name}: tiene tenant_id y no tiene ninguna política RLS`);
    for (const p of own) {
      const usesTenant = (expr: string | null) =>
        expr !== null && /\btenant_id\b/.test(expr) && /current_setting\('app\.tenant_id'/.test(expr);
      const needsQual = p.cmd !== 'a'; // INSERT solo tiene WITH CHECK
      const needsCheck = p.cmd === '*' || p.cmd === 'a' || p.cmd === 'w';
      if (needsQual && !usesTenant(p.qual)) {
        violations.push(`${name}: la política ${p.policy} no filtra por tenant_id = app.tenant_id en USING`);
      }
      if (needsCheck && !usesTenant(p.with_check ?? p.qual)) {
        violations.push(`${name}: la política ${p.policy} no exige tenant_id = app.tenant_id en WITH CHECK`);
      }
      if (!p.roles.includes(POLICY_ROLE)) {
        violations.push(`${name}: la política ${p.policy} no aplica a ${POLICY_ROLE} (aplica a ${p.roles.join(', ')})`);
      }
    }
    if (t.owner !== EXPECTED_OWNER) violations.push(`${name}: propietario ${t.owner}; se espera ${EXPECTED_OWNER}`);
    if (t.public_privs) violations.push(`${name}: PUBLIC tiene privilegios (${t.public_privs})`);
    for (const p of runtimePrivs.filter((r) => r.table === t.table)) {
      violations.push(
        `${name}: ${p.role} tiene ${p.privilege} (TRUNCATE ignora RLS; TRIGGER no corresponde al runtime)`,
      );
    }
  }

  const roles = (
    await db.query<{
      role: string;
      superuser: boolean;
      bypassrls: boolean;
      owned: string | null;
      can_create: string | null;
    }>(
      `SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
              (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = $1 AND c.relowner = r.oid) AS owned,
              NULLIF(concat_ws(',',
                CASE WHEN has_schema_privilege(r.oid, $1, 'CREATE') THEN $1 END,
                CASE WHEN has_schema_privilege(r.oid, 'public', 'CREATE') THEN 'public' END), '') AS can_create
         FROM pg_roles r WHERE r.rolname = ANY($2) ORDER BY r.rolname`,
      [schema, RUNTIME_ROLES],
    )
  ).rows;
  for (const name of RUNTIME_ROLES) {
    if (!roles.some((r) => r.role === name)) violations.push(`rol ${name}: no existe`);
  }
  for (const r of roles) {
    if (r.superuser) violations.push(`rol ${r.role}: es superusuario`);
    if (r.bypassrls) violations.push(`rol ${r.role}: tiene BYPASSRLS`);
    if (r.owned) violations.push(`rol ${r.role}: es propietario de ${r.owned} en ${schema}`);
    if (r.can_create) violations.push(`rol ${r.role}: puede crear objetos en ${r.can_create}`);
  }
  return violations;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL_CHECK'] ?? process.env['DATABASE_URL_APP'];
  if (!url) {
    process.stderr.write('check-rls: define DATABASE_URL_CHECK o DATABASE_URL_APP\n');
    process.exit(2);
  }
  const schema = argValue('--schema') ?? 'kuota';
  const client = new Client({ connectionString: url, application_name: 'kuota-check-rls' });
  try {
    await client.connect();
    const violations = await checkRls(client, { schema });
    if (violations.length > 0) {
      process.stdout.write(`check-rls: ${violations.length} violación(es) en el esquema ${schema}:\n`);
      for (const v of violations) process.stdout.write(`  ✗ ${v}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`check-rls: esquema ${schema} conforme (lista blanca vacía)\n`);
    }
  } catch (error) {
    // Sin la URL ni detalles de conexión en la salida.
    process.stderr.write(
      `check-rls: no se pudo verificar el catálogo (${(error as { code?: string }).code ?? 'error'})\n`,
    );
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Entrada directa con `node scripts/check-rls.ts` (Node ejecuta TypeScript borrable); al importarlo, no se ejecuta.
if (process.argv[1]?.endsWith('check-rls.ts')) void main();
