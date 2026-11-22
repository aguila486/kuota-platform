# Informe del spike T014 — Prisma 7 + PostgreSQL 18 RLS (insumo para T015)

> **Estado: borrador para la decisión humana de T015 (D-ARC-01).** Este informe no aprueba Prisma ni modifica
> ADR-0004. La sección "Resultado del spike" de ADR-0004 se completa en T015, tras la decisión del responsable.

## 1. Qué se ejecutó

- **Comando:** `pnpm --filter backend spike:rls` (`backend/scripts/spike-rls.ts`), dos ejecuciones completas el
  2026-11-22, con los mismos veredictos. Las cifras de este informe son de la segunda.
- **Entorno:** PostgreSQL 18.7 (imagen fijada por digest) en contenedores efímeros de Testcontainers; Node 26.13.1;
  TypeScript 6.0.3; Prisma 7.10.1 (Query Compiler, sin motor Rust de consultas) con `@prisma/adapter-pg` 7.10.1 sobre
  un `pg.Pool` propio; Docker Desktop local.
- **Configuración fija (ADR-0004):** semilla 20261122; 20 repeticiones con pool de 2, 3, 4 y 5 conexiones en ciclo;
  100 solicitudes por repetición (50 por tenant, orden barajado); retardos de 0–15 ms; `maxWait` 15 s y `timeout` 30 s.
- **Base:** migrada con el mecanismo real (`prisma migrate deploy` como `kuota_migrator`) usando la migración canónica
  `0001_foundation` (T012), que no se modificó.
- **`withTenant` del spike:** experimental y local al script. No es el componente de producción (T039).

## 2. Matriz S1–S8 (criterios originales de ADR-0004)

| Criterio | Resultado | Evidencia medida | Riesgo | Recomendación |
|---|---|---|---|---|
| S1 Contexto ausente | **PASS** | Conexión nueva: 0 filas en las 3 tablas. Conexión reutilizada (pool = 1, mismo `pg_backend_pid` 459): dentro de `withTenant` 3 filas; después, variable = `''` y 0 filas en las 3 tablas, sin error | Bajo: depende de `nullif` en todas las políticas | Mantener `db:check-rls` y la plantilla con `nullif` |
| S2 Concurrencia | **PASS** | 2000 transacciones; **0 filas cruzadas**; **0 contextos heredados** (valor previo de `app.tenant_id` siempre vacío); **981 cambios de tenant en el mismo backend físico** (mínimo 10); backends usados = tamaño del pool | Bajo | — |
| S3 Privilegios | **PASS** | SQLSTATE `42501` en los 6 casos: `UPDATE` y `DELETE` sobre `audit_events` (SQL crudo y modelo), `ALTER TABLE … DISABLE RLS`, `CREATE TABLE`, `INSERT` con `tenant_id` de otro tenant | Bajo | — |
| S4 Ruta de error | **PASS** | Excepción de la aplicación → rollback (0 filas persistidas); error de base de datos `23514` → rollback; la siguiente consulta usa el **mismo backend** (pid 780) con la variable `''` y 0 filas sin contexto | Bajo | — |
| S5 Anidamiento | **PASS** | Mismo tenant: `txid_current()` interno = externo (2794); otro tenant: `TenantContextMismatch` y la escritura externa **revertida** (0 filas) | **Medio:** un `set_config('app.tenant_id', …)` crudo dentro de la transacción **sí cambia el tenant efectivo** (1003 filas del otro tenant visibles) | Condición P2: prohibir y verificar en CI cualquier `set_config`/`SET` de `app.*` fuera de `common/tenant-context` |
| S6 Roles y migraciones | **PASS** | `migrate deploy` con `kuota_migrator`: exit 0, `_prisma_migrations` registra `0001_foundation` terminada (1 paso); 3 tablas, 3 FORCE, 3 políticas, 2 triggers. Con `kuota_app_login`: exit 1 (`permission denied for schema public`), sin esquema `kuota` ni historial creados | Ver hallazgos MIG-* | Condiciones P1 y P3 |
| S7 SQL crudo | **PASS** (`$queryRaw`) · TypedSQL **NOT RUN** | Dentro de `withTenant`: 1003 filas, todas del tenant A; fuera: 0; tenant B pidiendo filas de A con `$queryRawUnsafe`: 0 | TypedSQL no evaluado | No adoptar TypedSQL sin evaluarlo (en 006, si hace falta) |
| S8 Latencia | **PASS** (referencia, no gate) | 500 iteraciones, pool 5. Sin transacción: p50 0,189 ms · p95 0,280 ms. Con `withTenant`: p50 0,935 ms · p95 1,370 ms. **Sobrecosto: p50 0,746 ms · p95 1,090 ms** | Bajo; medido en local | Muy por debajo del umbral de reevaluación propuesto (p95 > 10 ms, pendiente de aprobación) |

