# Evaluación de riesgo residual P2 — contexto de tenant en PostgreSQL

- **Fecha:** 2026-11-22 (tras G7a de 001: T038, T039, T043)
- **Alcance:** condición P2 de ADR-0004 ("solo `common/tenant-context` fija `app.*` o cambia la identidad de sesión").
- **Estado de P2:** **PARCIAL**. Este documento no cambia la aprobación de ADR-0004 ni declara la condición mitigada.
- **Relacionado:** ADR-0002 (C2-1), ADR-0004 (C4-2, P2), `docs/security/threat-model.md`,
  `docs/security/multi-tenant-isolation.md`, `specs/001-platform-foundation/spike-t014-report.md` (S5).

## 1. Hallazgo

El aislamiento entre tenants descansa en RLS con la política
`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`. `app.tenant_id` es un parámetro de sesión de
PostgreSQL: **cualquier sentencia ejecutada con la credencial de runtime puede cambiarlo** (`set_config`, `SET`). G7a
añadió a `withTenant` una verificación antes del COMMIT que revierte la transacción si el valor cambió, pero:

- **No evita fugas de lectura.** Entre el cambio y el COMMIT, las lecturas ya devolvieron filas de otro tenant; el
  rollback deshace escrituras, no lecturas (`tenant-prisma.spec.ts`, "intento de eludir withTenant").
- **RLS no es autenticación.** Protege frente a consultas de la aplicación sin contexto o con el contexto correcto; no
  frente a SQL arbitrario ejecutado con la misma credencial (`rls-database.spec.ts`, "LÍMITE DE CONFIANZA").

## 2. Modelo de amenazas

| Origen de la consulta | ¿Puede cambiar `app.tenant_id`? | ¿Dentro del modelo aprobado? |
|---|---|---|
| Consultas de modelo de Prisma (`tx.modelo.findMany`, etc.) | No: Prisma genera SQL fijo; los valores van como parámetros | Sí: es la vía normal |
| `$queryRaw`/`$executeRaw` con plantilla etiquetada | Solo si el **texto estático** de la plantilla contiene el cambio; los valores interpolados son parámetros y nunca se ejecutan como SQL | Sí: el texto lo revisa el lint P2 y la revisión de código |
| SQL dinámico (`$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw`, `Prisma.sql`) | Sí | No permitido: fuera del tipo `TenantTransaction`; lint lo prohíbe; `Prisma` solo se importa en `tenant-context` |
| Inyección SQL desde una entrada HTTP | Solo si una entrada llegara al texto del SQL | Sí, debe impedirse. Hoy no existe ninguna ruta (§3) |
| Código de aplicación defectuoso | Sí (p. ej. compartir el cliente transaccional, plantilla con `set_config`) | Sí: controles estáticos, revisión y pruebas; riesgo residual documentado |
| Código malicioso en el repositorio o en una dependencia | Sí | Parcialmente: revisión de PR, dependencias fijadas, `allowBuilds` (P8); RLS no lo contiene |
| Acceso directo a PostgreSQL con la credencial de runtime (credencial filtrada, RCE) | Sí | **Fuera del alcance de RLS.** El threat model lo trata con secretos rotables, red privada y mínimos privilegios (sin DDL, sin BYPASSRLS, sin TRUNCATE) |

## 3. Rutas reales de ataque (inspección del código en `2b3e9d9`, fin de G7a)

- **Entradas HTTP que llegan a SQL:** ninguna. Los únicos puntos que ejecutan SQL son:
  - la sonda de readiness, con el texto constante `SELECT 1`;
  - `withTenant`, que ejecuta `set_config` con tres parámetros enlazados:
    - el tenant: UUID validado por `DevTenantGuard` y por `establishTenantContext`;
    - el actor: `^[A-Za-z0-9_.:-]{1,64}$`;
    - la correlación: UUID validado o generado.

  Ningún controlador de producción usa todavía `TenantPrismaService`; dev-probe llega en G7b.
