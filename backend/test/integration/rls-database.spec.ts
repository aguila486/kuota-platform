import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../support/postgres.js';
import {
  asTenantSql,
  rejection,
  seedTenantRows,
  sqlState,
  TENANT_A,
  TENANT_B,
  TENANT_TABLES,
} from '../support/tenant-data.js';

/**
 * T035 (US2-2, US2-5; FR-013, FR-014): aislamiento y privilegios en PostgreSQL 18 real con la credencial de runtime
 * `kuota_app_login`, sin pasar por la aplicación. Incluye intentos de eludir RLS desde SQL.
 */
let db: TestDatabase;
const SEEDED = 3;

async function asApp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.appUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const count = async (client: Client, table: string) =>
  Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM kuota.${table}`)).rows[0]!.n);

beforeAll(async () => {
  db = await startTestDatabase();
  await seedTenantRows(db.appUrl, TENANT_A, SEEDED);
  await seedTenantRows(db.appUrl, TENANT_B, SEEDED);
}, 180_000);
afterAll(async () => db?.stop());

describe('RLS con kuota_app_login (T035)', () => {
  it('las filas existen: con contexto, cada tenant ve exactamente las suyas en cada tabla', async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await asTenantSql(db.appUrl, tenant, async (client) => {
        for (const table of TENANT_TABLES) {
          expect(await count(client, table), `${table} (${tenant})`).toBe(SEEDED);
          const others = await client.query(`SELECT 1 FROM kuota.${table} WHERE tenant_id <> $1`, [tenant]);
          expect(others.rowCount, table).toBe(0);
        }
      });
    }
  });

  it('sin set_config, una consulta devuelve 0 filas en cada tabla de tenant (y el contexto está vacío)', async () => {
    await asApp(async (client) => {
      const setting = await client.query<{ t: string | null }>("SELECT current_setting('app.tenant_id', true) AS t");
      expect([null, '']).toContain(setting.rows[0]!.t);
      for (const table of TENANT_TABLES) expect(await count(client, table), table).toBe(0);
    });
  });

  it('con app.tenant_id vacío o de un tenant inexistente: 0 filas', async () => {
    await asApp(async (client) => {
      for (const value of ['', '0193b6f0-0000-7000-8000-0000000000ff']) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [value]);
        for (const table of TENANT_TABLES) expect(await count(client, table), `${table} '${value}'`).toBe(0);
        await client.query('ROLLBACK');
      }
    });
  });

  it('filtrar por el tenant ajeno en el WHERE no sirve de nada: RLS se aplica antes', async () => {
    await asTenantSql(db.appUrl, TENANT_A, async (client) => {
      for (const table of TENANT_TABLES) {
        const rows = await client.query(`SELECT 1 FROM kuota.${table} WHERE tenant_id = $1`, [TENANT_B]);
        expect(rows.rowCount, table).toBe(0);
      }
    });
  });

  it('no puede insertar con el tenant_id de otro tenant (WITH CHECK → 42501)', async () => {
    const error = await rejection(
      asTenantSql(db.appUrl, TENANT_A, (client) =>
        client.query('INSERT INTO kuota.dev_probe_items (tenant_id, label) VALUES ($1, $2)', [TENANT_B, 'intruso']),
      ),
    );
    expect(sqlState(error)).toBe('42501');
  });

  it('UPDATE y DELETE cruzados no afectan filas del otro tenant', async () => {
    await asTenantSql(db.appUrl, TENANT_A, async (client) => {
      const updated = await client.query("UPDATE kuota.dev_probe_items SET label = 'hackeado' WHERE tenant_id = $1", [
        TENANT_B,
      ]);
      const deleted = await client.query('DELETE FROM kuota.dev_probe_items WHERE tenant_id = $1', [TENANT_B]);
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
    });
    await asTenantSql(db.appUrl, TENANT_B, async (client) => {
      expect(await count(client, 'dev_probe_items')).toBe(SEEDED);
      const labels = await client.query<{ label: string }>('SELECT label FROM kuota.dev_probe_items');
      expect(labels.rows.every((r) => r.label !== 'hackeado')).toBe(true);
    });
  });
});

describe('privilegios de kuota_app y kuota_app_login (T035, FR-014)', () => {
  it('no son superusuario, no tienen BYPASSRLS ni CREATEROLE/CREATEDB, y kuota_app no puede iniciar sesión', async () => {
    await asApp(async (client) => {
      const roles = await client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolcanlogin: boolean;
      }>(
        "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname IN ('kuota_app', 'kuota_app_login') ORDER BY rolname",
      );
      expect(roles.rows).toEqual([
        {
          rolname: 'kuota_app',
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolcanlogin: false,
        },
        {
          rolname: 'kuota_app_login',
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolcanlogin: true,
        },
      ]);
      const me = await client.query<{ u: string }>('SELECT current_user AS u');
      expect(me.rows[0]!.u).toBe('kuota_app_login');
    });
  });

  it('no es propietario del esquema ni de ninguna tabla, y no puede crear objetos en kuota ni en public', async () => {
    await asApp(async (client) => {
      const owners = await client.query<{ owner: string }>(
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'kuota'
         UNION SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'kuota'`,
      );
      expect(owners.rows.map((r) => r.owner)).toEqual(['kuota_migrator']);
      const create = await client.query<{ kuota: boolean; pub: boolean }>(
        "SELECT has_schema_privilege('kuota', 'CREATE') AS kuota, has_schema_privilege('public', 'CREATE') AS pub",
      );
      expect(create.rows[0]).toEqual({ kuota: false, pub: false });
    });
  });

  const DDL: Record<string, string> = {
    'CREATE TABLE en kuota': 'CREATE TABLE kuota.intruso (id int)',
    'CREATE TABLE en public': 'CREATE TABLE public.intruso (id int)',
    'DISABLE ROW LEVEL SECURITY': 'ALTER TABLE kuota.dev_probe_items DISABLE ROW LEVEL SECURITY',
    'NO FORCE ROW LEVEL SECURITY': 'ALTER TABLE kuota.dev_probe_items NO FORCE ROW LEVEL SECURITY',
    'DROP POLICY': 'DROP POLICY tenant_isolation ON kuota.dev_probe_items',
    'CREATE POLICY permisiva': 'CREATE POLICY abierta ON kuota.dev_probe_items FOR ALL TO kuota_app USING (true)',
    'DROP TABLE': 'DROP TABLE kuota.dev_probe_items',
    'ALTER TABLE ADD COLUMN': 'ALTER TABLE kuota.dev_probe_items ADD COLUMN x int',
    'TRUNCATE (ignoraría RLS)': 'TRUNCATE kuota.dev_probe_items',
  };
  for (const [name, sql] of Object.entries(DDL)) {
    it(`DDL/privilegios rechazados: ${name}`, async () => {
      await asApp(async (client) => {
        const error = await rejection(client.query(sql));
        expect(sqlState(error), String(error)).toBe('42501');
      });
    });
  }
});

