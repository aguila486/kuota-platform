# Evaluación de riesgo residual P2 — contexto de tenant en PostgreSQL

- **Fecha:** 2026-11-22 (tras G7a de 001: T038, T039, T043). **Actualización 2026-11-22:** hardening de T039 contra
  R3, aprobado por el responsable del proyecto (opción a), §8.
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
- **Capacidad del cliente transaccional que no estaba restringida (hallazgo R3, mitigado en §8):** el cliente no
  comprobaba el contexto en cada llamada. Si código defectuoso **compartía la referencia `tx`** con otra operación
  mientras la transacción seguía abierta (p. ej. guardándola en un singleton), esa operación leía como el tenant de la
  transacción. Evidencia original: `tenant-prisma.spec.ts` en `2b3e9d9`; reproducción ampliada en `1f6057e`.

**Actualización de inventario (US6, 2026-11-22):** `common/idempotency/idempotency.repository.ts` añade 3 sentencias raw,
todas con plantilla parametrizada y sin `app.*`:
- `SELECT pg_try_advisory_xact_lock(<int8>)`;
- `DELETE … WHERE key = <param> AND expires_at <= now()`;
- `INSERT … VALUES (<params>)`.

Las entradas HTTP (clave, hash, método, ruta) llegan solo como parámetros enlazados. dev-probe y `common/audit` no
usan SQL raw. No cambia la conclusión.

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
| Preventivo (runtime, R3) | Cliente transaccional protegido: lista blanca de capacidades y comprobación de propiedad (transacción abierta, operación propietaria, tenant y actor) antes de cada ejecución; violación → rollback | `tenant-transaction-ownership.spec.ts`, `transaction-guard.spec.ts` |
| Preventivo (estático, R3) | Lint: prohibido anotar como `TenantTransaction` campos de clase, propiedades de parámetro y variables de módulo fuera de `tenant-context` | `tenant-context-guard.spec.ts` (incluye límites conocidos) |
| Detectivo (runtime) | `app.tenant_id` verificado antes del COMMIT → rollback | `tenant-prisma.spec.ts` (deshace escrituras, **no lecturas**) |
| Detectivo (catálogo) | `db:check-rls` | `check-rls.spec.ts` |
| Revisión | Todo SQL raw nuevo se revisa en PR (CODEOWNERS, G12/US3) | Pendiente de G12 |

## 5. Matriz de riesgo residual

| # | Amenaza | Prerrequisitos | Impacto | Evidencia | Controles existentes | Riesgo residual | Mitigación propuesta | Hito |
|---|---|---|---|---|---|---|---|---|
| R1 | Plantilla raw con `set_config`/`SET app.*` | Código que pase la revisión y el lint (texto estático) | Lectura cruzada; escrituras revertidas | S5; prueba de manipulación | Lint P2, verificación antes del COMMIT | Bajo | Gate de CI del lint (G12); revisión obligatoria de SQL raw | G12 |
| R2 | SQL por concatenación en plantilla fabricada | Código deliberadamente ofuscado | Lectura cruzada | Prueba "LÍMITE conocido" | Revisión; verificación antes del COMMIT (solo escrituras) | Bajo–medio | Prohibir `$queryRaw`/`$executeRaw` fuera de una lista de archivos revisados (lint) | Antes del primer módulo de negocio con SQL raw |
| R3 | Referencia `tx` compartida entre operaciones | Código defectuoso (singleton, caché, cierre capturado) | Antes: lectura y escritura cruzadas durante la transacción | Reproducción `1f6057e`; mitigación `tenant-transaction-ownership.spec.ts` (27 casos) | **Mitigado en tiempo de ejecución** (§8): vínculo de propiedad por operación, comprobado antes de cada ejecución; lint para retenciones anotadas | **Bajo** (residuales en §8.6) | Cubrir la API fluida de relaciones si un módulo la necesita | Hecho (2026-11-22) |
| R4 | `SET search_path` / sombra con objetos temporales | Código raw; `kuota_app_login` hereda `TEMPORARY` de PUBLIC | Bajo: Prisma califica con esquema; `pg_catalog` primero | Prueba "LÍMITE conocido" | Sin `CREATE` en esquemas; consultas calificadas | Bajo | Añadir `search_path` al lint; evaluar `REVOKE TEMPORARY ON DATABASE … FROM PUBLIC` (cambio de privilegios: requiere aprobación) | G12 / revisión de privilegios |
| R5 | Inyección SQL desde HTTP | Una entrada que llegue al texto SQL | Lectura cruzada | Inventario §3: ninguna ruta hoy | Solo plantillas etiquetadas; validación de entradas | Bajo | Mantener la prohibición de SQL dinámico; pruebas de inyección por endpoint en G7b (T034/T037) | Continuo |
| R6 | Credencial de runtime en manos de un atacante / RCE | Compromiso del servicio | Todos los tenants | Prueba "LÍMITE DE CONFIANZA" | Red privada, secretos rotables, sin DDL/BYPASSRLS/TRUNCATE | Alto, **fuera del alcance de RLS** | Ver §6 (alternativas arquitectónicas) | Decisión de arquitectura (sin fecha) |
| R7 | Tenant elegido por el cliente | Mecanismo técnico activo fuera de local/testing | Suplantación de tenant | Arranque aborta; guard 401; módulos no registrados | Configuración + guard | Bajo en 001; **la identidad real no existe aún** | Identidad y membresía (002) | 002 |

