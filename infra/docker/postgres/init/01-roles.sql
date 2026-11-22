-- Roles de base de datos de Kuota (data-model.md §Roles de base de datos; ADR-0004 C4-1).
-- Lo ejecuta psql dentro del contenedor (docker-entrypoint-initdb.d, y Testcontainers en pruebas).
-- Las contraseñas NO están en este archivo: se leen de variables de entorno.
\set ON_ERROR_STOP on

\getenv kuota_migrator_password KUOTA_MIGRATOR_PASSWORD
\getenv kuota_app_login_password KUOTA_APP_LOGIN_PASSWORD

\if :{?kuota_migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'KUOTA_MIGRATOR_PASSWORD no está definida'; END $$;
\endif
\if :{?kuota_app_login_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'KUOTA_APP_LOGIN_PASSWORD no está definida'; END $$;
\endif
SELECT length(:'kuota_migrator_password') >= 12 AND length(:'kuota_app_login_password') >= 12 AS passwords_ok \gset
\if :passwords_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'Las contraseñas de los roles deben tener al menos 12 caracteres'; END $$;
\endif

-- Propietario de esquemas y tablas; solo para migraciones. Nunca se usa en runtime.
CREATE ROLE kuota_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'kuota_migrator_password';

-- Privilegios de la API: sin login, sin BYPASSRLS, no propietario.
CREATE ROLE kuota_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Credencial de la API: hereda los privilegios de kuota_app.
CREATE ROLE kuota_app_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
  IN ROLE kuota_app PASSWORD :'kuota_app_login_password';

-- Base principal: el migrador es su propietario (puede crear el esquema `kuota` en G2).
SELECT current_database() AS main_db \gset
ALTER DATABASE :"main_db" OWNER TO kuota_migrator;
REVOKE ALL ON DATABASE :"main_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"main_db" TO kuota_app;

-- Base para pruebas locales.
CREATE DATABASE kuota_test OWNER kuota_migrator;
REVOKE ALL ON DATABASE kuota_test FROM PUBLIC;
GRANT CONNECT ON DATABASE kuota_test TO kuota_app;
