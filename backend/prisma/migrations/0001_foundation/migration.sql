-- =====================================================================================================================
-- Migración 0001_foundation — 001-platform-foundation (T012 + T013)
--
-- Fuente: specs/001-platform-foundation/data-model.md; ADR-0004 (C4-1 roles, C4-3 política con nullif); research R-07.
-- Se aplica con `prisma migrate deploy` como kuota_migrator (propietario); ADR-0004, aceptado con condiciones.
-- Transacción explícita (condición P1): `prisma migrate deploy` no envuelve las migraciones en una transacción, así que
-- un fallo a mitad dejaría cambios parciales. Todas estas sentencias admiten ejecutarse dentro de una transacción.
-- Requiere PostgreSQL 18 (uuidv7() nativo).
-- =====================================================================================================================

BEGIN;

CREATE SCHEMA kuota AUTHORIZATION kuota_migrator;
REVOKE ALL ON SCHEMA kuota FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------------------------------
-- dev_probe_items — recurso técnico de demostración (FR-017). Solo se expone con KUOTA_ENV ∈ {local, testing}.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE kuota.dev_probe_items (
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  -- Tomado del contexto de la transacción, nunca del body (FR-012). Sin contexto → NULL → NOT NULL falla (fail-closed).
  tenant_id           uuid        NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
  label               text        NOT NULL,
  sample_amount_minor bigint,
  sample_currency     char(3),
  version             integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_probe_items_pkey PRIMARY KEY (id),
  -- Habilita FK compuestas (tenant_id, id) y la paginación por cursor dentro del tenant.
  CONSTRAINT dev_probe_items_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dev_probe_items_label_length CHECK (char_length(label) BETWEEN 1 AND 120),
  -- Monto y moneda van juntos (data-model.md: "requerido si hay monto").
  CONSTRAINT dev_probe_items_amount_currency CHECK ((sample_amount_minor IS NULL) = (sample_currency IS NULL)),
  CONSTRAINT dev_probe_items_currency_format CHECK (sample_currency ~ '^[A-Z]{3}$'),
  -- Dominio simétrico de Money (ADR-0007): el mínimo absoluto de BIGINT queda fuera.
  CONSTRAINT dev_probe_items_amount_domain CHECK (sample_amount_minor <> -9223372036854775808),
  CONSTRAINT dev_probe_items_version_positive CHECK (version >= 1)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- idempotency_keys — claves de idempotencia por tenant (FR-023, FR-024). PK compuesta: la misma clave en dos tenants
-- son operaciones independientes (US6-3).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE kuota.idempotency_keys (
  tenant_id       uuid        NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
  key             text        NOT NULL,
  request_hash    text        NOT NULL,
  method          text        NOT NULL,
  path            text        NOT NULL,
  status          text        NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- now() es la hora de inicio de la transacción: con ambos valores por defecto, expires_at = created_at + 30 días.
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (tenant_id, key),
  CONSTRAINT idempotency_keys_key_format CHECK (char_length(key) BETWEEN 8 AND 128 AND key ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT idempotency_keys_request_hash_sha256 CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_keys_method_format CHECK (method ~ '^[A-Z]+$'),
  CONSTRAINT idempotency_keys_status_values CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  -- Solo se almacenan respuestas 2xx y 4xx deterministas; una clave COMPLETED siempre tiene respuesta.
  CONSTRAINT idempotency_keys_response_status_range
    CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 299 OR response_status BETWEEN 400 AND 499),
  CONSTRAINT idempotency_keys_completed_has_response CHECK (status <> 'COMPLETED' OR response_status IS NOT NULL),
  CONSTRAINT idempotency_keys_expiry_after_creation CHECK (expires_at > created_at)
);

-- Purga manual de claves expiradas (T079, R-16).
CREATE INDEX idempotency_keys_expires_at_idx ON kuota.idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------------------------------------------------
-- audit_events — bitácora append-only (FR-025, Constitución VII). Escrita en la misma transacción del caso de uso.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE kuota.audit_events (
  id              uuid        NOT NULL DEFAULT uuidv7(),
  tenant_id       uuid        NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
  actor_id        text        NOT NULL DEFAULT nullif(current_setting('app.actor_id', true), ''),
  actor_type      text        NOT NULL,
  -- NULL en 001; desde 002 lo asigna AuditService desde el contexto de autorización del servidor.
  actor_role      text,
  action          text        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  changes         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  device_time     timestamptz,
  origin          text        NOT NULL,
  correlation_id  text        NOT NULL DEFAULT nullif(current_setting('app.correlation_id', true), ''),
  idempotency_key text,
  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_actor_type_values CHECK (actor_type IN ('USER', 'DEVICE', 'SYSTEM', 'DEV')),
  CONSTRAINT audit_events_changes_object CHECK (jsonb_typeof(changes) = 'object')
);

-- Consulta de la bitácora por tenant y tiempo (encabezado por tenant_id, como el predicado RLS).
CREATE INDEX audit_events_tenant_occurred_at_idx ON kuota.audit_events (tenant_id, occurred_at);

-- Append-only, defensa en profundidad (R-07): bloquea UPDATE/DELETE/TRUNCATE incluso al propietario. Desactivarlo
-- exige ALTER TABLE (solo el propietario, en una migración revisada).
CREATE FUNCTION kuota.audit_events_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events es append-only: % no está permitido', TG_OP
    USING ERRCODE = 'P0001', HINT = 'Las correcciones se registran como eventos nuevos (Constitución VII).';
END;
$$;
REVOKE ALL ON FUNCTION kuota.audit_events_reject_change() FROM PUBLIC;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON kuota.audit_events
  FOR EACH ROW EXECUTE FUNCTION kuota.audit_events_reject_change();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON kuota.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION kuota.audit_events_reject_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- Row-Level Security (Constitución III; ADR-0004 C4-3): habilitada y FORZADA (aplica también al propietario).
-- Política estándar de data-model.md. Sin contexto → nullif(..., '') → NULL → ninguna fila (también cuando la
-- conexión ya usó set_config local y la variable vale '').
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE kuota.dev_probe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuota.dev_probe_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kuota.dev_probe_items
  FOR ALL TO kuota_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE kuota.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuota.idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kuota.idempotency_keys
  FOR ALL TO kuota_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE kuota.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuota.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kuota.audit_events
  FOR ALL TO kuota_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------------------------------------------------
-- Privilegios (T013; data-model.md §Roles): kuota_app sin DDL; DML en dev_probe_items e idempotency_keys; solo
-- SELECT/INSERT en audit_events. kuota_app_login los hereda como miembro de kuota_app.
-- ---------------------------------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA kuota TO kuota_app;
REVOKE ALL ON kuota.dev_probe_items, kuota.idempotency_keys, kuota.audit_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON kuota.dev_probe_items, kuota.idempotency_keys TO kuota_app;
GRANT SELECT, INSERT ON kuota.audit_events TO kuota_app;

COMMIT;
