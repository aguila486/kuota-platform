# ADR-0004: PostgreSQL 18 + Prisma con Row-Level Security

- **Estado:** **Aceptado con condiciones** (2026-11-22, responsable del proyecto; D-ARC-01, cierre de T015). Prisma 7 es
  el ORM principal de Kuota. La aceptación **no** implica que las condiciones P1–P8 estén mitigadas: su estado está en
  *Condiciones de la aceptación*. Kysely sigue documentado como alternativa si aparece una limitación obligatoria que
  Prisma no pueda superar. Texto corregido antes del spike (C4-1…C4-6) para alinearlo con research R-04 y data-model.
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
- **Prisma 7.10.1 con `@prisma/adapter-pg`** como ORM y herramienta de migraciones (`prisma migrate deploy`), aceptado
  con las condiciones P1–P8 tras superar los criterios obligatorios del spike. Alternativa documentada: **Kysely** (C4-4).
- **Fuente de verdad del esquema (P4):** las migraciones SQL versionadas y revisadas. `schema.prisma` es un espejo
  derivado; Prisma no representa CHECK, RLS, FORCE, triggers, funciones ni grants.
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

Ejecutado en T014 (`pnpm --filter backend spike:rls`, tres ejecuciones completas con los mismos veredictos) sobre
PostgreSQL 18.7 efímero, Prisma 7.10.1 y `adapter-pg` 7.10.1. Informe completo: `specs/001-platform-foundation/spike-t014-report.md`.

| Criterio | Resultado observado |
|---|---|
| S1 | PASS: 0 filas sin error, en conexión nueva y en conexión reutilizada (mismo backend, variable `''`) |
| S2 | PASS: 2000 transacciones por ejecución, 0 filas cruzadas, 0 contextos heredados, 981–990 cambios de tenant sobre el mismo backend (mínimo 10) |
| S3 | PASS: `42501` en los 6 casos de privilegio y `WITH CHECK` |
| S4 | PASS: rollback ante errores de la aplicación y de la base; el mismo backend queda limpio |
| S5 | PASS: anidamiento reutiliza la transacción; otro tenant → error y rollback total. **Riesgo:** un `set_config` crudo dentro de la transacción cambia el tenant (condición P2) |
| S6 | PASS: `migrate deploy` funciona con `kuota_migrator` y falla con `kuota_app_login` sin dejar objetos |
| S7 | PASS para `$queryRaw`. **TypedSQL NO EJECUTADO** (condición P7) |
| S8 | Referencia, no gate: sobrecosto de `withTenant` p50 0,73–0,77 ms · p95 1,06–1,55 ms (local) |
| Adicional MIG-TX | FAIL: `prisma migrate deploy` no envuelve las migraciones en una transacción (condición P1) |
| Adicional MIG-TX-EXPLICIT | PASS: con `BEGIN`/`COMMIT` en el SQL no quedan cambios parciales |

Regla de decisión aplicada: S1–S6 en PASS → aceptación propuesta y aprobada por el responsable con condiciones.

## Condiciones de la aceptación

Responsable de todas: responsable técnico del proyecto (mantenedor único). Estado al 2026-11-22.

| ID | Condición | Severidad | Estado | Evidencia o prueba requerida | Hito |
|---|---|---|---|---|---|
| P1 | Migraciones con transacción explícita (`BEGIN;` primero, `COMMIT;` último); las operaciones no transaccionales van en una migración propia marcada `-- kuota:non-transactional: …` con justificación y plan de recuperación | Alta | **Cumplida localmente**: `0001_foundation` lleva `BEGIN`/`COMMIT` (no estaba desplegada en ningún entorno persistente); fallo inyectado → rollback total; convención verificada por prueba estática | `foundation-schema.spec.ts` (bloque P1), `migration-governance.spec.ts` (unit) | Gate de CI en G12 (T048) |
| P2 | Solo `common/tenant-context` fija `app.*` o cambia la identidad de sesión | Alta | **Parcial**: reglas de ESLint con 14 pruebas negativas; el lint no detecta concatenación de SQL ni funciones de base de datos | `tenant-context-guard.spec.ts` | `withTenant` definitivo (T039); gate de CI en G12 |
| P3 | `_prisma_migrations` en `public` con propietario y privilegios correctos | Media | **Cumplida**: propietario `kuota_migrator`; sin privilegios para runtime, worker simulado ni PUBLIC; sin `CREATE` en `public` para ellos; `search_path` por defecto sin esquemas escribibles por el runtime | `migration-governance.spec.ts` (integración, P3) | Reverificar al crear `kuota_worker` (P6) |
| P4 | SQL versionado como fuente de verdad; prohibidos `prisma db push`, `migrate dev` y `migrate reset` sobre esquemas compartidos; validación del esquema efectivo | Alta | **Cumplida localmente**: prohibición verificada en scripts; validación efectiva de restricciones por nombre, función, triggers, políticas, grants y propietarios; `migrate diff` vacío como complemento | `migration-governance.spec.ts` (unit e integración), `foundation-schema.spec.ts` | Gate de CI en G12 |
| P5 | Mantenimiento de datos (backfills) por tenant con autorización humana separada | Alta | **Pendiente**: procedimiento documentado (`docs/architecture/data-architecture.md` §8); **sin** política de mantenimiento ni BYPASSRLS | Prueba de filas afectadas y auditoría en el primer backfill | Antes del primer backfill |
| P6 | `kuota_worker` solo con permisos heredados de `kuota_app` cuando corresponda | Media | **Pendiente**: dirección aprobada; rol no creado. Herencia verificada solo con roles simulados | Pruebas reales de aislamiento y herencia en su tarea | Primera feature con jobs |
| P7 | TypedSQL fuera del alcance aprobado | Media | **Pendiente (no adoptado)** | Evaluación independiente de tipos, transacciones, RLS y mantenibilidad | Antes de adoptarlo (p. ej. 006) |
| P8 | Solo los scripts de instalación imprescindibles para Prisma | Media | **Cumplida**: `allowBuilds` permite solo `prisma` y `@prisma/engines`; versiones exactas 7.10.1 | Revisión de `pnpm-workspace.yaml`; escaneo de dependencias en CI | Continua; escaneo en G12 |

## Revisión

Reevaluar si el spike falla, si S8 supera el umbral aprobado o si Prisma limita funciones de PostgreSQL que el ledger
necesita.