**Severidad global del riesgo residual P2: MEDIA** (impacto alto, probabilidad baja: requiere código defectuoso o
malicioso dentro del servicio; ninguna ruta externa). La mitigación de R3 reduce la exposición a código defectuoso, pero
no cambia la severidad global: R1/R2 (SQL que cambia `app.tenant_id`, con lectura cruzada antes del COMMIT), R6 y R7
siguen igual. P2 se mantiene **PARCIAL**.

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
  confiable (002) y decisión sobre la lista blanca de SQL raw. R3: mitigado (§8).

## 8. Hardening de T039 frente a R3 (2026-11-22)

Autorización: opción (a) aprobada por el responsable del proyecto, limitada a R3 y a T039, sus tipos, reglas
arquitectónicas y pruebas. Sin cambios en migraciones, RLS, FORCE RLS, roles, contratos ni Money.

### 8.1 Defecto

El cliente transaccional de Prisma 7.10.1 (el `tx` de `$transaction`) está ligado a una conexión y a una transacción,
no a la operación que la abrió, y no consulta ningún contexto al ejecutar. Además, las operaciones de Prisma son
**diferidas**: se ejecutan en el primer `then`/`await`, no al invocar el método. Por eso una comprobación hecha solo al
invocar el método sería insuficiente.

### 8.2 Reproducción antes de la corrección (commit `1f6057e`, PostgreSQL 18, dos tenants)

| Situación | Resultado antes |
|---|---|
| Cliente de A usado desde una solicitud de B | B leía filas de A |
| Cliente de A usado desde otra solicitud de A | La segunda solicitud escribía dentro de la transacción de la primera |
| Cliente de A usado desde B dentro de la transacción de B | B leía filas de A |
| Consulta construida en A y esperada desde B | Devolvía filas de A |
| Cliente retenido tras COMMIT/ROLLBACK | Lo rechazaba Prisma, no el servicio |
| `PrismaClient` base | Accesible leyendo la propiedad privada de TypeScript `prisma` |

La caracterización del cliente crudo (diferido, sin control de contexto, con `$transaction` y SQL dinámico) se conserva
como prueba permanente en `tenant-transaction-ownership.spec.ts`.

### 8.3 Implementación

- **Cliente protegido** (`transaction-guard.ts`): objeto construido explícitamente, sin `Proxy`, sin prototipo y
  congelado. Solo expone los delegados de los modelos (`Prisma.ModelName`) con 17 operaciones en lista blanca, y
  `$queryRaw`/`$executeRaw` con plantilla. No expone `$transaction`, SQL dinámico, `$queryRawTyped` ni internos de Prisma,
  y no contiene referencias al cliente original. Cada operación devuelve una consulta diferida que comprueba la
  propiedad al **iniciar la ejecución**, en el contexto asíncrono de quien la espera. Si la comprobación falla, Prisma no
  recibe la llamada. La ejecución ocurre una sola vez.
- **Vínculo de propiedad** (`TransactionBinding`, uno por transacción): owner (`tenantId`, `actorId`, `actorType`
  capturados al abrir), plazo (`timeout`), estado cerrado y violación. Se guarda en el cierre de `withTenant` y en un
  `AsyncLocalStorage` **privado de la instancia** del servicio. La aplicación no puede leerlo, fabricarlo ni sustituirlo.
  Con una clave en el CLS sí podría, porque `cls.get()` devuelve el almacén completo.
- **Comprobación antes de cada ejecución** (en memoria, sin consultas adicionales):
  1. transacción cerrada → `TenantTransactionClosedError`;
  2. violación previa → la misma violación;
  3. plazo vencido → `TenantTransactionClosedError`;
  4. la cadena asíncrona actual no es la de este `withTenant` → `TenantTransactionOwnershipError` (aunque el tenant
     sea el mismo);
  5. sin contexto → `TenantContextMissingError`;
  6. tenant, actor o tipo de actor distintos de los de apertura → `TenantContextMismatchError`.
- **Fallo cerrado:** de 4 a 6 registran la violación. El propietario ya no puede usar el cliente y su `withTenant`
  termina con ese error, así que la transacción entera se revierte, aunque el callback haya silenciado el error.
- **Ciclo de vida:** al terminar el callback, el vínculo se cierra en un `finally` antes del COMMIT o del ROLLBACK.
  Desde ese momento cualquier uso del cliente se rechaza: retenido, diferido o lanzado por un temporizador. El
  resultado del callback se espera **dentro** del ámbito de propiedad, porque `withTenant((tx) => tx.m.create(…))`
  devuelve una consulta diferida que Prisma ejecuta al resolverla.
