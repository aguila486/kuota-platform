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
 * - [US6, 0002] el rol de mantenimiento `kuota_maintenance` (y su login) tiene más que SELECT de
 *   (tenant_id, key, expires_at) y DELETE en `idempotency_keys`, atributos elevados o pertenencia a otros roles.
 * - [T099, 0003] la auditoría de plataforma `platform_audit_events` (sin tenant) no tiene RLS habilitado y forzado, no
 *   es de `kuota_migrator`, PUBLIC o un rol de runtime tiene privilegios, sus políticas no son EXACTAMENTE la de INSERT
 *   de mantenimiento, o le faltan los triggers de sello y append-only. El mantenimiento solo puede hacer INSERT en ella.
 * Lista blanca de tablas sin tenant: vacía en 001 (toda excepción futura se declara aquí con justificación).
 * Políticas que no filtran por tenant: solo las de `MAINTENANCE_POLICIES`, con su definición EXACTA (US6, 0002).
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

/** Rol de mantenimiento (migración 0002, US6) y su identidad de conexión. */
export const MAINTENANCE_ROLE = 'kuota_maintenance';
export const MAINTENANCE_LOGIN = 'kuota_maintenance_login';
const MAINTENANCE_TABLE = 'idempotency_keys';
const MAINTENANCE_COLUMNS = ['expires_at', 'key', 'tenant_id'];

/** Auditoría de plataforma (T099, migración 0003): tabla sin tenant con controles propios. */
export const PLATFORM_AUDIT_TABLE = 'platform_audit_events';
export const PLATFORM_AUDIT_POLICY = {
  policy: 'maintenance_insert_audit',
  cmd: 'a',
  roles: [MAINTENANCE_ROLE],
  qual: null,
  with_check: "(operation = 'idempotency.purge'::text)",
} as const;
export const PLATFORM_AUDIT_TRIGGERS = [
  'platform_audit_events_append_only',
  'platform_audit_events_no_truncate',
  'platform_audit_events_stamp',
] as const;

/**
 * Únicas políticas aprobadas que no filtran por tenant: purga de claves vencidas (0002). Se aceptan solo si coinciden
 * EXACTAMENTE (tabla, nombre, comando, rol y expresión); cualquier variación se evalúa con las reglas generales y falla.
 */
export const MAINTENANCE_POLICIES = [
  { table: MAINTENANCE_TABLE, policy: 'maintenance_select_expired', cmd: 'r', qual: '(expires_at <= now())' },
  { table: MAINTENANCE_TABLE, policy: 'maintenance_delete_expired', cmd: 'd', qual: '(expires_at <= now())' },
] as const;

const isApprovedMaintenancePolicy = (p: {
  table: string;
  policy: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}) =>
  MAINTENANCE_POLICIES.some(
    (m) =>
      m.table === p.table &&
      m.policy === p.policy &&
      m.cmd === p.cmd &&
      m.qual === p.qual &&
      p.with_check === null &&
      p.roles.length === 1 &&
      p.roles[0] === MAINTENANCE_ROLE,
  );

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
    else if (own.every(isApprovedMaintenancePolicy)) {
      violations.push(
        `${name}: solo tiene políticas de mantenimiento; falta la política de tenant para ${POLICY_ROLE}`,
      );
    }
    for (const p of own.filter((policy) => !isApprovedMaintenancePolicy(policy))) {
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
  violations.push(...(await checkMaintenance(db, schema)));
  violations.push(...(await checkPlatformAudit(db, schema)));
  return violations;
}

/**
 * Privilegios efectivos del rol de mantenimiento (US6, 0002). Si el rol no existe (antes de 0002) no hay nada que
 * verificar. Comprueba atributos, pertenencias y que su único acceso sea SELECT de 3 columnas y DELETE en
 * `idempotency_keys` (vía herencia también para el login).
 */
