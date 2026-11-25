# Implementation Plan: Platform Foundation

**Branch**: `feature/001-platform-foundation` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-platform-foundation/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Construir la fundación técnica verificable del monorepo `kuota-platform`, sin funcionalidad de negocio:

- un backend NestJS ejecutable con salud y compatibilidad;
- el mecanismo de contexto de tenant con PostgreSQL RLS forzado (validado por un spike de Prisma 7 + `adapter-pg`);
- bloques reutilizables de idempotencia, auditoría append-only y dinero exacto, con fixtures numéricos compartidos con Dart;
- un contrato OpenAPI 3.1 como fuente de verdad, con lint, detección de cambios incompatibles y cliente Dart generado;
- un workspace Flutter fijado con FVM (pub workspaces + Melos 8), con tres shells de apps y cuatro paquetes (más
  `app_shell`, capa de composición añadida por la Aprobación 11 para resolver C2 de T092);
- Docker Compose local;
- CI en GitHub Actions con gates bloqueantes por componente afectado, todo reproducible localmente y sin publicar en remoto.

El enfoque técnico y las decisiones están en [research.md](research.md) (R-01..R-21).

## Technical Context

**Language/Version**: TypeScript 7.0.x (typecheck) + SWC (emisión) sobre Node.js 26 LTS; Dart 3.14 / Flutter 3.50.1 (FVM)

**Primary Dependencies**:

- **Backend:** NestJS 12, Prisma 7.10 + `@prisma/adapter-pg`, nestjs-cls 7, nestjs-pino 5, `@nestjs/terminus`, OpenTelemetry Metrics (`@opentelemetry/sdk-metrics` 3.1 + `exporter-prometheus` 0.301, R-21), decimal.js 10.
- **Calidad y contrato:** dependency-cruiser 18, Redocly CLI 2, oasdiff 1.39, openapi-generator (`dart-dio`, Docker), gitleaks 8.30, osv-scanner.
- **Dart:** Melos 8, Riverpod 3, `decimal` 3, dio 5.

**Storage**: PostgreSQL 18 (Docker Compose local), esquema `kuota`, RLS forzado; roles `kuota_migrator` / `kuota_app` / `kuota_app_login`

**Testing**:

- **Backend:** Vitest 5 (+ `unplugin-swc`, cobertura v8 con umbrales por glob), fast-check 4, Testcontainers 12 (PostgreSQL real), supertest + Ajv 2020 para pruebas de contrato.
- **Dart:** `flutter_test` / `package:test` y glados (property-based).

**Target Platform**:

- **Backend:** contenedor Linux.
- **Apps:** `admin_web` en Flutter Web; `collector_mobile` y `client_mobile` en Android e iOS. CI compila Android y Web; iOS se compila localmente.

**Project Type**: Monorepo: web-service (backend) + mobile/web apps (Flutter) + contratos compartidos

**Performance Goals**:

- CI de un cambio solo de documentación ≤ 3 min (SC-004).
- Entorno local listo ≤ 30 min desde el clon, sin contar descargas (SC-001).
- La latencia añadida por `withTenant` se mide y documenta; no es gate en 001.

**Constraints**:

- Cero punto flotante en dinero.
- RLS forzado en el 100 % de las tablas con `tenant_id`.
- Cero secretos versionados.
- Nada se publica en remoto sin aprobación.
- Sin servicios cloud.
- Sin Redis ni cola de jobs.

