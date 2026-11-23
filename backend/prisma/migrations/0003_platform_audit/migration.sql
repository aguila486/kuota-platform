-- 0003_platform_audit — auditoría de operaciones de plataforma (T099; Constitución III: "Operaciones de plataforma
-- (cross-tenant) DEBEN usar un rol y módulo separados, auditados y fuera de la API de tenants"; Constitución VII).
--
-- Aditiva: no modifica 0001 ni 0002, ni RLS/FORCE/políticas de ninguna tabla existente, ni privilegios de kuota_app.
-- Crea kuota.platform_audit_events, SEPARADA de audit_events (que exige tenant_id: nunca se usa un tenant ficticio).
-- Propietario lógico: common/audit (ADR-0002 C2-2: mientras D-ARC-07 esté pendiente, 001 solo crea tablas de common).
--   * Sin tenant_id ni datos de tenant: solo metadatos de la ejecución (operación, estado, recuentos, códigos).
--   * Escritura: solo kuota_maintenance (INSERT); sin SELECT, UPDATE, DELETE ni TRUNCATE. kuota_app: nada.
--   * Append-only incluso para el propietario (triggers, como audit_events). Retención: sin mecanismo de borrado; la
--     política de retención de la auditoría sigue pendiente de decisión.
--   * executed_by y occurred_at los fija el servidor (trigger): el ejecutor no puede falsearlos.
--   * Lectura: ningún rol de runtime ni de tenant. El rol de lectura de plataforma (kuota_platform) llega con 002.
BEGIN;

-- Precondición: el rol de mantenimiento existe (aprovisionamiento de plataforma, 02-maintenance-roles.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuota_maintenance') THEN
    RAISE EXCEPTION 'Falta el rol kuota_maintenance: ejecutar antes el aprovisionamiento de plataforma (infra/docker/postgres/init/02-maintenance-roles.sql)';
  END IF;
END
$$;

CREATE TABLE kuota.platform_audit_events (
  id              uuid        NOT NULL DEFAULT uuidv7(),
  run_id          uuid        NOT NULL,
  operation       text        NOT NULL,
  status          text        NOT NULL,
  executed_by     text        NOT NULL DEFAULT session_user,
  occurred_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  correlation_id  uuid        NOT NULL,
  dry_run         boolean     NOT NULL,
  batch_size      integer,
  max_batches     integer,
  expired_before  bigint,
  affected_rows   bigint,
  batches         integer,
  result_code     text,
  CONSTRAINT platform_audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT platform_audit_events_operation_values CHECK (operation IN ('idempotency.purge')),
  CONSTRAINT platform_audit_events_status_values CHECK (status IN ('started', 'succeeded', 'failed')),
  -- Un inicio no tiene resultado; un final siempre lo tiene (los recuentos pueden faltar si falló antes de contar).
  CONSTRAINT platform_audit_events_result_by_status CHECK (
    (status = 'started' AND result_code IS NULL AND affected_rows IS NULL AND batches IS NULL)
    OR (status = 'succeeded' AND result_code = 'ok' AND affected_rows IS NOT NULL AND batches IS NOT NULL)
    OR (status = 'failed' AND result_code IS NOT NULL AND result_code <> 'ok')
  ),
  -- Códigos cortos y acotados (p. ej. 'ok', 'sqlstate-55p03'): nunca mensajes libres que puedan filtrar datos.
  CONSTRAINT platform_audit_events_result_code_format CHECK (result_code IS NULL OR result_code ~ '^[a-z0-9-]{1,40}$'),
  CONSTRAINT platform_audit_events_counts_non_negative CHECK (
    coalesce(batch_size, 1) > 0 AND coalesce(max_batches, 1) > 0 AND coalesce(expired_before, 0) >= 0
    AND coalesce(affected_rows, 0) >= 0 AND coalesce(batches, 0) >= 0
  ),
  -- Una ejecución tiene a lo sumo un inicio y un final.
  CONSTRAINT platform_audit_events_run_status_unique UNIQUE (run_id, status)
);
CREATE UNIQUE INDEX platform_audit_events_one_outcome_idx ON kuota.platform_audit_events (run_id)
  WHERE status <> 'started';
CREATE INDEX platform_audit_events_occurred_at_idx ON kuota.platform_audit_events (operation, occurred_at);

-- El servidor fija quién y cuándo (no se aceptan valores del ejecutor).
CREATE FUNCTION kuota.platform_audit_events_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  NEW.executed_by := session_user;
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION kuota.platform_audit_events_stamp() FROM PUBLIC;
CREATE TRIGGER platform_audit_events_stamp
  BEFORE INSERT ON kuota.platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION kuota.platform_audit_events_stamp();

-- Append-only (Constitución VII), también para el propietario. Desactivarlo exige ALTER TABLE en una migración revisada.
CREATE FUNCTION kuota.platform_audit_events_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events es append-only: % no está permitido', TG_OP
    USING ERRCODE = 'P0001', HINT = 'Las correcciones se registran como eventos nuevos (Constitución VII).';
END;
$$;
REVOKE ALL ON FUNCTION kuota.platform_audit_events_reject_change() FROM PUBLIC;
CREATE TRIGGER platform_audit_events_append_only
  BEFORE UPDATE OR DELETE ON kuota.platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION kuota.platform_audit_events_reject_change();
CREATE TRIGGER platform_audit_events_no_truncate
  BEFORE TRUNCATE ON kuota.platform_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION kuota.platform_audit_events_reject_change();

-- RLS habilitada y forzada (también al propietario). Solo una política: INSERT de mantenimiento. Sin políticas de
-- lectura: ni el runtime ni el mantenimiento leen la auditoría.
ALTER TABLE kuota.platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuota.platform_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_insert_audit ON kuota.platform_audit_events
  FOR INSERT TO kuota_maintenance
  WITH CHECK (operation = 'idempotency.purge');

REVOKE ALL ON kuota.platform_audit_events FROM PUBLIC;
GRANT INSERT ON kuota.platform_audit_events TO kuota_maintenance;

COMMIT;
