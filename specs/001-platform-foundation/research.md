# Research: Platform Foundation (001)

**Fecha**: 2026-11-22 · **Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Versiones verificadas el 2026-11-22 contra los registros públicos (npm, pub.dev, nodejs.org, flutter releases,
GitHub releases). Las versiones exactas se fijan en lockfiles durante la implementación; aquí se fija la **línea mayor**.

| Herramienta | Versión verificada | Línea fijada |
|---|---|---|
| Node.js | v26.13.1 (Active LTS "Lithium"); v24.22.3 (Maintenance LTS) | **26 LTS** (`.nvmrc`, `engines`) |
| pnpm | 12.21.0 | **12.x** vía `corepack` (`packageManager`) |
| NestJS (`@nestjs/core`, CLI) | 12.6.0 / 12.0.15 | **12.x** |
| TypeScript | 7.0.2 (compilador nativo) | **7.0.x** solo typecheck (ver R-02) |
| Prisma | 7.10.1 (estable; `latest` apunta a 8.0.0-rc) | **7.10.x** + `@prisma/adapter-pg` 7.10.x |
| PostgreSQL | 18 (estable madura; 19 reciente) | **18** (imagen `postgres:18` fijada por digest) |
| Vitest | 5.1.1 | **5.x** |
| fast-check | 4.11.0 | 4.x |
| Testcontainers (`@testcontainers/postgresql`) | 12.2.2 | 12.x |
| decimal.js | 10.6.0 | 10.x |
| nestjs-cls / nestjs-pino / pino | 7.0.2 / 5.3.2 / 10.4.0 | mayores vigentes |
| dependency-cruiser | 18.8.0 | 18.x |
| @redocly/cli | 2.82.0 | 2.x |
| @stoplight/spectral-cli | 6.17.1 | 6.x |
| oasdiff | v1.39.0 | 1.39.x (binario/imagen fijada) |
| gitleaks | v8.30.1 | 8.30.x |
| Flutter / Dart | 3.50.1 stable / 3.14.0 (2026-11-20) | **3.50.1** vía FVM (`flutter/.fvmrc`) |
| FVM | 4.3.2 publicado; **3.2.1 instalado** | ≥ 3.2 (D-ENV-01 aprobada) |
| Melos | 8.10.1 (requiere Dart ^3.9) | **8.x** |
| riverpod / flutter_riverpod | 3.5.0 | 3.x |
| decimal (Dart) | 3.2.6 | 3.x |
| drift | 2.35.4 | (no se usa en 001; 011) |
| glados | 1.1.7 | 1.x (property-based Dart) |
| dio | 5.11.1 | 5.x (lo trae el cliente generado) |

---

## R-01 · Runtime de Node: 24 vs 26 LTS

- **Decision**: Node **26 LTS**.
- **Rationale**: Node 26 está en *Active LTS* y su soporte termina un año después que Node 24, que ya está en
  *Maintenance*. Para un proyecto nuevo con horizonte multianual reduce una migración de runtime. Instalarlo con
  `nvm install 26` es por usuario y no afecta Node 24 (se mantiene para otros proyectos).
- **Alternatives considered**: Node 24 (instalado hoy; menor runway). Se actualizaron ADR-0002, overview, README.

## R-02 · TypeScript 7 (compilador nativo) con decoradores de NestJS

- **Decision**: TypeScript **7.0.x** para *typecheck* (`tsc --noEmit`) y **SWC** como compilador de emisión (Nest CLI
  `builder: "swc"`, `typeCheck: false`) y transformador en pruebas (`unplugin-swc` en Vitest), con
  `decoratorMetadata: true`.
- **Rationale**: La inyección de dependencias de NestJS requiere metadatos de decoradores; SWC los emite de forma
  estable y es significativamente más rápido. El typecheck queda desacoplado de la emisión.
- **Risk / fallback**: Si TS 7 presentara incompatibilidades de tipos con `@nestjs/*` 12, se fija la última 6.x en la
  tarea de scaffolding y se registra en este documento. Criterio de verificación: `pnpm typecheck` limpio sobre el
  esqueleto.
- **Alternatives considered**: `tsc` como emisor (más lento, misma salida); `esbuild` (no emite metadatos de decoradores).

## R-03 · Runner de pruebas TypeScript: Vitest vs Jest