**Scale/Scope**: Escala de fundación (1 mantenedor, 3 apps, 4 paquetes, 1 backend, 3 tablas técnicas). El diseño de RLS y pooling se valida con ≥ 50 solicitudes concurrentes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principio | Cómo lo cumple el plan | Estado |
|---|---|---|---|
| I | Spec-Driven Development | Spec + clarificaciones aprobables; tareas trazables a FR/US; CI valida rama `feature/NNN-*` ↔ `specs/NNN-*` | ✅ |
| II | Seguridad por diseño (v1.2.0) | Security Risks y Endpoint Access en spec; los 5 endpoints son excepciones de categorías admisibles, cada una con justificación, entornos, clasificación, controles y pruebas (FR-040); `security: []` solo en los 3 públicos; dev-probe ausente fuera de local/testing (T016, T025, T096); métricas con escucha local + token (T093, T094); gitleaks + osv-scanner bloqueantes | ✅ |
| III | Aislamiento multi-tenant | RLS forzado, `set_config` local, rol sin BYPASSRLS, verificación de catálogo, suite de acceso cruzado y prueba concurrente | ✅ |
| IV | Precisión financiera | `Money` según ADR-0007 (D-FIN-01 aprobada): bigint/`BigInt` + decimal.js / `decimal` Dart, rango y forma canónica, redondeo obligatorio, fixtures compartidos en VM y web, regla anti-float | ✅ |
| V | Inmutabilidad del ledger | Ledger fuera de alcance (006); 001 provee el patrón append-only (audit_events: REVOKE + trigger) reutilizable | ✅ N/A parcial |
| VI | Idempotencia | `idempotency_keys` (PK tenant+key), interceptor `@Idempotent()`, prueba concurrente | ✅ |
| VII | Auditoría | Eventos auditables listados en spec (Auditable Events); `audit_events` en la misma transacción; prueba por comando de escritura | ✅ |
| VIII | Clean Architecture | Capas por módulo; dependency-cruiser bloqueante; `financial_domain` sin Flutter | ✅ |
| IX | Modularidad | Monolito modular; reglas de módulo; apps solo comparten vía paquetes (check_deps) | ✅ |
| X | Test-Driven Validation | Tareas de prueba preceden a implementación; umbrales 90/80 bloqueantes | ✅ |
| XI | Offline Resilience | Fuera de alcance (011); 001 deja `server_time` y compatibilidad para apps | ✅ N/A |
| XII | API Contract-First | Contrato antes del código; lint + oasdiff + cliente generado + pruebas de contrato | ✅ |
| XIII | Observabilidad | Logs JSON con correlation id/tenant, redacción PII probada, health live/ready, métricas técnicas internas y protegidas (FR-039, R-21); señales declaradas en spec (Observability Signals); alertas financieras diferidas a 006/013 | ✅ |
| XIV | Evolución compatible | Migraciones forward-only; oasdiff; endpoint de compatibilidad y versión mínima por app | ✅ |
| XV | Protección de datos | Inventario de datos personales en spec: ninguno; redacción en logs; `.env.example` sin secretos | ✅ |
| Gob. | Quality gates / mantenedor único | Gates de CI = lista de la Constitución; excepción de mantenedor único (v1.1.0, vigente en v1.2.0) aplicada | ✅ |

**Resultado pre-research**: PASA sin violaciones. **Re-check post-diseño (Phase 1)**: PASA. **Re-check 2026-11-22
(Constitución v1.2.0)**: PASA. Las excepciones de acceso de 001 no son violaciones: pertenecen a categorías admisibles
de §II y están registradas con sus cinco elementos en la tabla Endpoint Access de spec.md. La tabla de Complexity
Tracking queda vacía.

> **Decisiones cerradas el 2026-11-22**: D-FIN-01 (ADR-0007) y D-ARC-02 (Riverpod, ADR-0003). ADR-0004 sigue
> condicionado al spike T014/T015 (criterios S1–S8); `withTenant` anidado sigue ADR-0002 (C2-1).

> **Constitución**: la v1.2.0 está integrada en esta rama (merge `8e2182f`; contenido idéntico a `b63f9a4`).
> D-ARC-03 sigue pendiente: `admin_web` en Flutter Web solo de forma provisional para el shell (ADR-0003).

## Glosario (spec ↔ plan)

| Término funcional (spec) | Nombre técnico (plan / código) |
|---|---|
| Servicio central | Kuota Core: backend NestJS (`backend/`) |
| Almacén de datos | PostgreSQL 18, esquema `kuota` |
| Empresa | Tenant (`tenant_id`, GUC `app.tenant_id`) |
| Contexto técnico de empresa | `X-Kuota-Dev-Tenant` + `DevTenantGuard` (solo `local`/`testing`; no es autenticación) |
| Aislamiento por empresa a nivel de fila | Row-Level Security habilitado y forzado |
| Cuenta de aplicación / cuenta de estructura | Roles `kuota_app` (`kuota_app_login`) / `kuota_migrator` |
| Recurso técnico de demostración | Módulo `dev-probe`, tabla `dev_probe_items` |
| Registro de idempotencia | Tabla `idempotency_keys`, interceptor `@Idempotent()` |
| Bitácora de auditoría | Tabla `audit_events`, `AuditService` |
| Primitiva monetaria | `Money` (bigint/`BigInt` en unidades mínimas + ISO 4217, ADR-0007) en `backend/src/common/money` y `financial_domain` |
| Fixtures numéricos compartidos | `contracts/fixtures/money/*.json` |
| Formato estándar de errores | RFC 9457 `application/problem+json` |
| Contrato de API | OpenAPI 3.1 `contracts/openapi/kuota-core.v1.yaml` |
| Cliente móvil generado | `flutter/packages/api_client` (openapi-generator `dart-dio`) |
| Chequeo de vida / disponibilidad | `/health/live` / `/health/ready` |
| Consulta de compatibilidad | `GET /v1/meta/compatibility` |
| Métricas técnicas | OpenTelemetry + exportador Prometheus en `KUOTA_METRICS_HOST:KUOTA_METRICS_PORT` |
| Verificación de entorno | `scripts/dev/doctor.sh` |
| Dueños por área | `.github/CODEOWNERS` |

