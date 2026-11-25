-- Roles de mantenimiento de idempotencia (US6, T079; cierre aprobado el 2026-11-23).
--
-- PASO DE APROVISIONAMIENTO DE PLATAFORMA, fuera de Prisma Migrate: crear roles exige CREATEROLE, y `kuota_migrator`
-- es NOCREATEROLE a propósito. Lo ejecuta el administrador del clúster (en local, docker-entrypoint-initdb.d al crear
-- el volumen; en Testcontainers, la misma ruta). DEBE ejecutarse ANTES de la migración 0002, que verifica que el rol
-- existe y aborta si no.
--
-- En un clúster existente (p. ej. un volumen local ya inicializado) se ejecuta a mano, con revisión:
--   psql -U postgres -d kuota -v ON_ERROR_STOP=1 -f infra/docker/postgres/init/02-maintenance-roles.sql
-- Es re-ejecutable: no recrea lo que ya existe.
--
-- Diseño de mínimo privilegio:
-- * `kuota_maintenance`: rol de privilegios, sin login. La migración 0002 le concede solo SELECT de
--   (tenant_id, key, expires_at) y DELETE en kuota.idempotency_keys, con políticas RLS limitadas a filas vencidas.
-- * `kuota_maintenance_login`: identidad de conexión dedicada (separada de kuota_app_login y kuota_migrator), miembro
--   solo de `kuota_maintenance`. Se crea solo si se define KUOTA_MAINTENANCE_LOGIN_PASSWORD; si no, el entorno local
--   funciona igual y la purga no tiene credencial.
-- Ninguno es superusuario, ni crea bases o roles, ni replica, ni omite RLS. Ninguno es miembro de kuota_app.
\set ON_ERROR_STOP on

\getenv kuota_maintenance_login_password KUOTA_MAINTENANCE_LOGIN_PASSWORD
\if :{?kuota_maintenance_login_password}
\else
  \set kuota_maintenance_login_password ''
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuota_maintenance') AS maintenance_exists \gset
\if :maintenance_exists
  \echo 'kuota_maintenance ya existe: no se modifica'
\else
  CREATE ROLE kuota_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\endif

SELECT current_database() AS main_db \gset
GRANT CONNECT ON DATABASE :"main_db" TO kuota_maintenance;

SELECT coalesce(length(:'kuota_maintenance_login_password'), 0) AS login_password_length \gset
SELECT :login_password_length > 0 AS login_requested, :login_password_length >= 12 AS login_password_ok \gset
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuota_maintenance_login') AS login_exists \gset

\if :login_requested
  \if :login_password_ok
  \else
    DO $$ BEGIN RAISE EXCEPTION 'KUOTA_MAINTENANCE_LOGIN_PASSWORD debe tener al menos 12 caracteres'; END $$;
  \endif
  \if :login_exists
    \echo 'kuota_maintenance_login ya existe: no se modifica'
  \else
    -- CONNECTION LIMIT 2: la purga es manual; no hay motivo para más sesiones simultáneas.
    CREATE ROLE kuota_maintenance_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
      CONNECTION LIMIT 2 IN ROLE kuota_maintenance PASSWORD :'kuota_maintenance_login_password';
  \endif
\else
  \echo 'KUOTA_MAINTENANCE_LOGIN_PASSWORD no definida: no se crea kuota_maintenance_login (la purga no tendrá credencial)'
\endif
