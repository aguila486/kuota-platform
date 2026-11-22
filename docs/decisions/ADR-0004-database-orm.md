# ADR-0004: PostgreSQL 18 + Prisma con Row-Level Security

- **Estado:** Propuesto — **condicionado al spike T014/T015** (D-ARC-01). Prisma **no** está aprobado: su aceptación
  depende de la evidencia del spike. Texto corregido el 2026-11-22 (C4-1…C4-6) para alinearlo con
  `specs/001-platform-foundation/research.md` §R-04 y `data-model.md`.
- **Fecha:** 2026-11-22
- **Decisores:** Responsable técnico
- **Relacionado:** Constitución III, IV, V, XIV; D-ARC-01; ADR-0002 (C2-1, propagación transaccional); ADR-0005;
  ADR-0007; `docs/security/multi-tenant-isolation.md`

## Contexto

Requisitos: transacciones ACID, montos exactos (ADR-0007), aislamiento multi-tenant con **RLS forzado**, ledger
append-only protegido en la base de datos, migraciones compatibles hacia atrás (expand → migrate → contract) y SQL
explícito para reportes y ledger.

RLS depende del parámetro `app.tenant_id`, fijado **por transacción** con `set_config('app.tenant_id', $1, true)`
(equivalente a `SET LOCAL`). Con *connection pooling*, fijarlo a nivel de sesión filtraría contexto entre solicitudes.

**Contexto ausente.** Cuando una conexión ya ejecutó un `set_config(..., true)` en una transacción anterior, en la misma
sesión `current_setting('app.tenant_id', true)` devuelve `''` (cadena vacía), no `NULL`. Un cast directo `''::uuid`
produce un error en vez de 0 filas. Por eso toda política usa `nullif(..., '')` (C4-3).

## Opciones consideradas

| Criterio | Prisma 7 (`adapter-pg`) | TypeORM | Kysely |
|---|---|---|---|
| Tipado de consultas | ✅ Generado desde esquema | ⚠️ Decoradores, tipado parcial | ✅ Excelente (SQL tipado; tipos con `kysely-codegen`) |
| Migraciones | ✅ `prisma migrate` + SQL editable | ⚠️ Generación frágil | ⚠️ Migraciones SQL propias (Kysely Migrator) |
| SQL crudo | ✅ `$queryRaw`; TypedSQL (compatibilidad con driver adapters **no verificada**) | ⚠️ `query()` sin tipos | ✅ Nativo |
| RLS por transacción | ⚠️ Transacción interactiva propia (`withTenant`) | ⚠️ Posible con QueryRunner | ✅ Control directo de la transacción |
| Pool de conexiones | ✅ Pool `pg` propio vía driver adapter | ✅ | ✅ Pool `pg` propio |
| Mantenimiento/comunidad | ✅ Activo | ⚠️ Irregular | ✅ Activo |
| Políticas RLS, triggers | SQL de migración | SQL de migración | SQL de migración |

Drizzle se evaluó (research R-04) y no es fallback: menor madurez en migraciones con SQL personalizado.

## Decisión (propuesta, condicionada)

- **PostgreSQL 18** como base de datos OLTP única (Constitución, restricciones de stack). Réplica de lectura para
  reportes cuando se justifique.
- **Prisma 7.10 con `@prisma/adapter-pg`** como ORM y herramienta de migraciones, **condicionado** a los criterios del
  spike (sección *Validación*). Fallback: **Kysely** (C4-4).
- **Mecanismo (C4-2):** `TenantPrismaService.withTenant(fn)` en `backend/src/common/tenant-context/` abre una
  `$transaction` interactiva cuya primera sentencia es
  `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), set_config('app.correlation_id', $3, true)`.
  El cliente transaccional se propaga por CLS y es el único acceso a datos de los repositorios. El comportamiento con
  llamadas anidadas está definido en ADR-0002 (C2-1): mismo tenant → reutiliza la transacción; tenant distinto → error.
- **Lint (C4-2):** solo `backend/src/common/tenant-context/**` puede importar o instanciar el cliente Prisma base
  (`no-restricted-imports` + dependency-cruiser). Los repositorios reciben el cliente transaccional.
- **Políticas (C4-3):** plantilla canónica en `specs/001-platform-foundation/data-model.md`:
  `USING / WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`. Una función equivalente
  `app_current_tenant()` (ver `docs/security/multi-tenant-isolation.md` §4) es aceptable. Sin contexto → 0 filas.
- **SQL crudo:** `$queryRaw` solo dentro de `withTenant`. TypedSQL se adopta únicamente si el criterio S7 lo verifica
  con el driver adapter (C4-6).
- Políticas RLS, `FORCE ROW LEVEL SECURITY`, triggers de inmutabilidad y `GRANT`s se escriben como **SQL en las
  migraciones**. El verificador de catálogo `db:check-rls` falla si una tabla del esquema `kuota` con `tenant_id`
  carece de RLS habilitado, forzado o de política.

### Roles de base de datos (C4-1)