## Project Structure

### Documentation (this feature)

```text
specs/001-platform-foundation/
├── spec.md                 # Especificación (+ Clarifications 2026-11-22)
├── plan.md                 # Este archivo
├── research.md             # R-01..R-21, versiones verificadas
├── data-model.md           # Roles BD, RLS, dev_probe_items, idempotency_keys, audit_events, Money
├── quickstart.md           # Guía de validación end-to-end
├── contracts/
│   ├── kuota-core.v1.openapi.yaml   # Borrador validado (Redocly: valid, 3 warnings aceptados)
│   └── money-fixture.schema.json    # Esquema de fixtures numéricos compartidos
├── checklists/requirements.md
└── tasks.md                # (/speckit-tasks)
```

### Source Code (repository root)

```text
kuota-platform/
├── .nvmrc · package.json (raíz: scripts, packageManager pnpm@12) · pnpm-workspace.yaml · .env.example · Makefile
├── .github/
│   ├── workflows/ci.yml                 # paths-filter → general | backend | contracts | flutter
│   ├── CODEOWNERS                       # <maintainer-handle> placeholder; secciones por área
│   └── pull_request_template.md         # (existe)
├── backend/
│   ├── package.json · nest-cli.json (builder swc) · tsconfig.json · vitest.config.ts · .dependency-cruiser.cjs · eslint.config.mjs
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/                  # SQL: esquema kuota, tablas, RLS FORCE, policies, grants, triggers
│   │       ├── 0001_foundation/         # T012–T013: dev_probe_items, idempotency_keys, audit_events, RLS y grants
│   │       ├── 0002_idempotency_maintenance/  # Aprobaciones 3 y 4 (T079): purga de claves por kuota_maintenance
│   │       └── 0003_platform_audit/     # T099: platform_audit_events (auditoría de plataforma, sin tenant)
│   ├── src/
│   │   ├── main.ts · app.module.ts
│   │   ├── common/
│   │   │   ├── config/                  # validación de env; guard de arranque dev-tenant vs KUOTA_ENV
│   │   │   ├── logging/                 # pino, correlation id, redacción PII
│   │   │   ├── errors/                  # problem+json filter
│   │   │   ├── tenant-context/          # CLS, DevTenantGuard, TenantPrismaService.withTenant
│   │   │   ├── idempotency/             # @Idempotent() interceptor + repositorio
│   │   │   ├── audit/                   # AuditService (misma transacción)
│   │   │   └── money/                   # Money, RoundingMode, allocate (dominio puro)
│   │   └── modules/
│   │       ├── health/                  # live/ready (terminus)
│   │       ├── meta/                    # compatibility
│   │       └── dev-probe/               # domain/ application/ infrastructure/ interface/ (solo local/testing)
│   ├── scripts/                         # check-rls.ts, spike-rls.ts, check-no-float.ts (T065)
│   │                                    # migration-preflight.ts (Aprobación 4: preflight de solo lectura de 0002)
│   │                                    # purge-idempotency.ts (Aprobación 3, T079; auditoría de plataforma T099)
│   └── test/
│       ├── unit/ · property/            # money, fixtures, idempotency hashing
│       ├── integration/                 # Testcontainers: RLS, roles, audit append-only, idempotencia concurrente
│       ├── tenancy/                     # suite reutilizable de acceso cruzado (helper describeTenantIsolation)
│       └── contract/                    # Ajv vs bundle OpenAPI
├── contracts/
│   ├── openapi/kuota-core.v1.yaml (+ paths/, schemas/, parameters/) · redocly.yaml
│   └── fixtures/money/*.json · fixture.schema.json
├── flutter/
│   ├── .fvmrc (3.50.1) · pubspec.yaml (workspace + melos) · analysis_options.yaml · config/{local,testing,staging,production}.json
│   ├── tool/check_deps.dart
│   ├── apps/{admin_web, collector_mobile, client_mobile}/   # shells: home con nombre/entorno/versión/compatibilidad
│   └── packages/{shared_core, design_system, api_client (lib/src/generated), financial_domain, app_shell (Aprobación 11)}
├── infra/docker/
│   ├── compose.yaml                     # postgres:18 (digest), perfil app opcional
│   └── postgres/init/{01-roles.sql, 02-maintenance-roles.sql}   # 02: kuota_maintenance(_login), Aprobación 3
└── scripts/
    ├── dev/{doctor,up,down,test-all,test-affected}.sh   # up.sh: preflight de migraciones antes de migrar (Aprobación 4)
    ├── ci/{run-local,general,backend,contracts,flutter,check-no-float,check-no-float-dart,prove-gates}.sh
    └── contracts/generate-dart-client.sh
```

