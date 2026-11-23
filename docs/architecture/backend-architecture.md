# Arquitectura del backend — Kuota Core

> Estado: Propuesto (2026-11-22). Decisiones: ADR-0002 (monolito modular), ADR-0004 (PostgreSQL + Prisma,
> D-ARC-01), ADR-0005 (ledger).

## 1. Stack

| Elemento | Elección | Nota |
|---|---|---|
| Runtime | Node.js 26 LTS | fijado en `.nvmrc` / `engines` |
| Lenguaje | TypeScript `strict: true`, `noUncheckedIndexedAccess` | |
| Framework | NestJS (módulos, DI, guards, interceptors) | |
| Paquetes | pnpm workspaces | sin Nx/Turborepo (reevaluar si CI > 10 min o > 5 paquetes TS) |
| BD | PostgreSQL 18 + Prisma | condicionado al spike T014/T015 (ADR-0004) |
| Dinero | `bigint` (unidades mínimas) + `decimal.js` para cálculos intermedios | ADR-0007 (D-FIN-01); redondeo de negocio D-FIN-02 |
| Validación | contra esquemas del contrato OpenAPI (ajv) + validación de dominio | |
| Logs | pino (JSON) con redacción de campos | |
| Telemetría | OpenTelemetry (trazas + métricas) | exportador definido con D-ARC-04 |
| Pruebas | Vitest 5 (research R-03 de 001), fast-check, Testcontainers PostgreSQL, supertest | |

## 2. Estructura de carpetas

```text
backend/
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/                # SQL generado + SQL manual (RLS, grants, triggers)
├── src/
│   ├── main.ts                    # proceso API
│   ├── main.worker.ts             # proceso worker (mismo código)
│   ├── app.module.ts
│   ├── common/                    # sin lógica de negocio
│   │   ├── money/                 # Money (bigint + currency), Rate, rounding
│   │   ├── tenant-context/        # AsyncLocalStorage + TenantPrismaService
│   │   ├── idempotency/           # interceptor + repositorio
│   │   ├── outbox/                # publicación transaccional de eventos internos
│   │   ├── errors/                # DomainError → problem+json
│   │   ├── logging/  config/  health/  clock/
│   └── modules/
│       └── loans/
│           ├── domain/            # entidades, value objects, LoanEngine puro — SIN imports de Nest/Prisma
│           ├── application/       # casos de uso (commands/queries), puertos (interfaces)
│           ├── infrastructure/    # repositorios Prisma, adaptadores
│           ├── interface/http/    # controllers, mapeo DTO ↔ comando
│           ├── index.ts           # API pública: lo único importable por otros módulos
│           └── loans.module.ts
└── test/
    ├── integration/  contract/  tenancy/   # suite de acceso cruzado
```

Reglas verificadas con `dependency-cruiser` en CI:
- `modules/*/domain/**` no importa `@nestjs/*`, `@prisma/*`, `node:http`, ni otros módulos.
- `modules/A/**` solo importa `modules/B/index.ts` (API pública del módulo).
- Un módulo no importa su propio `index.ts` (evita ciclos a través del barrel).
- `common/**` no importa `modules/**`.

**Decisión (G7a de 001, 2026-11-22):** la API pública de un módulo es su `index.ts` (la convención que ya aplicaba
dependency-cruiser desde T010). Sustituye al nombre `public-api.ts` usado en versiones anteriores de este documento;
donde ADR-0002 dice `public-api.ts` debe leerse `index.ts` (corrección de nombre pendiente de aprobación en ese ADR).

## 3. Contexto de tenant

```mermaid
sequenceDiagram
    participant R as Request
    participant G as AuthGuard + TenantGuard
    participant ALS as AsyncLocalStorage
    participant UC as Caso de uso
    participant DB as PostgreSQL
    R->>G: JWT (sub, tenant_id, roles, device_id)
    G->>G: verifica firma, membresía activa, permiso del endpoint
    G->>ALS: run({tenantId, actorId, roles, correlationId})
    ALS->>UC: ejecutar
    UC->>DB: BEGIN; SELECT set_config('app.tenant_id', $1, true); set_config('app.actor_id', ...)
    UC->>DB: consultas (RLS filtra por current_setting('app.tenant_id'))
    UC->>DB: COMMIT
```

- El `tenant_id` proviene **solo** del token verificado (o del job encolado), nunca del body/query.
- `TenantPrismaService` expone `withTenant(fn)` que abre transacción interactiva y fija `set_config(..., true)`
  (local a la transacción, seguro con pooling). Acceso a Prisma fuera de `withTenant` está prohibido por lint.
  Llamadas anidadas y propagación entre módulos: ADR-0002 (C2-1).
