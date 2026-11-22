# ADR-0004: PostgreSQL 18 + Prisma con Row-Level Security

- **Estado:** Propuesto — **condicionado a spike técnico** (tarea de la feature 001)
- **Fecha:** 2026-11-22
- **Decisores:** Responsable técnico
- **Relacionado:** Constitución III, IV, V, XIV; D-ARC-01; ADR-0005; `docs/security/multi-tenant-isolation.md`

## Contexto

Requisitos: transacciones ACID, `NUMERIC`/`BIGINT` exactos, aislamiento multi-tenant con **RLS forzado**, ledger
append-only protegido a nivel de base de datos, migraciones compatibles hacia atrás (expand → migrate → contract) y
consultas de reportes/ledger que necesitan SQL explícito.

RLS en PostgreSQL depende de un parámetro de sesión (`app.tenant_id`) fijado **por transacción** con
`set_config('app.tenant_id', $1, true)` (equivalente a `SET LOCAL`). Con *connection pooling*, fijarlo a nivel de
sesión filtraría contexto entre solicitudes; debe hacerse dentro de cada transacción.

## Opciones consideradas

| Criterio | Prisma | TypeORM | Drizzle / Kysely |
|---|---|---|---|
| Tipado de consultas | ✅ Generado desde esquema | ⚠️ Decoradores, tipado parcial | ✅ Excelente (SQL-like) |
| Migraciones | ✅ `prisma migrate` declarativo + SQL editable | ⚠️ Generación frágil | ⚠️ Drizzle-kit / manual |
| SQL crudo tipado | ✅ TypedSQL | ⚠️ `query()` sin tipos | ✅ Nativo |
| RLS por transacción | ⚠️ Requiere extensión de cliente que envuelva en transacción | ⚠️ Posible con QueryRunner | ✅ Control directo |
| `Decimal`/`BigInt` | ✅ `Decimal` (decimal.js) y `BigInt` | ⚠️ Strings | ✅ Configurable |
| Mantenimiento/comunidad | ✅ Activo | ⚠️ Mantenimiento irregular | ✅ Activo, más joven |
| Políticas RLS, triggers | ⚠️ En SQL de migración (no en el esquema) | ⚠️ Ídem | ⚠️ Ídem |

## Decisión

- **PostgreSQL 18** como base de datos única (OLTP). Réplica de lectura para reportes cuando se justifique.
- **Prisma** como ORM y herramienta de migraciones (recomendación; D-ARC-01), frente a TypeORM.
  Drizzle/Kysely queda como alternativa si el spike falla.
- Patrón RLS: **Prisma Client extension** que ejecuta cada operación de negocio dentro de una transacción y como primera
  sentencia `SELECT set_config('app.tenant_id', $1, true)` con el tenant de `TenantContext` (AsyncLocalStorage).
- Ledger, reportes y consultas complejas: **TypedSQL / SQL explícito**.
- Políticas RLS, `FORCE ROW LEVEL SECURITY`, triggers de inmutabilidad y `GRANT`s se escriben como **SQL en las
  migraciones** y se verifican con pruebas.

### Roles de base de datos

| Rol | Uso | Propiedades |
|---|---|---|
| `kuota_owner` | Propietario de tablas; solo migraciones | No usado por la app en runtime |
| `kuota_app` | Runtime de la API | Sin `BYPASSRLS`, no owner, sin `UPDATE`/`DELETE` en tablas del ledger |
| `kuota_platform` | Módulo `platform-admin` (cross-tenant) | Políticas específicas, auditado |
| `kuota_readonly` | Reportes / soporte | Solo `SELECT`, con RLS |

## Consecuencias

- **Positivas:** productividad y tipado; migraciones versionadas; SQL explícito donde la exactitud contable lo exige.
- **Negativas:** cada operación de negocio corre en transacción (costo menor aceptable); políticas RLS fuera del
  esquema Prisma (se mantienen en SQL).
- **Riesgos:** una consulta fuera de la extensión (cliente "crudo") ejecutaría sin contexto → con RLS forzado devuelve
  **0 filas** (falla segura) y además hay lint que prohíbe importar el cliente base fuera de `infrastructure/db`.

## Validación (spike obligatorio en 001)

1. Consulta sin contexto de tenant → 0 filas en tabla con RLS forzado.
2. Dos solicitudes concurrentes con tenants distintos bajo pooling → sin fuga de contexto (prueba de concurrencia).
3. `kuota_app` no puede `UPDATE`/`DELETE` en tabla de ledger de prueba.
4. Migración expand/contract de ejemplo ejecutada sobre esquema previo.
5. Medición de sobrecarga de la transacción envolvente.

Si 1–3 fallan, se rechaza Prisma y se reabre D-ARC-01.

## Revisión

Reevaluar si el spike falla, si el rendimiento de la extensión es inaceptable o si Prisma limita el uso de funciones
de PostgreSQL requeridas por el ledger.