- **Cambiar `app.tenant_id` fuera de `tenant-context`:** lint P2 sobre literales y plantillas; dependency-cruiser y
  lint impiden importar el cliente Prisma generado o `@prisma/*`. **Huecos conocidos, con prueba que los fija**
  (`tenant-context-guard.spec.ts`, "LÍMITE conocido"):
  - SQL armado por concatenación dentro de un `TemplateStringsArray` fabricado;
  - `SET search_path`.

  Ambos requieren código escrito deliberadamente así; no los alcanza una entrada externa.
- **Métodos raw permitidos:** solo `$queryRaw`/`$executeRaw` con plantilla etiquetada (la forma `Prisma.Sql` exige
  importar el cliente generado, restringido). `TenantTransaction` excluye `$queryRawUnsafe`, `$executeRawUnsafe` y
  `$transaction`.
- **Consultas antes de fijar el tenant:** no. La primera sentencia de la transacción es `set_config`; sin contexto,
  `withTenant` falla antes de abrir conexión. Sin contexto, RLS devuelve 0 filas.
- **Prisma sin `withTenant`:** el `PrismaClient` es privado del servicio; no se exporta ni puede importarse fuera de
  `tenant-context`.
- **Capacidad del cliente transaccional que no está restringida (hallazgo):** el cliente no comprueba el contexto en
  cada llamada. Si código defectuoso **comparte la referencia `tx`** con otra operación mientras la transacción sigue
  abierta (p. ej. guardándola en un singleton), esa operación lee como el tenant de la transacción. Evidencia:
  `tenant-prisma.spec.ts`, "RIESGO RESIDUAL P2: referencia filtrada del cliente transaccional". Al cerrarse la
  transacción la referencia deja de funcionar.

**Conclusión:** no hay ninguna vulnerabilidad de acceso cruzado explotable desde entradas externas. Los riesgos
restantes requieren código defectuoso o malicioso dentro del servicio, o la credencial de runtime.

## 4. Controles

| Tipo | Control | Verificación |
|---|---|---|
| Preventivo (estático) | Lint P2: `set_config`, `app.*`, `SET/RESET` de rol, sesión, `row_security`; prohibidos `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw` | Pruebas negativas en `tenant-context-guard.spec.ts` |
| Preventivo (estático) | Lint T038: solo `tenant-context` escribe las claves de contexto en CLS o importa `establish-context` | Ídem |
| Preventivo (estático) | dependency-cruiser: cliente Prisma generado, `@prisma/*` y `establish-context` solo en `tenant-context` | `dependency-rules.spec.ts` |
| Preventivo (tipos) | `TenantTransaction` sin SQL dinámico ni `$transaction` | `@ts-expect-error` comprobado por `typecheck` |
| Preventivo (runtime) | Tenant solo desde `TenantContext` (inmutable por operación); validación de UUID y actor; parámetros enlazados | `tenant-context.spec.ts`, `establish-context.spec.ts` |
| Preventivo (base de datos) | RLS + FORCE; `kuota_app_login` sin BYPASSRLS, sin DDL, sin TRUNCATE ni propiedad | `rls-database.spec.ts`, `db:check-rls` |
| Detectivo (runtime) | `app.tenant_id` verificado antes del COMMIT → rollback | `tenant-prisma.spec.ts` (deshace escrituras, **no lecturas**) |
| Detectivo (catálogo) | `db:check-rls` | `check-rls.spec.ts` |
| Revisión | Todo SQL raw nuevo se revisa en PR (CODEOWNERS, G12/US3) | Pendiente de G12 |

## 5. Matriz de riesgo residual