**Regla de decisión de ADR-0004:** S1–S6 en PASS → se puede **proponer** aceptar Prisma; la aceptación requiere la
aprobación humana de T015.

## 3. Verificaciones adicionales pedidas por el responsable (no redefinen S1–S8)

| Verificación | Resultado | Evidencia |
|---|---|---|
| Segunda ejecución de `migrate deploy` | PASS | exit 0, "No pending migrations to apply.", 1 fila en el historial |
| Nombre de carpeta `0001_foundation` | PASS | Prisma lo acepta y lo registra tal cual (no exige prefijo de fecha) |
| Ubicación del historial | Observación | `_prisma_migrations` se crea en el esquema **`public`** (propiedad de `kuota_migrator`), no en `kuota` |
| **MIG-TX:** fallo de una migración **sin** `BEGIN`/`COMMIT` | **FAIL** | `prisma migrate deploy` **no envuelve la migración en una transacción**: la tabla creada antes del error (`kuota.spike_partial`) **queda en la base**; el historial la marca como no terminada y el siguiente despliegue se bloquea (`P3009`) |
| MIG-TX-EXPLICIT: misma migración **con** `BEGIN`/`COMMIT` en el SQL | PASS | Ningún cambio parcial; historial no terminado y bloqueo `P3009` (recuperación manual tras corregir) |

No se usó `prisma migrate resolve` en ningún caso.

## 4. Roles (sección 7 del encargo)

- **`kuota_migrator`:** puede hacer DDL (`CREATE TABLE`, `ALTER TABLE … ADD COLUMN`). Con FORCE RLS y la política
  limitada a `kuota_app`, sobre filas de tenant **`SELECT` y `UPDATE` devuelven 0 filas sin error** e `INSERT` falla
  (`42501`), aunque fije el contexto. No tiene BYPASSRLS. **Riesgo:** un backfill escrito por el migrador **no haría
  nada y no avisaría**.
  - Propuesta (requiere aprobación separada; no implementada): política `maintenance` `TO kuota_migrator` con el mismo
    predicado de tenant (`nullif(current_setting('app.tenant_id', true), '')::uuid`), creada y eliminada **dentro de la
    misma migración revisada** que hace el backfill, tenant a tenant. Además, todo backfill verifica el número de filas
    afectadas y falla si es 0 cuando se esperaban cambios. Sin BYPASSRLS y sin desactivar FORCE.
- **`kuota_worker` (simulado en el contenedor):** con `INHERIT IN ROLE kuota_app` ve exactamente las filas de su
  tenant (1003 de A, 0 sin contexto, ninguna ajena). Con `NOINHERIT` todo falla con `42501`. Conclusión: crearlo con
  `INHERIT IN ROLE kuota_app` y verificarlo con estas mismas pruebas.
- **Runtime:** cada transacción empieza con el contexto vacío (2000 de 2000), y tras rollback o excepción la conexión
  vuelve limpia al pool (S1, S4).

## 5. Introspección (`prisma db pull`)

- Representa tablas, columnas, tipos, claves, índices y los defaults `uuidv7()`, `tenant_id` y `expires_at`.
- **No representa** los 14 `CHECK`, las políticas RLS, FORCE, los triggers, la función ni los grants (solo avisos).
- **Pierde en silencio** los defaults de `audit_events.actor_id` y `audit_events.correlation_id`: existen en la base, pero
  Prisma no los lee. `schema.prisma` los omite para quedar **sin deriva** (`prisma migrate diff` contra la base migrada
  = "This is an empty migration"); el cliente exige pasarlos explícitamente.
- Conclusión: `schema.prisma` es un **espejo derivado**; la migración SQL sigue siendo la fuente canónica.

## 6. Comparación Prisma frente a Kysely