- **Anidamiento (C2-1 sin cambios):** el mismo tenant reutiliza la transacción y el mismo cliente, sin BEGIN ni
  savepoint. El anidado aplica también las comprobaciones 1 a 6.
- **Encapsulación del servicio:** el `PrismaClient`, el pool y el contexto pasan a ser campos privados de ECMAScript
  (`#`). El servicio ya no recibe `ClsService`.
- **Control estático:** regla `no-restricted-syntax` (§4).

### 8.4 Pruebas posteriores

- `tenant-transaction-ownership.spec.ts`: 27 pruebas sobre PostgreSQL 18 que cubren los 15 casos obligatorios y las
  garantías 4.1–4.9.
  - Positivos: cada operación funciona dentro de su operación (modelo, raw, `then`/`catch`/`finally`, `Promise.all`,
    anidado).
  - Rechazos: tenant distinto; misma tenant desde otra solicitud; tras COMMIT; tras ROLLBACK; tras timeout; consulta
    diferida esperada en otro contexto; cambio de tenant o actor; contexto ausente o reemplazado.
  - Además: pool de una conexión reutilizada entre tenants, 60 solicitudes concurrentes y encapsulación.
- `transaction-guard.spec.ts`: 7 pruebas unitarias de la semántica diferida y de la lista blanca.
- `tenant-prisma.spec.ts`: sin cambios funcionales. La prueba de referencia filtrada ahora verifica el rechazo.
- `tenant-context-guard.spec.ts`: 6 retenciones detectadas, 1 caso permitido y 3 límites conocidos.
- Sin cambios: la prueba de G7a con `set_config` crudo sigue mostrando la lectura cruzada antes del COMMIT (R1/R2).

### 8.5 Rendimiento

Medido en una máquina local (macOS, Node 26.13.1) con PostgreSQL 18 de Testcontainers, pool de 4 y dos ejecuciones
alternadas de cada versión. Valores en ms (antes → después, dos rondas cada uno).

| Medida | Antes p50 / p95 / p99 | Después p50 / p95 / p99 |
|---|---|---|
| Transacción con 1 consulta (n=1500) | 1,06–1,09 / 1,35 / 2,64–3,00 | 1,08 / 1,36–1,86 / 2,88–3,39 |
| Consulta dentro de una transacción (n=4000) | 0,216 / 0,27–0,28 / 0,52–0,56 | 0,214–0,215 / 0,25–0,32 / 0,31–0,74 |
| Externa + 5 anidadas (n=500) | 1,96–1,99 / 2,37–2,89 / 3,3–5,6 | 2,00 / 2,47–3,36 / 4,2–5,9 |
| 2000 operaciones, 32 en vuelo | 1993–2096 op/s | 1891–2224 op/s |

- Las diferencias quedan dentro de la variación entre rondas de la misma versión.
- Sentencias por transacción: 5 antes y 5 después (BEGIN, `set_config`, consulta, verificación, COMMIT). La protección
  no añade ida y vuelta a PostgreSQL ni conexiones (pool total: 4 en ambos casos).
- Costo en memoria del envoltorio, medido en un microbenchmark sin base: unos 120 ns por consulta, frente a unos
  215 µs por consulta real.

### 8.6 Alcance y riesgos residuales

- **Cubre:** reutilización accidental del cliente o de una consulta diferida fuera de su operación, entre tenants o
  dentro del mismo tenant, y tras su fin o timeout.
- **No cubre:**
  - SQL que cambie `app.tenant_id`: R1/R2 siguen, con lectura posible antes del COMMIT;
  - la credencial de runtime (R6);
  - la identidad real (R7, 002).
- **El vínculo es la cadena asíncrona, no la autoría del código:** el código que se ejecuta dentro de la cadena de A
  actúa como A. Por ejemplo, un callback o listener que A invoca, o un `cls.run({ ifNested: 'inherit' })` dentro de A.
- **Datos ya obtenidos:** una consulta iniciada en A conserva su resultado. Si A entrega ese resultado (o la promesa
  ya iniciada) a otro, el dato viaja: es transferencia de datos, no una consulta nueva.
- **Código malicioso:** puede eludir el control parcheando módulos o el runtime. Queda fuera del modelo (R6).
- **API fluida de relaciones de Prisma:** no está disponible en el cliente protegido; en 001 no hay relaciones. Si un
  módulo la necesitara, falla cerrado (`TypeError`) hasta ampliar la lista blanca con revisión.
- **El lint solo detecta retenciones con anotación de tipo:** no detecta `this.x = tx` sin anotación, alias ni cierres.
  El control efectivo es el de tiempo de ejecución.
- **ADR-0002 (C2-1):** dice "el cliente transaccional se guarda en CLS (nestjs-cls)". La transacción activa vive ahora
  en un `AsyncLocalStorage` privado (el mismo mecanismo en que se basa nestjs-cls), mientras que el contexto de tenant
  sigue en CLS como única fuente. Encaja en "un equivalente propio en `common/tenant-context`" del mismo ADR. Una
  aclaración del texto queda pendiente de decisión humana.