- **Decision**: **Vitest 5** con `unplugin-swc`, cobertura `v8` y umbrales por glob.
- **Rationale**: Arranque y modo watch más rápidos, soporte nativo de ESM/TS, umbrales de cobertura por patrón
  (necesario para "dominio financiero ≥ 90 %, resto ≥ 80 %", Constitución X), compatible con fast-check y Testcontainers.
- **Alternatives considered**: Jest 30 (default histórico de NestJS; configuración ESM/TS más pesada, sin ventaja
  diferencial). `node:test` (ecosistema de cobertura/mocks insuficiente).

## R-04 · ORM y RLS — spike D-ARC-01 (Prisma)

- **Decision**: **Prisma 7.10.x con `@prisma/adapter-pg`** (driver `pg` nativo), *condicionado a spike* (tarea dedicada).
  Patrón: `TenantPrismaService.withTenant(fn)` abre `$transaction` interactiva y ejecuta como primera sentencia
  `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)`; todo acceso a tablas de tenant pasa
  por `withTenant`. Una regla de lint prohíbe usar el cliente Prisma "crudo" fuera de `common/tenant-context`.
- **Rationale**: Prisma 7 con *driver adapter* usa un pool `pg` controlado por nosotros y elimina el motor Rust, lo que
  simplifica razonar sobre conexiones; `set_config(..., true)` es local a la transacción y desaparece al devolverse la
  conexión al pool (sin fugas). Migraciones declarativas + SQL crudo para políticas RLS, roles y triggers.
- **Criterios de aceptación del spike** (resultado se registra en `docs/decisions/ADR-0004-database-orm.md`):
  1. Consulta sin `withTenant` → 0 filas en tabla con RLS forzado.
  2. 50+ solicitudes concurrentes intercaladas de 2 tenants con pool de tamaño 2–5 → 0 filas cruzadas.
  3. `kuota_app` no puede `UPDATE`/`DELETE` en `audit_events` (error de permiso) ni `ALTER` tablas.
  4. Latencia añadida por transacción + `set_config` medida y documentada (referencia, no gate).
  5. Migraciones ejecutadas por `kuota_migrator`; runtime con `kuota_app_login`.
- **Fallback**: si falla 1–3, se evalúa **Kysely** (SQL tipado, control total de transacciones) con ADR actualizado antes
  de continuar con US2. TypeORM no es fallback (mantenimiento y tipado inferiores, ver ADR-0004).
- **Alternatives considered**: Drizzle (viable; menor madurez en migraciones con SQL personalizado), Kysely (fallback),
  TypeORM (descartado).

## R-05 · Mecanismo técnico (no productivo) de contexto de tenant

- **Decision**: En 001 el contexto se obtiene de los encabezados `X-Kuota-Dev-Tenant` (UUID) y `X-Kuota-Dev-Actor`,
  aceptados **solo** si `KUOTA_DEV_TENANT_CONTEXT=enabled` **y** `KUOTA_ENV ∈ {local, testing}`. Si la variable está
  habilitada con `KUOTA_ENV ∈ {staging, production}`, el proceso **falla al arrancar**. El guard (`DevTenantGuard`) pone
  el contexto en `nestjs-cls` (AsyncLocalStorage) igual que lo hará el guard JWT de 002, de modo que el resto del código
  no cambia al reemplazarlo.
- **Rationale**: Permite probar FR-012..FR-017 sin adelantar identidad (002). El fallo al arrancar es un control
  verificable (prueba de configuración).
- **Alternatives considered**: JWT firmados con llave de desarrollo (adelanta decisiones de 002); fijar tenant por
  variable de entorno (no permite pruebas de acceso cruzado en el mismo proceso).

## R-06 · Idempotencia

- **Decision**: Tabla `idempotency_keys` con PK `(tenant_id, key)`, `request_hash` (SHA-256 de método + ruta + cuerpo
  canónico), `status` (`IN_PROGRESS`|`COMPLETED`), respuesta almacenada, `expires_at` (30 días). Flujo:
  `INSERT … ON CONFLICT DO NOTHING` dentro de la transacción del tenant; si no inserta: hash distinto → `422`
  problem `idempotency-key-reused`; `IN_PROGRESS` → `409` problem `idempotency-request-in-progress` + `Retry-After`;
  `COMPLETED` → respuesta almacenada con encabezado `Idempotent-Replayed: true`. Interceptor NestJS
  `@Idempotent()` reutilizable. Purga por expiración: tarea manual/script en 001 (job programado se difiere).