describe('GRANT sin opción de concesión (T035)', () => {
  it('GRANT a PUBLIC no concede nada: PostgreSQL solo advierte y la ACL no cambia', async () => {
    await asApp(async (client) => {
      const notices: string[] = [];
      client.on('notice', (n) => notices.push(n.message ?? ''));
      await client.query('GRANT SELECT ON kuota.dev_probe_items TO PUBLIC');
      expect(notices.join(' ')).toMatch(/no privileges were granted/);
      const pub = await client.query(
        "SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'kuota.dev_probe_items'::regclass AND a.grantee = 0",
      );
      expect(pub.rowCount).toBe(0);
    });
  });
});

describe('intentos de eludir RLS desde SQL con la credencial de runtime (T035)', () => {
  it('SET ROLE kuota_migrator y SET SESSION AUTHORIZATION se rechazan', async () => {
    await asApp(async (client) => {
      for (const sql of ['SET ROLE kuota_migrator', 'SET ROLE postgres', 'SET SESSION AUTHORIZATION kuota_migrator']) {
        expect(sqlState(await rejection(client.query(sql))), sql).toBe('42501');
      }
    });
  });

  it('SET row_security = off no desactiva RLS: la consulta falla en vez de devolver filas', async () => {
    await asTenantSql(db.appUrl, TENANT_A, async (client) => {
      await client.query('SET LOCAL row_security = off');
      const error = await rejection(client.query('SELECT * FROM kuota.dev_probe_items'));
      expect(sqlState(error), String(error)).toBe('42501');
    });
  });

  it('SET ROLE kuota_app (rol del que es miembro) no amplía privilegios: sigue sujeto a RLS', async () => {
    await asApp(async (client) => {
      await client.query('SET ROLE kuota_app');
      expect(await count(client, 'dev_probe_items')).toBe(0);
      expect(sqlState(await rejection(client.query('TRUNCATE kuota.dev_probe_items')))).toBe('42501');
    });
  });

  it('LÍMITE DE CONFIANZA: quien ejecute SQL arbitrario con la credencial de runtime puede fijar app.tenant_id', async () => {
    // RLS no autentica: confía en app.tenant_id. Por eso solo withTenant lo fija (lint P2, verificación antes del
    // COMMIT), solo se admiten consultas parametrizadas y la credencial nunca sale del servidor.
    await asTenantSql(db.appUrl, TENANT_A, async (client) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_B]);
      expect(await count(client, 'dev_probe_items')).toBe(SEEDED);
    });
  });
});