Kysely **no se ejecutó** en este spike (ADR-0004: solo se activa si fallan S1–S4 o S6). Su columna es una valoración
técnica, no evidencia medida.

| Aspecto | Prisma 7 (medido) | Kysely (no medido) |
|---|---|---|
| Seguridad multi-tenant | RLS + `withTenant` cumplen S1–S5. El aislamiento lo aporta PostgreSQL; el ORM solo debe garantizar una conexión por transacción | Igual: depende del mismo patrón |
| Transacciones | Interactivas con cliente propio; anidamiento resuelto con AsyncLocalStorage; `maxWait`/`timeout` configurables | Control explícito de la transacción y la conexión |
| RLS | Sin soporte declarativo; vive en SQL | Igual |
| SQL nativo | `$queryRaw` respeta RLS; `void` no se deserializa (`pg_sleep` exige `$executeRaw`); TypedSQL sin evaluar | SQL tipado nativo, más directo |
| Migraciones | `migrate deploy` correcto, pero **no transaccional por migración**; historial en `public`; `migrate dev`/`db push` deben prohibirse | Migraciones SQL propias (su transaccionalidad no se verificó) |
| Pooling | `pg.Pool` propio vía adaptador; reutilización verificada | `pg.Pool` propio |
| Tipado | Cliente generado, verificado con `strict` y `noUncheckedIndexedAccess`; pierde CHECK y algunos defaults | Tipos generados con `kysely-codegen` desde la base |
| Pruebas | Funciona con Testcontainers y Vitest | Previsiblemente similar |
| Observabilidad | Errores envueltos (`P2010`); el SQLSTATE hay que extraerlo de la causa | Errores de `pg` directos |
| Rendimiento | Sobrecosto de `withTenant` p95 ≈ 1,1 ms | No medido |
| Mantenimiento | Más piezas (CLI, binario `schema-engine`, cliente generado, scripts de instalación permitidos) | Menos piezas; más SQL escrito a mano |
| Monolito modular | La propiedad de tablas por módulo (D-ARC-07) no la resuelve ninguno de los dos | Igual |
| Costo de cambiar ahora | — | Bajo en 001 (T012 no cambia; rehacer T039, T041, T075 y T077 y repetir T014) |

## 7. Recomendación (no constituye la aprobación de T015)

**APPROVE PRISMA WITH CONDITIONS.** S1–S6 superan los criterios obligatorios con evidencia medida y reproducible.
Condiciones propuestas:

| ID | Condición |
|---|---|
| P1 | **Migraciones transaccionales explícitas:** toda migración nueva incluye `BEGIN`/`COMMIT` (verificado en MIG-TX-EXPLICIT), salvo sentencias que no admiten transacción, que van en migraciones propias y revisadas. Decidir si `0001_foundation` se enmienda para añadirlos. Hoy no está desplegada en ningún entorno; cambiarla requiere aprobación, ajustar la prueba de G2 que exige que no los tenga y que el helper de Testcontainers pase a `prisma migrate deploy`. Documentar el procedimiento ante `P3009` |
| P2 | **Contexto solo vía `withTenant`:** verificación automática en CI que rechace `set_config`/`SET`/`RESET` de `app.*` fuera de `common/tenant-context` (S5 demostró que un `set_config` crudo cambia el tenant) |
| P3 | **Historial de migraciones:** decidir si `_prisma_migrations` queda en `public` o en `kuota`, y verificar que `kuota_app` no tiene privilegios sobre ella (no verificado en este spike) |
| P4 | **Esquema derivado:** prohibir `prisma migrate dev` y `prisma db push`; usar `prisma migrate diff` contra la base migrada (resultado vacío) como verificación en CI |
| P5 | **Mantenimiento de datos:** aprobar por separado la política de mantenimiento del migrador y la verificación de filas afectadas antes del primer backfill |
| P6 | **`kuota_worker`:** crearlo con `INHERIT IN ROLE kuota_app` y verificarlo con las pruebas de aislamiento |
| P7 | **TypedSQL:** no adoptarlo sin evaluar el criterio S7 completo |
| P8 | **Cadena de suministro:** `prisma` y `@prisma/engines` necesitan sus scripts de instalación (descargan `schema-engine`); quedan permitidos en `allowBuilds` y se retiran si se elige Kysely |