- **Rationale**: Garantiza un único efecto con concurrencia (la PK serializa), aislado por tenant (RLS también aplica).
- **Alternatives considered**: Redis `SET NX` (Redis no está justificado aún, Constitución: Redis solo con justificación).

## R-07 · Auditoría append-only

- **Decision**: Tabla `audit_events` con RLS por tenant; `kuota_app` tiene solo `INSERT`/`SELECT`; además trigger
  `BEFORE UPDATE OR DELETE` que lanza excepción (defensa en profundidad, también contra `kuota_migrator` salvo
  desactivación explícita en migración revisada). Servicio `AuditService.record()` que escribe en la **misma
  transacción** del comando.
- **Rationale**: Constitución VII; misma transacción → no hay efecto sin auditoría ni auditoría sin efecto.
- **Alternatives considered**: Tabla particionada/hash encadenado (se evalúa en 006/015; no necesario en 001).

## R-08 · Primitiva monetaria y librerías decimales

- **Decision**:
  - **TypeScript**: `Money { amountMinor: bigint; currency: CurrencyCode }` inmutable; catálogo ISO 4217 mínimo con
    `minorUnits` (MXN=2 como ejemplo; sin asumir país). Operaciones: `add/subtract` (misma moneda),
    `multiply(factor: Decimal, rounding: RoundingMode)`, `allocate(n | ratios)` (método del mayor residuo, suma exacta),
    `parse/format` desde string. Intermedios con **decimal.js 10** en una instancia clonada
    (`Decimal.clone({ precision: 40 })`) — nunca la global — y modo de redondeo **obligatorio** por operación.
  - **Dart**: `Money` con `BigInt amountMinor` y paquete **`decimal` 3.x** (racional exacto) para factores; misma API y
    mismos modos (`HALF_UP`, `HALF_EVEN`, `DOWN`, `UP`, `FLOOR`, `CEILING`).
- **Rationale**: Constitución IV; enteros en unidades mínimas evitan errores binarios; `bigint` supera el rango seguro de
  `number` (escenario US4-4).
- **Alternatives considered**: dinero.js 2 (API orientada a formato; menos control explícito del redondeo); big.js
  (sin precisión configurable por instancia en la forma requerida).

## R-09 · Fixtures numéricos compartidos

- **Decision**: `contracts/fixtures/money/*.json` (neutral al lenguaje), validados por un JSON Schema
  (`contracts/fixtures/money/fixture.schema.json`). Cada caso: `id`, `operation`, `inputs`, `rounding`, `expected`
  (montos como string en unidades mínimas). Backend y `financial_domain` ejecutan **todos** los casos; CI falla si un
  archivo de fixtures cambia y alguno de los dos lados no se ejecutó.
- **Rationale**: `contracts/` ya es el artefacto compartido backend↔apps; evita duplicar casos.
- **Alternatives considered**: duplicar fixtures en cada paquete (diverge); `docs/` (no es código ejecutable).

## R-10 · Regla anti punto flotante

- **Decision**:
  - **TS**: ESLint (`typescript-eslint`) con override para `src/**/domain/**`, `src/common/money/**`: prohíbe la anotación
    de tipo `number` en propiedades/parámetros nombrados `*amount*|*balance*|*rate*|*fee*|*money*`, y `parseFloat`,
    `Number(`, `toFixed`, `Math.round` en esas rutas (`no-restricted-syntax`). Prueba de la regla con un archivo de
    "fixture defectuoso" que debe fallar.
  - **Dart**: script `scripts/ci/check-no-float-dart.sh` que falla si aparece `double` o `num` como tipo en
    `flutter/packages/financial_domain/lib/**` (excepto en comentarios), más `analysis_options` estricto.
- **Rationale**: verificable, simple y de bajo costo; cubre SC-003.
- **Alternatives considered**: plugin `custom_lint` en Dart (más robusto pero más complejo; reevaluar en 004).

## R-11 · Reglas de dependencias (Clean Architecture y apps)

