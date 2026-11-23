import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRls, TENANT_TABLE_ALLOWLIST } from '../../scripts/check-rls.js';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import { TENANT_TABLES } from '../support/tenant-data.js';

/**
 * T036 (US2-4; FR-015) y T043: el verificador de catálogo sobre PostgreSQL 18 real. Cada caso negativo rompe algo
 * dentro de una transacción del superusuario de la base efímera, verifica y revierte (el DDL de PostgreSQL es
 * transaccional). El caso de T036 usa además un esquema temporal y el script real (`pnpm db:check-rls`).
 */
const BACKEND_DIR = join(__dirname, '../..');
let db: TestDatabase;
let admin: Client;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.superuserUrl });
  await admin.connect();
}, 180_000);
afterAll(async () => {
  await admin?.end();
  await db?.stop();
});

/** Aplica `sql` en una transacción, ejecuta el verificador sobre ella y revierte. */
async function violationsAfter(sql: string, schema = 'kuota'): Promise<string[]> {
  await admin.query('BEGIN');
  try {
    await admin.query(sql);
    return await checkRls(admin, { schema });
  } finally {
    await admin.query('ROLLBACK');
  }
}

async function runCli(env: Record<string, string>, args: string[] = []) {
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/check-rls.ts', ...args],
      {
        cwd: BACKEND_DIR,
        env: { PATH: process.env['PATH'], ...env },
      },
    );
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { code: number; stdout: string };
    return { code: e.code, stdout: e.stdout };
  }
}

