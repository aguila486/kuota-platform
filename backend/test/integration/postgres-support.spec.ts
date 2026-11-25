import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationFolders, postgresImage, startTestDatabase, type TestDatabase } from '../support/postgres.js';

// Verifica el soporte de Testcontainers (T011) y los roles de T005 sobre la imagen fijada de compose.yaml.
describe('Testcontainers PostgreSQL (T011)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await db?.stop();
  });

  async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it('usa la imagen postgres:18 fijada por digest', async () => {
    expect(postgresImage()).toMatch(/^postgres:18@sha256:[0-9a-f]{64}$/);
    const version = await withClient(
      db.migratorUrl,
      async (c) => (await c.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]?.v,
    );
    expect(version).toMatch(/^18\./);
  });

  it('entrega URLs funcionales para kuota_app_login y kuota_migrator', async () => {
    const appUser = await withClient(
      db.appUrl,
      async (c) => (await c.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u,
    );
    const migratorUser = await withClient(
      db.migratorUrl,
      async (c) => (await c.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u,
    );
    expect(appUser).toBe('kuota_app_login');
    expect(migratorUser).toBe('kuota_migrator');
  });

  it('ningún rol de Kuota tiene SUPERUSER, BYPASSRLS, CREATEDB ni CREATEROLE; kuota_app no inicia sesión', async () => {
    const roles = await withClient(db.migratorUrl, async (c) => {
      const result = await c.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolcanlogin: boolean;
      }>(
        "SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname LIKE 'kuota%' ORDER BY rolname",
      );
      return result.rows;
    });
    // kuota_maintenance(_login): aprovisionamiento de plataforma de US6 (02-maintenance-roles.sql).
    expect(roles.map((r) => r.rolname)).toEqual([
      'kuota_app',
      'kuota_app_login',
      'kuota_maintenance',
      'kuota_maintenance_login',
      'kuota_migrator',
    ]);
    for (const role of roles) {
      expect(role, role.rolname).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
    }
    expect(roles.find((r) => r.rolname === 'kuota_app')?.rolcanlogin).toBe(false);
  });

  it('kuota_app_login hereda de kuota_app y no puede crear objetos (sin DDL)', async () => {
    await withClient(db.appUrl, async (c) => {
      const member = await c.query<{ ok: boolean }>(
        "SELECT pg_has_role('kuota_app_login', 'kuota_app', 'MEMBER') AS ok",
      );
      expect(member.rows[0]?.ok).toBe(true);
      await expect(c.query('CREATE TABLE public.probe (id int)')).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('kuota_migrator es propietario de la base y se aplican todas las migraciones del repositorio', async () => {
    const owner = await withClient(
      db.migratorUrl,
      async (c) =>
        (
          await c.query<{ o: string }>(
            'SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = current_database()',
          )
        ).rows[0]?.o,
    );
    expect(owner).toBe('kuota_migrator');
    expect(db.appliedMigrations).toEqual(migrationFolders());
  });
});