- Si no hay contexto, las políticas RLS evalúan `nullif(current_setting('app.tenant_id', true), '')` → `NULL` → 0 filas.
- Cliente con varias empresas: el token se emite para **un** tenant seleccionado; cambiar de empresa emite otro token.

## 4. Transacciones y consistencia

- **Un caso de uso = una transacción** que incluye: cambio de estado de negocio + asiento en ledger + registro de
  idempotencia + eventos en outbox + auditoría. Todo o nada.
- Aislamiento `READ COMMITTED` con bloqueo explícito (`SELECT … FOR UPDATE`) sobre el agregado (préstamo, cuenta de
  ahorro) para operaciones concurrentes; `SERIALIZABLE` evaluado para asignación de folios/garantías si el spike lo indica.
- Sin llamadas HTTP externas dentro de una transacción.

## 5. Idempotencia

Mecanismo base implementado en 001 (definición canónica: `specs/001-platform-foundation/data-model.md`
§`idempotency_keys` y research R-06):

1. El interceptor `@Idempotent()` exige `Idempotency-Key` (8–128 caracteres `[A-Za-z0-9_-]`, recomendado UUID).
2. Todo ocurre en la transacción del caso de uso, bajo `pg_try_advisory_xact_lock(tenant, key)`: sin bloqueo → `409`
   `idempotency-request-in-progress` + `Retry-After`; mismo hash y `COMPLETED` → respuesta almacenada con
   `Idempotent-Replayed: true`; hash distinto → `422` `idempotency-key-reused`; clave expirada → se trata como nueva.
3. Retención de 30 días: **solo para el alcance técnico de 001**. Las operaciones financieras (007) y los comandos
   offline (011, `operation_id` como clave) definen su propia política (FR-024 de 001; ADR-0005 C5-6; ADR-0006 C6-6).

## 6. Eventos internos (outbox transaccional)

- Tabla `outbox_events(id, tenant_id, type, payload, created_at, processed_at)` escrita en la misma transacción.
- El worker publica a consumidores in-process (audit, notifications, reporting) con entrega *at-least-once*;
  consumidores idempotentes por `event_id`.
- No hay broker externo en v1. Si se necesita, el outbox ya es el punto de integración (requiere ADR).

## 7. Jobs

- Cola en PostgreSQL (pg-boss o equivalente). 001 no introduce cola (research R-16); se decide con la primera feature
  que tenga jobs. Jobs con `tenant_id` explícito y rol `kuota_worker` (ADR-0002, C2-3).
- Jobs planificados: devengo diario (si D-FIN-04/D-FIN-06 lo requieren), detección de cuotas vencidas, cierre de ciclos
  de ahorro, reconciliación del ledger (alerta si desbalance), limpieza de idempotencias, expiración de OTP.
- Reloj inyectado (`Clock`) para pruebas deterministas; zona horaria del tenant para fechas de negocio.

## 8. Errores

- Errores de dominio tipados (`DomainError` con `code`) → RFC 9457 `application/problem+json` con `type`
  `https://errors.kuota.app/<code>`, `title`, `status`, `detail`, `correlation_id`. Nunca stack traces ni SQL al cliente.
- Errores de autorización sobre recursos de otro tenant devuelven **404** (no revelar existencia).

## 9. Validación

1. Formato: esquema del contrato OpenAPI (requests y, en pruebas, responses).
2. Aplicación: permisos, estado del agregado, existencia en el tenant.
3. Dominio: invariantes (montos > 0, moneda coincide, cuota existe, etc.).

## 10. Logging y configuración

- Logs JSON: `ts, level, msg, correlation_id, tenant_id, actor_id, module, route, duration_ms`. Redacción obligatoria:
  `phone, name, email, curp, rfc, address, otp, pin, password, token, authorization`.
- Configuración por variables de entorno validadas al arranque (esquema tipado); arranque falla si falta una variable.
  Secretos solo vía entorno/gestor de secretos; nunca en repo. `.env.example` con valores ficticios.
- Health: `/health/live` (proceso) y `/health/ready` (BD; verificar migraciones es la decisión pendiente D-ARC-06).
  Acceso público con respuesta mínima según la Constitución §II. Métricas internas y protegidas (research R-21 de
  001). Ver [deployment-architecture.md](deployment-architecture.md).
- Auditoría: `common/audit` es el mecanismo de escritura; el módulo `audit` (015) solo consulta (ADR-0002).