> **Trazabilidad (T105, 2026-11-23):** la migración 0002, `02-maintenance-roles.sql`, `migration-preflight.ts` y el
> preflight de `up.sh` se aprobaron en las Aprobaciones 3 y 4 de `approvals.md`, fuera de la estructura original; 0003 y
> la auditoría de la purga, en T099. Se registran arriba sin cambiar su alcance. `backend/test/unit/plan-traceability.spec.ts`
> falla si una migración, un script de `backend/scripts/` o un script de `infra/docker/postgres/init/` no figura aquí.

**Structure Decision**: Se usa la estructura objetivo de `docs/architecture/monorepo-strategy.md`, creando solo lo que
001 necesita.

- **No se crean en 001:** `infra/environments/`, `infra/ci/`, `docs/` adicionales (ya existen), ni módulos de negocio.
- **Ubicación de los fixtures:** `contracts/fixtures/` (R-09).
- **Paquete `offline_sync`:** no se crea en 001; se crea en 011.

## Fases de ejecución (orden recomendado para tasks)

1. **Setup**: toolchains (`.nvmrc`, corepack, FVM `.fvmrc`), workspace raíz, compose, `.env.example`, `doctor.sh`.
2. **Foundational (bloqueante)**:
   1. Spike RLS (R-04). Gate: si falla, se detiene US2+ y se activa el fallback.
   2. Esquema y roles.
   3. Configuración y logging.
   4. Errores problem+json.
   5. Contrato base en `contracts/openapi/`.
3. **US1 (P1)**: health/ready, meta/compatibility, `up.sh`, `test-all.sh`.
4. **US2 (P1)**: tenant context, `dev_probe_items`, `check-rls`, suite de acceso cruzado.
5. **US3 (P1)**: CI workflows y scripts, gates, CODEOWNERS, `prove-gates.sh`.
6. **US4 (P2)**: `Money` TS + Dart + fixtures + anti-float. Puede ir en paralelo con US2 y US3.
7. **US5 (P2)**: generación del cliente Dart (+ spike del generador), pruebas de contrato.
8. **US6 (P2)**: idempotencia y auditoría sobre `dev-probe`.
9. **US7 (P3)**: workspace Flutter, shells, `check_deps`.
10. **Polish**: documentación, protección de `main` documentada, validación completa con quickstart, registro en ADR-0004.

## Riesgos del plan

| Riesgo | Mitigación |
|---|---|
| Prisma 7 + RLS con pool no cumple los criterios de R-04 | Spike al inicio; fallback Kysely con ADR actualizado antes de US2 |
| TypeScript 7 incompatible con tipos de NestJS 12 | Fijar la última 6.x (R-02); se detecta en la tarea de scaffolding |
| openapi-generator no soporta construcciones 3.1 usadas | Spike en US5; fallback swagger_parser o contrato 3.0.3 |
| CI no verificable sin remoto | Scripts locales idénticos + actionlint; activación al aprobar la publicación |
| FVM 3.2.1 instalado frente a 4.x actual | `.fvmrc` es compatible; actualizar FVM es opcional y por usuario |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Sin violaciones; no aplica.