describe('db:check-rls sobre 0001_foundation (T043)', () => {
  it('el esquema migrado es conforme, con la lista blanca vacía', async () => {
    expect(TENANT_TABLE_ALLOWLIST).toEqual([]);
    expect(await checkRls(admin)).toEqual([]);
  });

  it('el script real termina con 0 usando solo la credencial de runtime (lee el catálogo)', async () => {
    const result = await runCli({ DATABASE_URL_APP: db.appUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('conforme');
  });

  for (const table of TENANT_TABLES) {
    it(`detecta cada tabla de tenant: kuota.${table} sin FORCE`, async () => {
      const violations = await violationsAfter(`ALTER TABLE kuota.${table} NO FORCE ROW LEVEL SECURITY`);
      expect(violations).toEqual([
        `kuota.${table}: tiene tenant_id y RLS no está forzado (relforcerowsecurity = false)`,
      ]);
    });
  }
});

describe('T036: una tabla con tenant_id sin FORCE en un esquema temporal hace fallar el script nombrándola', () => {
  it('exit 1 y la tabla nombrada', async () => {
    await admin.query(`
      CREATE SCHEMA check_rls_tmp AUTHORIZATION kuota_migrator;
      CREATE TABLE check_rls_tmp.sin_force (id int, tenant_id uuid);
      ALTER TABLE check_rls_tmp.sin_force OWNER TO kuota_migrator;
      ALTER TABLE check_rls_tmp.sin_force ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON check_rls_tmp.sin_force FOR ALL TO kuota_app
        USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      REVOKE ALL ON check_rls_tmp.sin_force FROM PUBLIC;`);
    try {
      const result = await runCli({ DATABASE_URL_CHECK: db.superuserUrl }, ['--schema', 'check_rls_tmp']);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('check_rls_tmp.sin_force: tiene tenant_id y RLS no está forzado');
      expect(result.stdout).toContain('1 violación(es)');
    } finally {
      await admin.query('DROP SCHEMA check_rls_tmp CASCADE');
    }
  });
});

describe('configuraciones incorrectas deliberadas (T043, base efímera)', () => {
  const CASES: Array<[string, string, string[]]> = [
    [
      'RLS deshabilitado',
      'ALTER TABLE kuota.dev_probe_items DISABLE ROW LEVEL SECURITY',
      ['kuota.dev_probe_items: tiene tenant_id y RLS no está habilitado (relrowsecurity = false)'],
    ],
    [
      'sin políticas',
      'DROP POLICY tenant_isolation ON kuota.dev_probe_items',
      ['kuota.dev_probe_items: tiene tenant_id y no tiene ninguna política RLS'],
    ],
    [
      'solo políticas de mantenimiento (0002) sin la política de tenant',
      'DROP POLICY tenant_isolation ON kuota.idempotency_keys',
      ['kuota.idempotency_keys: solo tiene políticas de mantenimiento; falta la política de tenant para kuota_app'],
    ],
    [
      'política que no filtra por tenant (USING true)',
      `DROP POLICY tenant_isolation ON kuota.dev_probe_items;
       CREATE POLICY abierta ON kuota.dev_probe_items FOR ALL TO kuota_app USING (true) WITH CHECK (true)`,
      [
        'kuota.dev_probe_items: la política abierta no filtra por tenant_id = app.tenant_id en USING',
        'kuota.dev_probe_items: la política abierta no exige tenant_id = app.tenant_id en WITH CHECK',
      ],
    ],
    [
      'política adicional permisiva (las permisivas se combinan con OR)',
      'CREATE POLICY lectura_global ON kuota.audit_events FOR SELECT TO kuota_app USING (true)',
      ['kuota.audit_events: la política lectura_global no filtra por tenant_id = app.tenant_id en USING'],
    ],
    [
      'política que no aplica al rol de runtime',
      `DROP POLICY tenant_isolation ON kuota.dev_probe_items;
       CREATE POLICY tenant_isolation ON kuota.dev_probe_items FOR ALL TO kuota_migrator
         USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`,
      ['kuota.dev_probe_items: la política tenant_isolation no aplica a kuota_app (aplica a kuota_migrator)'],
    ],
    [
      'tabla nueva con tenant_id sin RLS ni políticas',
      'CREATE TABLE kuota.nueva (id int, tenant_id uuid); ALTER TABLE kuota.nueva OWNER TO kuota_migrator',
      [
        'kuota.nueva: tiene tenant_id y RLS no está habilitado (relrowsecurity = false)',
        'kuota.nueva: tiene tenant_id y RLS no está forzado (relforcerowsecurity = false)',
        'kuota.nueva: tiene tenant_id y no tiene ninguna política RLS',
      ],
    ],
    [
      'propietario = rol de runtime',
      'ALTER TABLE kuota.dev_probe_items OWNER TO kuota_app_login',
      // Al cambiar el propietario, PostgreSQL le transfiere los privilegios del dueño (TRUNCATE y TRIGGER incluidos) y la
      // propiedad de los índices: el verificador lo detecta todo.
      [
        'kuota.dev_probe_items: propietario kuota_app_login; se espera kuota_migrator',
        'kuota.dev_probe_items: kuota_app_login tiene TRIGGER (TRUNCATE ignora RLS; TRIGGER no corresponde al runtime)',
        'kuota.dev_probe_items: kuota_app_login tiene TRUNCATE (TRUNCATE ignora RLS; TRIGGER no corresponde al runtime)',
        'rol kuota_app_login: es propietario de dev_probe_items,dev_probe_items_pkey,dev_probe_items_tenant_id_key en kuota',
      ],
    ],
    [
      'privilegios a PUBLIC',
      'GRANT SELECT ON kuota.audit_events TO PUBLIC',
      // Los roles de mantenimiento heredan lo concedido a PUBLIC: el verificador también lo detecta en ellos.
      [
        'kuota.audit_events: PUBLIC tiene privilegios (SELECT)',
        'rol kuota_maintenance: privilegio SELECT en kuota.audit_events no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio SELECT en kuota.audit_events no permitido para mantenimiento',
      ],
    ],
    [
      'TRUNCATE para el runtime (ignora RLS)',
      'GRANT TRUNCATE ON kuota.dev_probe_items TO kuota_app',
      ['kuota.dev_probe_items: kuota_app tiene TRUNCATE (TRUNCATE ignora RLS; TRIGGER no corresponde al runtime)'],
    ],
    ['runtime con BYPASSRLS', 'ALTER ROLE kuota_app BYPASSRLS', ['rol kuota_app: tiene BYPASSRLS']],
    [
      'mantenimiento: política de purga alterada (también filas vigentes)',
      `DROP POLICY maintenance_delete_expired ON kuota.idempotency_keys;
       CREATE POLICY maintenance_delete_expired ON kuota.idempotency_keys FOR DELETE TO kuota_maintenance USING (true)`,
      [
        'kuota.idempotency_keys: la política maintenance_delete_expired no filtra por tenant_id = app.tenant_id en USING',
        'kuota.idempotency_keys: la política maintenance_delete_expired no aplica a kuota_app (aplica a kuota_maintenance)',
      ],
    ],
    [
      'mantenimiento: política aplicada también al runtime',
      `DROP POLICY maintenance_select_expired ON kuota.idempotency_keys;
       CREATE POLICY maintenance_select_expired ON kuota.idempotency_keys FOR SELECT TO kuota_maintenance, kuota_app
         USING (expires_at <= now())`,
      [
        'kuota.idempotency_keys: la política maintenance_select_expired no filtra por tenant_id = app.tenant_id en USING',
      ],
    ],
    [
      'mantenimiento: UPDATE y lectura de response_body',
      'GRANT UPDATE ON kuota.idempotency_keys TO kuota_maintenance; GRANT SELECT (response_body) ON kuota.idempotency_keys TO kuota_maintenance',
      [
        'rol kuota_maintenance: privilegio SELECT (expires_at,key,response_body,tenant_id) en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio UPDATE en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio SELECT (expires_at,key,response_body,tenant_id) en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio UPDATE en kuota.idempotency_keys no permitido para mantenimiento',
      ],
    ],
    [
      'mantenimiento: acceso a otra tabla',
      'GRANT DELETE ON kuota.audit_events TO kuota_maintenance',
      [
        'rol kuota_maintenance: privilegio DELETE en kuota.audit_events no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio DELETE en kuota.audit_events no permitido para mantenimiento',
      ],
    ],
    [
      'mantenimiento: miembro del runtime y con BYPASSRLS',
      'GRANT kuota_app TO kuota_maintenance; ALTER ROLE kuota_maintenance_login BYPASSRLS',
      [
        'rol kuota_maintenance: es miembro de kuota_app',
        'rol kuota_maintenance_login: tiene el atributo bypassrls',
        'rol kuota_maintenance: privilegio DELETE en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio INSERT en kuota.audit_events no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio INSERT en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio INSERT en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio SELECT en kuota.audit_events no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio SELECT en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio SELECT en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio UPDATE en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance: privilegio UPDATE en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio DELETE en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio INSERT en kuota.audit_events no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio INSERT en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio INSERT en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio SELECT en kuota.audit_events no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio SELECT en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio SELECT en kuota.idempotency_keys no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio UPDATE en kuota.dev_probe_items no permitido para mantenimiento',
        'rol kuota_maintenance_login: privilegio UPDATE en kuota.idempotency_keys no permitido para mantenimiento',
      ],
    ],
    [
      'runtime superusuario',
      'ALTER ROLE kuota_app_login SUPERUSER',
      ['rol kuota_app_login: es superusuario', 'rol kuota_app_login: puede crear objetos en kuota,public'],
    ],
    [
      'runtime puede crear en kuota',
      'GRANT CREATE ON SCHEMA kuota TO kuota_app',
      ['rol kuota_app: puede crear objetos en kuota', 'rol kuota_app_login: puede crear objetos en kuota'],
    ],
  ];
  for (const [name, sql, expected] of CASES) {
    it(`falla: ${name}`, async () => {
      expect((await violationsAfter(sql)).sort()).toEqual([...expected].sort());
    });
  }

  it('la lista blanca excluye una tabla solo si se declara explícitamente', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query('ALTER TABLE kuota.dev_probe_items NO FORCE ROW LEVEL SECURITY');
      expect(await checkRls(admin, { allowlist: ['dev_probe_items'] })).toEqual([]);
      expect(await checkRls(admin)).toHaveLength(1);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('cada caso se revirtió: el catálogo vuelve a ser conforme', async () => {
    expect(await checkRls(admin)).toEqual([]);
  });

  it('sin conexión posible: exit 2 sin mostrar la URL ni la contraseña', async () => {
    const result = await runCli({
      DATABASE_URL_APP: 'postgresql://kuota_app_login:secreto-ficticio@127.0.0.1:1/kuota',
    }).catch((e) => e as { code: number; stdout: string });
    expect(result.code).toBe(2);
    expect(result.stdout ?? '').not.toContain('secreto-ficticio');
  });
});