| Rol | Uso | Propiedades | Se crea en |
|---|---|---|---|
| `kuota_migrator` | Migraciones (CI/CD y local) | Propietario de esquema y tablas; DDL. Nunca en runtime | 001 |
| `kuota_app` | Privilegios de la API | `NOLOGIN`, sin `BYPASSRLS`, no propietario, sin DDL, sin `UPDATE`/`DELETE` en ledger y auditoría | 001 |
| `kuota_app_login` | Credencial de la API | `LOGIN`, miembro de `kuota_app` | 001 |
| `kuota_worker` | Proceso worker (ADR-0002, C2-3) | Como `kuota_app` + DML en tablas de cola/outbox; sujeto a RLS | Primera feature con jobs |
| `kuota_platform` | Módulo `platform-admin` | Cross-tenant solo vía funciones `SECURITY DEFINER` auditadas; conexión separada | 002 |
| `kuota_readonly` | Reportes y soporte | Solo `SELECT`, sujeto a RLS | Cuando se requiera |

## Consecuencias

- **Positivas:** tipado y migraciones versionadas; contexto local a la transacción, seguro con pooling (incluido
  PgBouncer en modo *transaction*); falla segura (0 filas) sin contexto.
- **Negativas:** cada operación de negocio corre en una transacción; las políticas RLS viven fuera del esquema Prisma.
- **Riesgos:** acceso fuera de `withTenant` → 0 filas o violación de `WITH CHECK` (falla segura) y regla de lint;
  dependencia de que el spike demuestre los criterios S1–S7.

## Validación — spike T014 (criterios S1–S8)

Configuración fija y reproducible: pool `pg` de 2 a 5 conexiones, `maxWait` y `timeout` de transacción explícitos,
semilla fija para los retardos, 20 repeticiones. Script `backend/scripts/spike-rls.ts`
(`pnpm --filter backend spike:rls`), que imprime PASS/FAIL por criterio.

| # | Criterio | PASS si | Gate |
|---|---|---|---|
| S1 | Contexto ausente | 0 filas **y sin error**, en una conexión nueva y en una que ya ejecutó `withTenant` (forzado con pool = 1) | Sí |
| S2 | Concurrencia | ≥ 50 solicitudes intercaladas de 2 tenants; 0 filas cruzadas; **evidencia de reutilización**: el mismo `pg_backend_pid()` atendió a ambos tenants al menos 10 veces | Sí |
| S3 | Privilegios | `UPDATE`/`DELETE` sobre `audit_events` y `ALTER TABLE` con `kuota_app_login` → error de permiso; `INSERT` con otro `tenant_id` → violación de `WITH CHECK` | Sí |
| S4 | Ruta de error | Una excepción dentro de `withTenant` → ROLLBACK; la siguiente transacción en el mismo backend, sin contexto → 0 filas | Sí |
| S5 | Anidamiento y propagación | `withTenant` anidado con el mismo tenant reutiliza la transacción (un solo `txid_current()`); con otro tenant lanza error y revierte todo | Sí |
| S6 | Roles y migraciones | `migrate deploy` funciona con `kuota_migrator`; con `kuota_app_login` falla | Sí |
| S7 | SQL crudo | `$queryRaw` dentro de `withTenant` respeta RLS; TypedSQL con `adapter-pg` compila y respeta RLS (solo si se va a adoptar) | Sí, si se adopta TypedSQL |
| S8 | Latencia | p50 y p95 del sobrecosto de transacción + `set_config` registrados | No (referencia) |

- **Regla de decisión:**
  - S1–S6 en PASS → se propone aceptar Prisma (requiere aprobación humana en T015).
  - Falla cualquiera de S1–S4 o S6 → se activa el fallback Kysely y se repite el spike con él.
  - Falla S5 o S7 → solución alternativa documentada aquí antes de decidir.
- **Umbral de reevaluación de S8:** propuesta p95 > 10 ms en local; **pendiente de aprobación**; no es gate.
- **Migración expand/contract de ejemplo:** ya no es criterio del spike (no informa la decisión sobre RLS); se valida
  en la primera feature con cambio de esquema (Constitución XIV).

## Fallback: Kysely (C4-4)

- `kysely` 0.29 + `pg`; tipos con `kysely-codegen` 0.20; migraciones SQL versionadas (Kysely Migrator) ejecutadas con
  `kuota_migrator`; `withTenant` equivalente con `db.transaction().execute()` y el mismo `set_config`.
- Debe superar los mismos criterios S1–S7. Se pierden el lenguaje de esquema y `prisma migrate`; se gana control
  explícito de conexiones y transacciones.
- Costo en 001: rehacer T012, T039, T041, T075 y T077 y repetir T014. El costo crece con cada feature; por eso el gate
  está en la Fase 2 de 001.

## Resultado del spike

_Pendiente: T014/T015 no se han ejecutado._

## Revisión

Reevaluar si el spike falla, si S8 supera el umbral aprobado o si Prisma limita funciones de PostgreSQL que el ledger
necesita.