- **Decision**: **dependency-cruiser 18** en backend: `domain/` no puede importar `@nestjs/*`, `@prisma/*`, `pg`,
  `express`, ni `infrastructure/`/`interface/`; módulos no importan internals de otros módulos (solo su `index.ts`
  público). **Flutter**: script Dart `flutter/tool/check_deps.dart` que lee los `pubspec.yaml` y falla si una app depende
  de otra app, si un paquete depende de una app, o si `financial_domain`/`shared_core` dependen de `flutter`.
- **Alternatives considered**: ESLint `import/no-restricted-paths` (menos expresivo que dependency-cruiser).

## R-12 · Generador del cliente Dart

- **Decision**: **openapi-generator `dart-dio`** ejecutado desde su imagen Docker oficial fijada por versión/digest
  (evita instalar Java localmente), salida en `flutter/packages/api_client/lib/src/generated/` (marcada
  `linguist-generated`). Script `scripts/contracts/generate-dart-client.sh`; CI regenera y falla si hay diff (FR-029).
  **Spike corto incluido**: verificar que el contrato OpenAPI 3.1 (tipos `["string","null"]`, `oneOf` de problem) genera
  código compilable; si no, fallback a **swagger_parser 2.x** (Dart puro) o bajar el contrato a 3.0.3.
- **Rationale**: generador más maduro y usado; `dio` soporta interceptores (correlation id, `X-App-Version`).
- **Alternatives considered**: swagger_parser (fallback), cliente escrito a mano (prohibido por Constitución XII).

## R-13 · Lint y compatibilidad del contrato

- **Decision**: Fuente en `contracts/openapi/kuota-core.v1.yaml` (multi-archivo con `$ref` en `paths/`, `schemas/`).
  **Redocly CLI 2** para `lint` + `bundle`; reglas propias (Spectral-compatibles vía Redocly `configurable rules`):
  `Idempotency-Key` requerido en operaciones `POST/PUT/PATCH` marcadas `x-kuota-financial: true`, respuestas de error
  `application/problem+json`, montos vía `$ref: Money`. **oasdiff** `breaking` contra el bundle de `main`.
- **Rationale**: Redocly cubre lint y bundle con una sola herramienta; Spectral queda como alternativa si se requieren
  reglas más complejas (se evita doble configuración).
- **Alternatives considered**: Spectral + otro bundler (dos herramientas para lo mismo).

## R-14 · Pruebas de contrato (respuestas reales vs contrato)

- **Decision**: Pruebas e2e (Vitest + `supertest`) validan cada respuesta contra el esquema del bundle con **Ajv 2020**
  (OpenAPI 3.1 usa JSON Schema 2020-12) mediante un helper `expectToMatchContract(res, operationId)`.
- **Alternatives considered**: Prism/Schemathesis (útiles más adelante para fuzzing; no necesarios en 001).

## R-15 · Logging y redacción de PII

- **Decision**: `nestjs-pino`; `correlation_id` desde `X-Correlation-Id` (validado como UUID) o generado (UUIDv7);
  incluido en logs y en todo problem+json. Redacción con `redact.paths` (headers `authorization`, `cookie`,
  `x-kuota-dev-*` en no-dev, campos `*.phone`, `*.email`, `*.password`, `*.otp`, `*.token`, `*.tax_id`, `*.curp`) +
  serializador que enmascara patrones (teléfonos de 10+ dígitos, correos) en mensajes libres. Prueba que escribe datos
  sensibles conocidos y verifica que no aparecen en la salida (SC-009).
- **Alternatives considered**: Winston (más lento, redacción manual).

## R-16 · Cola de jobs

- **Decision**: **No se introduce** en 001 (no hay trabajo asíncrono). Candidato futuro: `pg-boss` (PostgreSQL) cuando
  una feature lo requiera (purga de idempotencia programada, notificaciones). Redis sigue sin justificarse.

## R-17 · CI (GitHub Actions) y validación local

- **Decision**: Workflows en `.github/workflows/`: `ci.yml` con `dorny/paths-filter` → jobs `general` (siempre:
  gitleaks, editorconfig-checker, nombre de rama, actionlint), `backend`, `contracts`, `flutter` (análisis, pruebas,
  `check_deps`, build Android + Web; **iOS no en CI**, Clarification 2026-11-22). Toda lógica vive en
  `scripts/ci/*.sh` invocados por los jobs, de modo que `scripts/ci/run-local.sh <job>` reproduce CI localmente.
  `actionlint` valida los YAML. Escaneo de dependencias: `osv-scanner` sobre `pnpm-lock.yaml` y `pubspec.lock`
  (falla en severidad alta/crítica). Acciones de terceros fijadas por SHA.
