-- 0002_idempotency_maintenance — purga de claves de idempotencia vencidas (US6, T079; aprobado el 2026-11-23).
--
-- Aditiva: no modifica 0001_foundation, ni la política tenant_isolation, ni RLS/FORCE de ninguna tabla, ni privilegios
-- de kuota_app. Solo concede a kuota_maintenance (rol de plataforma, aprovisionado ANTES por
-- infra/docker/postgres/init/02-maintenance-roles.sql) la capacidad mínima para borrar filas VENCIDAS de
-- kuota.idempotency_keys:
--   * SELECT únicamente de (tenant_id, key, expires_at): no puede leer request_hash, response_body ni el resto;
--   * DELETE, sin INSERT, UPDATE, TRUNCATE, REFERENCES ni TRIGGER;
--   * dos políticas RLS (SELECT y DELETE) que solo exponen filas con expires_at <= now(). FORCE RLS sigue activo y la
--     política tenant_isolation (TO kuota_app) no le aplica: sin estas políticas no vería ni borraría nada.
-- Sin acceso a audit_events, dev_probe_items ni a ninguna otra tabla.
-- La aplica kuota_migrator (propietario de la tabla), como toda migración; no requiere privilegios elevados.
BEGIN;

-- Precondición: el rol existe y conserva los atributos de mínimo privilegio. Si no, se aborta (sin cambios parciales).
DO $$
DECLARE
  r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'kuota_maintenance';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falta el rol kuota_maintenance: ejecutar antes el aprovisionamiento de plataforma (infra/docker/postgres/init/02-maintenance-roles.sql)';
  END IF;
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolcanlogin THEN
    RAISE EXCEPTION 'kuota_maintenance tiene atributos no permitidos (superusuario, omisión de RLS, creación de roles o bases, replicación o login)';
  END IF;
  IF pg_has_role('kuota_maintenance', 'kuota_app', 'MEMBER') OR pg_has_role('kuota_maintenance', 'kuota_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'kuota_maintenance no puede ser miembro de kuota_app ni de kuota_migrator';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA kuota TO kuota_maintenance;
GRANT SELECT (tenant_id, key, expires_at), DELETE ON kuota.idempotency_keys TO kuota_maintenance;

-- now() se evalúa en PostgreSQL (inicio de la transacción de la sentencia de purga): una sola fuente de tiempo.
CREATE POLICY maintenance_select_expired ON kuota.idempotency_keys
  FOR SELECT TO kuota_maintenance
  USING (expires_at <= now());

CREATE POLICY maintenance_delete_expired ON kuota.idempotency_keys
  FOR DELETE TO kuota_maintenance
  USING (expires_at <= now());

COMMIT;
