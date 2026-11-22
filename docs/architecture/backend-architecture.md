# Arquitectura del backend — Kuota Core

> Estado: Propuesto (2026-11-22). Decisiones: ADR-0002 (monolito modular), ADR-0004 (PostgreSQL + Prisma,
> D-ARC-01), ADR-0005 (ledger).

## 1. Stack

| Elemento | Elección | Nota |
|---|---|---|
| Runtime | Node.js 24 LTS | fijado en `.nvmrc` / `engines` |
| Lenguaje | TypeScript `strict: true`, `noUncheckedIndexedAccess` | |
| Framework | NestJS (módulos, DI, guards, interceptors) | |
| Paquetes | pnpm workspaces | sin Nx/Turborepo (reevaluar si CI > 10 min o > 5 paquetes TS) |
| BD | PostgreSQL 17 + Prisma | condicionado a spike RLS en 001 |
| Dinero | `bigint` (unidades mínimas) + `decimal.js` para cálculos intermedios | D-FIN-01, D-FIN-02 |
| Validación | contra esquemas del contrato OpenAPI (ajv) + validación de dominio | |
| Logs | pino (JSON) con redacción de campos | |
| Telemetría | OpenTelemetry (trazas + métricas) | exportador definido con D-ARC-04 |
| Pruebas | Vitest o Jest (decidir en plan 001), Testcontainers PostgreSQL, supertest | |

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
│           ├── public-api.ts      # lo único importable por otros módulos
│           └── loans.module.ts
└── test/
    ├── integration/  contract/  tenancy/   # suite de acceso cruzado
```

Reglas verificadas con `dependency-cruiser` en CI:
- `modules/*/domain/**` no importa `@nestjs/*`, `@prisma/*`, `node:http`, ni otros módulos.
- `modules/A/**` solo importa `modules/B/public-api.ts`.
- `common/**` no importa `modules/**`.

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
- Si no hay contexto, las políticas RLS evalúan `current_setting('app.tenant_id', true)` → `NULL` → 0 filas.
- Cliente con varias empresas: el token se emite para **un** tenant seleccionado; cambiar de empresa emite otro token.

## 4. Transacciones y consistencia

- **Un caso de uso = una transacción** que incluye: cambio de estado de negocio + asiento en ledger + registro de
  idempotencia + eventos en outbox + auditoría. Todo o nada.
- Aislamiento `READ COMMITTED` con bloqueo explícito (`SELECT … FOR UPDATE`) sobre el agregado (préstamo, cuenta de
  ahorro) para operaciones concurrentes; `SERIALIZABLE` evaluado para asignación de folios/garantías si el spike lo indica.
- Sin llamadas HTTP externas dentro de una transacción.

## 5. Idempotencia

1. Interceptor exige `Idempotency-Key` (UUID) en endpoints marcados `@Idempotent()` (todas las escrituras financieras).
2. Inserta `(tenant_id, key, request_hash, status='IN_PROGRESS')` con `UNIQUE(tenant_id, key)`.
3. Si ya existe con mismo hash y `COMPLETED` → devuelve la respuesta almacenada. Mismo key, hash distinto → `409`
   `idempotency-key-reused`. `IN_PROGRESS` → `409` reintentar.
4. Para comandos offline, `operation_id` del dispositivo es la clave.
5. Retención de claves: mínimo la ventana offline + margen (propuesta 30 días; las de operaciones financieras quedan
   además referenciadas por el asiento contable de forma permanente).

## 6. Eventos internos (outbox transaccional)

- Tabla `outbox_events(id, tenant_id, type, payload, created_at, processed_at)` escrita en la misma transacción.
- El worker publica a consumidores in-process (audit, notifications, reporting) con entrega *at-least-once*;
  consumidores idempotentes por `event_id`.
- No hay broker externo en v1. Si se necesita, el outbox ya es el punto de integración (requiere ADR).

## 7. Jobs

- Cola en PostgreSQL (pg-boss o equivalente; decisión en plan 001). Jobs con `tenant_id` explícito.
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
- Health: `/health/live` (proceso) y `/health/ready` (BD + migraciones aplicadas). Ver
  [deployment-architecture.md](deployment-architecture.md).