async function checkMaintenance(db: Queryable, schema: string): Promise<string[]> {
  const violations: string[] = [];
  const roles = (
    await db.query<{
      role: string;
      superuser: boolean;
      bypassrls: boolean;
      createrole: boolean;
      createdb: boolean;
      replication: boolean;
      login: boolean;
      member_of: string | null;
    }>(
      `SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls, r.rolcreaterole AS createrole,
              r.rolcreatedb AS createdb, r.rolreplication AS replication, r.rolcanlogin AS login,
              (SELECT string_agg(g.rolname, ',' ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                WHERE m.member = r.oid) AS member_of
         FROM pg_roles r WHERE r.rolname = ANY($1)`,
      [[MAINTENANCE_ROLE, MAINTENANCE_LOGIN]],
    )
  ).rows;
  if (!roles.some((r) => r.role === MAINTENANCE_ROLE)) return violations;
  for (const r of roles) {
    for (const attr of ['superuser', 'bypassrls', 'createrole', 'createdb', 'replication'] as const) {
      if (r[attr]) violations.push(`rol ${r.role}: tiene el atributo ${attr}`);
    }
    if (r.role === MAINTENANCE_ROLE && r.login)
      violations.push(`rol ${r.role}: es un rol de privilegios y no debe tener LOGIN`);
    if (r.role === MAINTENANCE_ROLE && r.member_of) violations.push(`rol ${r.role}: es miembro de ${r.member_of}`);
    if (r.role === MAINTENANCE_LOGIN && r.member_of !== MAINTENANCE_ROLE) {
      violations.push(
        `rol ${r.role}: debe ser miembro solo de ${MAINTENANCE_ROLE} (es miembro de ${r.member_of ?? 'ninguno'})`,
      );
    }
  }
  const privileges = (
    await db.query<{ role: string; table: string; privilege: string; columns: string | null }>(
      `SELECT r.rolname AS role, c.relname AS table, p.privilege AS privilege,
              CASE WHEN p.privilege = 'SELECT' AND NOT has_table_privilege(r.oid, c.oid, 'SELECT') THEN
                (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                    AND has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT')) END AS columns
         FROM pg_roles r
         CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilege)
        WHERE r.rolname = ANY($1) AND n.nspname = $2 AND c.relkind IN ('r', 'p')
          AND (has_table_privilege(r.oid, c.oid, p.privilege)
               OR (p.privilege IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(r.oid, c.oid, p.privilege)))`,
      [roles.map((r) => r.role), schema],
    )
  ).rows;
  for (const p of privileges) {
    const allowed =
      (p.table === MAINTENANCE_TABLE &&
        (p.privilege === 'DELETE' || (p.privilege === 'SELECT' && p.columns === MAINTENANCE_COLUMNS.join(',')))) ||
      (p.table === PLATFORM_AUDIT_TABLE && p.privilege === 'INSERT' && p.columns === null);
    if (!allowed) {
      violations.push(
        `rol ${p.role}: privilegio ${p.privilege}${p.columns ? ` (${p.columns})` : ''} en ${schema}.${p.table} no permitido para mantenimiento`,
      );
    }
  }
  return violations;
}

/** Controles de la auditoría de plataforma (T099). Sin la tabla (base anterior a 0003) no hay nada que verificar. */
export async function checkPlatformAudit(db: Queryable, schema: string): Promise<string[]> {
  const name = `${schema}.${PLATFORM_AUDIT_TABLE}`;
  const table = (
    await db.query<{
      rls: boolean;
      force: boolean;
      owner: string;
      public_privs: string | null;
      runtime: string | null;
    }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, pg_get_userbyid(c.relowner) AS owner,
              (SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                WHERE has_table_privilege('public', c.oid, p)) AS public_privs,
              (SELECT string_agg(r || ':' || p, ',' ORDER BY r, p)
                 FROM unnest($3::text[]) r
                 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_table_privilege(r, c.oid, p)) AS runtime
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
      [schema, PLATFORM_AUDIT_TABLE, [...RUNTIME_ROLES]],
    )
  ).rows[0];
  if (!table) return [];
  const violations: string[] = [];
  if (!table.rls) violations.push(`${name}: RLS no está habilitado`);
  if (!table.force) violations.push(`${name}: RLS no está forzado`);
  if (table.owner !== EXPECTED_OWNER)
    violations.push(`${name}: propietario ${table.owner}; se espera ${EXPECTED_OWNER}`);
  if (table.public_privs) violations.push(`${name}: PUBLIC tiene privilegios (${table.public_privs})`);
  if (table.runtime) violations.push(`${name}: un rol de runtime tiene privilegios (${table.runtime})`);

  const policies = (
    await db.query<{ policy: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }>(
      `SELECT pol.polname AS policy, pol.polcmd::text AS cmd,
              ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (pol.polroles) ORDER BY rolname)::text[] AS roles,
              pg_get_expr(pol.polqual, pol.polrelid) AS qual, pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
         FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
      [schema, PLATFORM_AUDIT_TABLE],
    )
  ).rows;
  const expected = PLATFORM_AUDIT_POLICY;
  const exact =
    policies.length === 1 &&
    policies[0]!.policy === expected.policy &&
    policies[0]!.cmd === expected.cmd &&
    policies[0]!.qual === expected.qual &&
    policies[0]!.with_check === expected.with_check &&
    JSON.stringify(policies[0]!.roles) === JSON.stringify(expected.roles);
  if (!exact) {
    violations.push(
      `${name}: las políticas deben ser exactamente ${expected.policy} (INSERT para ${MAINTENANCE_ROLE}); hay: ${
        policies.map((p) => `${p.policy}/${p.cmd}/${p.roles.join('+')}`).join(', ') || 'ninguna'
      }`,
    );
  }

  const triggers = (
    await db.query<{ name: string }>(
      `SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal AND t.tgenabled <> 'D'`,
      [schema, PLATFORM_AUDIT_TABLE],
    )
  ).rows.map((t) => t.name);
  for (const trigger of PLATFORM_AUDIT_TRIGGERS) {
    if (!triggers.includes(trigger)) violations.push(`${name}: falta el trigger ${trigger} (o está deshabilitado)`);
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
