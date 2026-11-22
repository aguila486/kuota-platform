# Quickstart & Validation Guide: Platform Foundation (001)

Guía para **validar** que 001 funciona de punta a punta una vez implementada. No contiene código de implementación.
Referencias: [contrato](contracts/kuota-core.v1.openapi.yaml), [modelo de datos](data-model.md), [research](research.md).

> Estado: guía de validación **objetivo**. Los comandos existirán al completar `tasks.md`; hoy no hay código.

## 0. Prerrequisitos

| Herramienta | Verificación | Esperado |
|---|---|---|
| Node.js 26 LTS | `nvm use` (lee `.nvmrc`) → `node -v` | `v26.x` |
| pnpm 12 | `corepack enable && pnpm -v` | `12.x` (de `packageManager`) |
| Docker | `docker compose version` | v2.x |
| FVM | `fvm --version` | ≥ 3.2 |
| Flutter (proyecto) | `cd flutter && fvm install && fvm flutter --version` | `3.50.1`, Dart `3.14.x` |
| Verificación agregada | `scripts/dev/doctor.sh` | Todo ✅; falla con versión requerida si no (US1-4) |

## 1. Entorno local (US1)

```bash
cp .env.example .env                 # valores ficticios; no contiene secretos reales (US1-3)
scripts/dev/up.sh                    # compose (PostgreSQL 18) + roles + migraciones + backend
curl -s localhost:3000/health/live   # → {"status":"ok"} (sin credenciales; nada más)
curl -s localhost:3000/health/ready  # → {"status":"ok","checks":{"database":{"status":"up"}}}
docker compose -f infra/docker/compose.yaml stop postgres
curl -s -o /dev/null -w '%{http_code}' localhost:3000/health/ready   # → 503, checks.database.status = down (US1-2)
curl -s localhost:3000/health/live   # → sigue 200
curl -s -H "Authorization: Bearer $KUOTA_METRICS_TOKEN" 127.0.0.1:9464/metrics \
  | grep -E 'http_server_request_duration_seconds|kuota_http_errors_total'          # métricas (FR-039)
curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:9464/metrics                       # → 401 sin token (FR-040)
curl -s -o /dev/null -w '%{http_code}' localhost:3000/metrics                       # → 404 en el puerto de la API
```

## 2. Pruebas de todo el monorepo (US1, FR-002)

```bash
scripts/dev/test-all.sh              # backend + contrato + flutter; termina en verde
scripts/dev/test-affected.sh main    # solo componentes cambiados vs main
```

## 3. Aislamiento multi-tenant (US2, SC-002)

```bash
pnpm --filter backend test:tenancy   # suite de acceso cruzado sobre dev_probe_items (lectura/listado/update/delete/concurrencia ≥50)
pnpm --filter backend db:check-rls   # falla si alguna tabla con tenant_id no tiene RLS habilitado+forzado
pnpm --filter backend spike:rls      # spike D-ARC-01: imprime criterios 1–5 de research R-04 con PASS/FAIL
```

Validación manual (opcional):

```bash
A=$(uuidgen); B=$(uuidgen)
curl -s -X POST localhost:3000/v1/dev/probe-items -H "X-Kuota-Dev-Tenant: $A" -H "Idempotency-Key: $(uuidgen)" \
  -H 'content-type: application/json' -d '{"label":"probe-a"}'           # → 201 con id
curl -s -o /dev/null -w '%{http_code}' localhost:3000/v1/dev/probe-items/<id-de-A> -H "X-Kuota-Dev-Tenant: $B"   # → 404
```

Esperado: arranque con `KUOTA_ENV=production KUOTA_DEV_TENANT_CONTEXT=enabled` **falla** (R-05); con
`KUOTA_ENV=staging|production` y el mecanismo deshabilitado, todo `/v1/dev/*` responde 404 (T096); en esos entornos el
arranque también falla sin `KUOTA_METRICS_TOKEN` (R-21).

## 4. Idempotencia y auditoría (US6, SC-006)

```bash
pnpm --filter backend test:idempotency   # 10 envíos (5 concurrentes) → 1 efecto, 1 audit_event; 100 repeticiones
```

Esperado adicional: duplicado concurrente → 409 con `Retry-After: 1` y, al reintentar, la respuesta original con
`Idempotent-Replayed: true`; clave expirada (> 30 días) → nuevo efecto; misma clave con body distinto → 422
`idempotency-key-reused`; `UPDATE audit_events` con
`kuota_app_login` → error de permiso.

## 5. Dinero y fixtures (US4, SC-005)

```bash
pnpm --filter backend test:money                       # ejecuta contracts/fixtures/money/*.json
cd flutter && fvm dart run melos run test:financial    # mismos fixtures en financial_domain (VM y web, ADR-0007)
scripts/ci/check-no-float.sh                           # regla anti punto flotante TS + Dart
```

## 6. Contrato (US5)

```bash
pnpm contracts:lint            # Redocly: valid
pnpm contracts:breaking main   # oasdiff: sin cambios incompatibles
scripts/contracts/generate-dart-client.sh && git diff --exit-code flutter/packages/api_client   # sin diff (FR-029)
pnpm --filter backend test:contract   # respuestas reales vs esquema (Ajv)
```

## 7. Workspace móvil (US7, SC-008)

```bash
cd flutter && fvm flutter pub get           # resolución única del workspace
fvm dart run melos run analyze && fvm dart run melos run test
fvm dart run tool/check_deps.dart           # apps no dependen de apps (US7-4)
fvm flutter run -d chrome -t apps/admin_web/lib/main.dart --dart-define-from-file=config/local.json
# collector_mobile / client_mobile en emulador Android; iOS se compila localmente (no en CI)
```

Esperado: cada app muestra nombre, entorno, versión y el resultado de `/v1/meta/compatibility`.

## 8. Quality gates (US3, SC-003)

```bash
scripts/ci/run-local.sh general    # gitleaks, editorconfig, nombre de rama, actionlint
scripts/ci/run-local.sh backend
scripts/ci/run-local.sh contracts
scripts/ci/run-local.sh flutter
scripts/ci/prove-gates.sh          # aplica 6 cambios defectuosos de referencia en un worktree temporal
                                   # y verifica que cada gate falla (secreto, float, RLS, contrato, dependencia, cobertura)
```

## 9. Criterio de "hecho" de 001

- Todas las secciones anteriores pasan en una máquina limpia, ejecutadas por alguien distinto de quien implementó (SC-001; con mantenedor único, el mantenedor valida lo
  implementado por Claude Code).
- Resultado del spike registrado en ADR-0004 (aprobado o fallback activado).
- `/speckit-analyze` sin hallazgos CRITICAL.