| # | Amenaza | Prerrequisitos | Impacto | Evidencia | Controles existentes | Riesgo residual | Mitigación propuesta | Hito |
|---|---|---|---|---|---|---|---|---|
| R1 | Plantilla raw con `set_config`/`SET app.*` | Código que pase la revisión y el lint (texto estático) | Lectura cruzada; escrituras revertidas | S5; prueba de manipulación | Lint P2, verificación antes del COMMIT | Bajo | Gate de CI del lint (G12); revisión obligatoria de SQL raw | G12 |
| R2 | SQL por concatenación en plantilla fabricada | Código deliberadamente ofuscado | Lectura cruzada | Prueba "LÍMITE conocido" | Revisión; verificación antes del COMMIT (solo escrituras) | Bajo–medio | Prohibir `$queryRaw`/`$executeRaw` fuera de una lista de archivos revisados (lint) | Antes del primer módulo de negocio con SQL raw |
| R3 | Referencia `tx` compartida entre operaciones | Código defectuoso (singleton, caché, cierre capturado) | Lectura y escritura cruzadas durante la transacción | Prueba "referencia filtrada" | Ninguno específico | **Medio** | Envolver `tx` en un proxy que compruebe en cada llamada que el tenant del contexto coincide con el de la transacción (cambio en T039: requiere aprobación) | Antes de G7b |
| R4 | `SET search_path` / sombra con objetos temporales | Código raw; `kuota_app_login` hereda `TEMPORARY` de PUBLIC | Bajo: Prisma califica con esquema; `pg_catalog` primero | Prueba "LÍMITE conocido" | Sin `CREATE` en esquemas; consultas calificadas | Bajo | Añadir `search_path` al lint; evaluar `REVOKE TEMPORARY ON DATABASE … FROM PUBLIC` (cambio de privilegios: requiere aprobación) | G12 / revisión de privilegios |
| R5 | Inyección SQL desde HTTP | Una entrada que llegue al texto SQL | Lectura cruzada | Inventario §3: ninguna ruta hoy | Solo plantillas etiquetadas; validación de entradas | Bajo | Mantener la prohibición de SQL dinámico; pruebas de inyección por endpoint en G7b (T034/T037) | Continuo |
| R6 | Credencial de runtime en manos de un atacante / RCE | Compromiso del servicio | Todos los tenants | Prueba "LÍMITE DE CONFIANZA" | Red privada, secretos rotables, sin DDL/BYPASSRLS/TRUNCATE | Alto, **fuera del alcance de RLS** | Ver §6 (alternativas arquitectónicas) | Decisión de arquitectura (sin fecha) |
| R7 | Tenant elegido por el cliente | Mecanismo técnico activo fuera de local/testing | Suplantación de tenant | Arranque aborta; guard 401; módulos no registrados | Configuración + guard | Bajo en 001; **la identidad real no existe aún** | Identidad y membresía (002) | 002 |

**Severidad global del riesgo residual P2: MEDIA** (impacto alto, probabilidad baja: requiere código defectuoso o
malicioso dentro del servicio; ninguna ruta externa). P2 se mantiene **PARCIAL**.

## 6. Alternativas si el modelo exigiera resistir SQL arbitrario con la credencial de runtime (no implementadas)

| Alternativa | Qué aporta | Costo |
|---|---|---|
| Rol de PostgreSQL por tenant (`SET ROLE` + políticas por `current_user`) | El contexto ya no es un GUC libre | Miles de roles; `SET ROLE` también es SQL del runtime salvo con roles sin membresía cruzada; operación compleja |
| Contexto firmado (HMAC del tenant verificado en una función `SECURITY DEFINER` con secreto inaccesible al runtime) | Una inyección no puede fabricar un contexto válido | Costo por fila en las políticas; quien controle la aplicación sigue teniendo el secreto |
| Base o esquema por tenant | Aislamiento fuerte | Migraciones, pooling y operación mucho más caros; contradice ADR-0004 |
| Prohibir SQL raw fuera de `tenant-context` (lista blanca revisada) | Elimina R1/R2 salvo en archivos revisados | Bajo; requiere aprobación como regla de arquitectura |

Ninguna se implementa sin aprobación humana.

## 7. Seguimiento

- P2 permanece **PARCIAL** en ADR-0004. Pendientes: gate de CI de los controles estáticos (G12), fuente de identidad
  confiable (002), decisión sobre R3 antes de G7b y sobre la lista blanca de SQL raw.