- **Rationale**: FR-037 (validable localmente, no se publica sin aprobación); SC-004 (docs-only ≤ 3 min).
- **Alternatives considered**: `act` (emula runners; útil pero no instalado y no necesario si los jobs son scripts).

## R-18 · Docker Compose local

- **Decision**: `infra/docker/compose.yaml` con `postgres:18` (digest fijado), volumen nombrado, healthcheck
  `pg_isready`, script de init `infra/docker/postgres/init/01-roles.sql` que crea `kuota_migrator` (owner),
  `kuota_app` (NOLOGIN, NOBYPASSRLS) y `kuota_app_login` (LOGIN, miembro de `kuota_app`), y base `kuota_test` para
  pruebas. El backend corre en el host en desarrollo (`pnpm dev`) y opcionalmente en compose (perfil `app`).
  Comando único: `make up` (o `scripts/dev/up.sh`) → compose + migraciones + verificación de salud.
- **Alternatives considered**: backend siempre en contenedor (bucle de desarrollo más lento).

## R-19 · Estado y estructura Flutter

- **Decision**: Riverpod 3 (ADR-0003, D-ARC-02 recomendado) solo para el shell mínimo; `shared_core` expone
  `AppConfig` por entorno (`--dart-define-from-file=config/<env>.json`), `design_system` con tema claro/oscuro y
  variante `highContrastReceipt`; `api_client` generado; `financial_domain` con `Money` y fixtures. Melos 8 se configura en
  la sección `melos:` del `flutter/pubspec.yaml` raíz del workspace, solo para scripts.
- **Note**: D-ARC-02 (Riverpod vs Bloc) sigue *Pendiente* en el registro; el shell de 001 usa Riverpod de forma mínima y
  reemplazable. Si se elige Bloc, el impacto en 001 es una tarea de < 1 día.

## R-20 · CODEOWNERS con mantenedor único

- **Decision**: `.github/CODEOWNERS` con el handle del mantenedor como placeholder `<maintainer-handle>`
  (a reemplazar al crear el remoto) y secciones por área listas para agregar un segundo dueño. Reglas de protección de
  `main` documentadas en `docs/process/git-workflow.md` (FR-038) para aplicarse al publicar, con la excepción de
  mantenedor único (Constitución v1.1.0).

## R-21 · Métricas técnicas (FR-039)

- **Decision**: `@prometheus-io/client` **0.16.x** (cliente oficial de Prometheus para Node; sucesor de `prom-client`,
  que npm marca como reemplazado), usado directamente desde un módulo `common/metrics` propio, sin wrapper de NestJS.
  Expone en un servidor HTTP **separado** (`KUOTA_METRICS_PORT`, por defecto 9464) el formato de texto de Prometheus:
  métricas por defecto del proceso, histograma `http_server_request_duration_seconds{route,method,status}` (ruta como
  plantilla), `kuota_http_errors_total{code}` y gauges del pool de `adapter-pg`. Sin etiquetas de tenant (privacidad y
  cardinalidad). No se aprovisiona servidor Prometheus ni alertas (D-ARC-04); las alertas financieras se especifican
  en 006/013.
- **Rationale**: Constitución XIII exige métricas técnicas básicas. El puerto separado evita exponerlas en el listener
  público sin depender de decisiones de despliegue.
- **Alternatives considered**: `@willsoto/nestjs-prometheus` 7 (wrapper; dependencia adicional sin valor en 001);
  OpenTelemetry metrics SDK + exportador Prometheus (más piezas; candidato cuando se adopte tracing distribuido).
- **Verificado**: `npm view @prometheus-io/client version` → 0.16.1; `npm view prom-client deprecated` → "replaced by
  @prometheus-io/client" (2026-11-22).

## Incógnitas restantes

Ninguna bloqueante para el plan. Dependencias de decisión en ejecución: **D-ARC-01** (resultado del spike R-04) y
validación de generador R-12; ambas tienen fallback definido.
