# Registro de aprobaciones — 001-platform-foundation

Evidencia de aprobación humana exigida por la Constitución §I ("aprobación humana explícita registrada: comentario de
aprobación en el PR de especificación o mensaje explícito del responsable"). No existe repositorio remoto ni PR; la
evidencia es el mensaje explícito del responsable del proyecto en la sesión de trabajo con Claude Code. Este registro
no es una firma: identifica el contenido aprobado mediante los identificadores de blob de Git.

## Aprobación 1 — 2026-11-22

- **Quién:** responsable del proyecto (mantenedor único; Constitución v1.2.0, excepción de mantenedor único).
- **Medio:** mensaje explícito en la sesión de trabajo: "APRUEBO explícitamente los siguientes artefactos de
  `001-platform-foundation`, en su versión validada: `spec.md`, `plan.md`, `tasks.md`".
- **Versión aprobada:** commit `b2becb4`, analizada por `/speckit-analyze` con 0 CRITICAL, 0 HIGH, 0 MEDIUM y 1 LOW
  histórico (P1), cobertura 49/49 y 32/32 campos restringidos.

| Artefacto | Blob Git aprobado |
|---|---|
| `spec.md` | `14c9f2a755e4c0abc43bca317d37c016ce8bc50c` |
| `plan.md` | `94036aad43d70626d2b9039fb4884d0c14d1fd94` |
| `tasks.md` | `e2b12a421ff754158b425a0a2453951468c25017` |

- **Condición:** la aprobación vale mientras los artefactos correspondan a esta versión sin cambios sustanciales.
  Marcar casillas de progreso en `tasks.md` (`- [ ]` → `- [x]`) no es un cambio sustancial. Cualquier otro cambio en
  requisitos, plan o tareas requiere una nueva aprobación registrada aquí. Comprobación:
  `git diff b2becb4 -- specs/001-platform-foundation/{spec,plan,tasks}.md`.
- **Alcance de implementación autorizado:** **solo el Grupo G1 (T001–T011)**. G2 (T012–T013), G3 (spike T014/T015)
  y las tareas posteriores requieren una autorización expresa nueva. La elección Prisma/Kysely no está aprobada
  (ADR-0004, D-ARC-01).

## Enmienda 1 — 2026-11-22: alcance de T012, T014 y T015

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo: "Autorizo corregir el alcance
  documental de T012 y T014".
- **Motivo:** la migración SQL de G2 se implementó neutral respecto al ORM por instrucción del responsable; crear
  `schema.prisma` en T012 habría adelantado la elección Prisma/Kysely (D-ARC-01), que depende del spike.
- **Cambio (IDs conservados; requisitos funcionales sin cambios):**
  - T012: crear y verificar la migración SQL inicial, neutral al ORM y **referencia canónica** del esquema inicial
    hasta que una decisión formal determine otra estrategia.
  - T014: crear `schema.prisma`, `prisma.config.ts`, `migration_lock.toml` y el cliente Prisma del spike, y ejecutar el
    spike S1–S8.
  - T015: evaluar los resultados y obtener la aprobación humana de Prisma o Kysely.
- **Versión vigente de `tasks.md`:** blob `176eb1bd7f5bb5dd746ad1064b2cd733b38f614b` (incluye la casilla de T012 marcada tras verificar la
  migración: 24 pruebas de G2 + 5 de soporte en verde; `migration.sql` idéntica a la del commit `054c24e`).
- **Alcance de implementación autorizado:** G1 (T001–T011), G2 (T012–T013) y **T014**. T015 queda como punto de
  aprobación humana; G4 y posteriores no están autorizados.

## Aprobación 2 — 2026-11-22: D-ARC-01 (ORM), cierre de T015

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo: "APRUEBO PRISMA 7 COMO ORM
  PRINCIPAL DE KUOTA, CON CONDICIONES".
- **Evidencia revisada:** spike T014 (`specs/001-platform-foundation/spike-t014-report.md`), con S1–S6 en PASS en tres
  ejecuciones; la evidencia del repositorio coincide con el informe.
- **Decisión:** Prisma 7.10.1 con `@prisma/adapter-pg`. Kysely queda documentado como alternativa ante una limitación
  obligatoria futura. Registro: ADR-0004 (*Aceptado con condiciones*), D-ARC-01 en `docs/business/decisions-register.md`
  y research R-04.
- **Condiciones P1–P8:** su estado, severidad, prueba e hito están en ADR-0004 §Condiciones de la aceptación. La
  aprobación **no** las da por mitigadas. Autorizaciones concretas incluidas:
  - P1: modificar `0001_foundation` para añadir `BEGIN`/`COMMIT`, verificado antes que no estaba desplegada en ningún
    entorno persistente (sin remoto; bases `kuota` y `kuota_test` del Compose sin esquema `kuota` ni historial).
  - P3: conservar `_prisma_migrations` en `public` tras verificar propietario y privilegios.
  - P5: solo documentar el procedimiento; **no** se autoriza una política de mantenimiento ni BYPASSRLS.
  - P6 y P7: dirección aprobada o fuera de alcance; nada implementado.
- **Alcance de implementación autorizado tras esta aprobación:** hasta T015 inclusive. **G4 y posteriores no están
  autorizados**; requieren una autorización expresa nueva tras revisar P1–P4.

## Aprobación 3 — 2026-11-23: cierre de US6 (DELETE auditado y mantenimiento de idempotencia)

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Cierre de US6:
  DELETE auditado y purga segura de idempotencia").
- **Autorizado:**
  - **(A)** añadir 400 `validation-error` al contrato de `deleteDevProbeItem`, solo para la política de actor
    obligatorio;
  - **(B)** diseñar e implementar el rol de mantenimiento y la migración aditiva 0002 para purgar claves vencidas. No
    incluye aplicarla a bases persistentes, credenciales reales, workers ni purgas sobre datos reales;
  - **(C)** analizar `ip-hash` y proponer HMAC, **sin** cambiar el algoritmo.
- **No autorizado:** US5, G12, US7 y 002.

### Propuesta de enmienda de T072 (APROBADA el 2026-11-23: ver Aprobación 4)

- **Texto vigente:** "Expiración: una fila con `idempotency_keys.expires_at` en el pasado (fijada con `kuota_migrator`)
  no bloquea…".
- **Problema:** con FORCE RLS y la política `TO kuota_app` (decisión de implementación de 0001, data-model.md),
  `kuota_migrator` no ve ni modifica filas. El criterio literal no se puede cumplir sin desactivar FORCE RLS, que está
  prohibido.
- **Texto propuesto:** "…(fijada en la preparación de la prueba por `kuota_app_login` dentro del contexto del propio
  tenant, sin credenciales elevadas; la identidad de mantenimiento de 0002 la ve como vencida)…". El resto de T072 no
  cambia.
- **Estado:** T072 queda **sin marcar** hasta que se apruebe la enmienda. Las pruebas ya usan el texto propuesto
  (`idempotency.spec.ts`, `idempotency-maintenance.spec.ts`).

## Aprobación 4 — 2026-11-23: enmienda de T072, alineación de ADR-0004, preflight de 0002 y US5a (T066, T067, T095)

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — T072, ADR-0004,
  protección de migraciones y US5a").
- **Enmienda de T072 aprobada.** Texto aplicado en `tasks.md`, sustituyendo "(fijada con `kuota_migrator`)":
  "La preparación de claves de idempotencia vencidas para pruebas se realiza mediante la identidad runtime
  `kuota_app_login` dentro del contexto de un tenant y respetando `withTenant` y RLS. La comprobación y purga de las
  claves vencidas se efectúa con la identidad de mantenimiento autorizada. No se emplea `kuota_migrator` como
  identidad de acceso a los datos de negocio ni se desactiva FORCE RLS."
- **Comparación con la propuesta de la Aprobación 3:**
  - El texto aprobado coincide en la identidad (`kuota_app_login` en el contexto del tenant) y en el papel del
    mantenimiento.
  - Exige además dos cosas que la propuesta no decía: hacer el fixture **a través de `withTenant`** (antes SQL directo
    con `set_config`) y **purgar** con la identidad de mantenimiento (antes solo se comprobaba que la veía vencida).
  - No amplía el alcance de T072, así que se aplicó y se adaptó la prueba: `idempotency.spec.ts` usa `withTenant` para
    el fixture, comprueba la visibilidad con `kuota_maintenance_login` y añade la purga.
  - Los demás criterios de T072 no cambian.
- **ADR-0004:** registrar `kuota_maintenance` y `kuota_maintenance_login` (enmienda documental), sin modificar la
  decisión de Prisma, sus condiciones ni los roles existentes.
- **Preflight de 0002:** añadido a `make up`. Es de solo lectura y no aprovisiona nada.
- **US5a autorizada:** T066 y T067, y T095 tras verificar sus dependencias. No incluye T068–T071, US7, G12 ni 002.

## Aprobación 5 — 2026-11-23: minimización de `audit_events.origin` (sin IP ni hash de IP)

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Minimización de
  datos de auditoría: eliminar IP e ip-hash de origin").
- **Decisión:** dejar de generar y almacenar direcciones IP y hashes de IP en `origin`, y conservar solo el origen
  lógico necesario para FR-025. Resuelve la decisión 1 de `docs/security/audit-origin-privacy-assessment.md` §5 a favor
  de minimizar.
- **Enmienda documental autorizada de data-model.md:** solo `audit_events.origin`, en el diagrama y en la sección de la
  entidad. Cubre propósito, valores admitidos, datos prohibidos, diferencias con `actor_id` y `correlation_id`,
  tratamiento de HTTP y de vías futuras, justificación y compatibilidad. No toca ningún otro campo.
- **Código:**
  - `AuditActorGuard` fija `origin = "http"` y ya no lee la solicitud;
  - `AuditService` solo admite valores de la lista cerrada `AUDIT_ORIGINS`.
- **Sin cambios en:**
  - el esquema, migraciones nuevas, RLS, roles, `withTenant`, transaction-guard y el contrato OpenAPI;
  - la identidad del actor y `correlation_id`;
  - la retención.
- **Explícitamente no autorizado:**
  - HMAC o cualquier sustituto de SHA-256(IP);
  - un mecanismo nuevo de identificación;
  - reescribir o borrar eventos históricos;
  - correcciones retroactivas de datos;
  - 002, US7, T068 y otras historias.
- **Tareas:** no cambia ninguna tarea. T077 cita `audit_events.origin` sin fijar su formato.

## Aprobación 6 — 2026-11-23: hotfix de privacidad de logs HTTP (pino-http)

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Hotfix de
  privacidad: minimización de logs HTTP con pino-http").
- **Decisión:** minimizar los datos personales y sensibles de los logs HTTP de la aplicación mediante una lista
  explícita de campos permitidos. Se prefiere la serialización mínima sobre una denylist.
- **No autorizado:**
  - eliminar el logging;
  - modificar la auditoría transaccional u `origin`;
  - tocar contratos, migraciones, roles, RLS, dependencias de Prisma o la retención;
  - US4, US7 y 002.
- **Sin cambios en `spec.md`, `plan.md` ni `tasks.md`:** el cambio refuerza FR-009 y FR-010 sin modificar su texto.
- **Detalle:** `docs/security/http-log-minimization.md`.

### Propuesta de enmienda de T080 (sustituida por la Aprobación 7, 2026-11-23)

- **Texto vigente:** "`flutter/pubspec.yaml` raíz del workspace (`workspace:` con 3 apps y 4 paquetes, …)".
- **Problema:** las 3 apps se crean en T085 y `api_client` en T069/T070, ambas fuera del alcance de US7a. Pub rechaza
  un `workspace:` con miembros que no existen, así que el criterio no se puede cumplir antes que esas tareas, aunque la
  nota de orden de tasks.md permite adelantar T080.
- **Texto propuesto:** "…`flutter/pubspec.yaml` raíz del workspace (`workspace:` con los miembros existentes; T085 añade
  las 3 apps y T069/T070 `api_client` al crearlos, de modo que al cerrar US7 contenga 3 apps y 4 paquetes, …)". El
  resto de T080 no cambia.
- **Estado:** T080 queda **sin marcar** hasta que se apruebe la enmienda. Lo demás de T080 está implementado:
  `.fvmrc`, `sdk`, la sección `melos:` y `analysis_options.yaml`.

## Aprobación 7 — 2026-11-23: enmienda de T080 (dos etapas) y T068–T070

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Desbloquear T080 e
  implementar T068–T070: cliente API Dart").
- **Causa del bloqueo (ciclo de planificación):**
  - T070 dependía de T080;
  - T080 exigía `workspace:` con `api_client` (que crea T070) y las 3 apps (que crea T085, que a su vez depende de T070);
  - pub rechaza miembros inexistentes.
- **Enmienda aplicada en tasks.md** (sustituye a la propuesta anterior, que debilitaba el criterio final):
  - **T080 en dos etapas, ambas obligatorias para marcarla:**
    - **(A) inicialización:** SDK, Melos, análisis y `workspace:` con los miembros existentes;
    - **(B) composición final:** `workspace:` con 3 apps y 4 paquetes, verificada con `pub get` y `check_deps`.
  - **Dependencias:** T059, T063 y T070 dependen solo de la etapa A. T070 añade `api_client` a `workspace:`. T085
    añade las apps y cierra la etapa B.
  - Nota de orden, dependencias de US4/US5 y grafo actualizados.
- **Criterio que NO se debilita:** T080 sigue sin marcar hasta que existan las 3 apps y los 4 paquetes.
- **Autorizado:** T068, T069 y T070 según su texto literal.
- **No autorizado:**
  - T085, T071 y T050;
  - cambiar el contrato OpenAPI;
  - cambios en Money TS, logs o auditoría;
  - la Constitución.

## Aprobación 8 — 2026-11-23: CORS para Kuota Admin, runtime iOS, Testcontainers y T086

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Cierre de
  conectividad Web, validación iOS y estabilidad de pruebas").
- **Autorizado:**
  1. una política CORS segura, limitada a orígenes autorizados explícitamente por entorno (hueco de especificación:
     ni spec, ni plan, ni tasks la cubrían). Se registra como **T097** en tasks.md;
  2. instalar el runtime de simulador iOS compatible con el Xcode existente, **después de verificar versión,
     disponibilidad y espacio**;
  3. investigar y corregir de forma aislada la intermitencia del desmontaje de Testcontainers;
  4. las validaciones locales correspondientes;
  5. los criterios de T086 cubiertos por esta autorización.
- **No autorizado:**
  - push, merge, rebase y despliegues;
  - cambios arbitrarios de dependencias o de identificadores de aplicación;
  - login, préstamos, ahorros, cobros y sincronización offline;
  - cambiar contratos públicos, autenticación, RLS o auditoría;
  - actualizar Xcode o Flutter sin un bloqueo demostrado y una nueva aprobación.
- **Criterios que NO se debilitan:** T049 y T052 siguen abiertas; el checkpoint de US7 exige SC-008 con iOS verificado
  localmente.

## Aprobación 9 — 2026-11-23: validación local de iOS diferida (desviación temporal controlada) y cierre de US4 Dart

- **Quién:** responsable del proyecto (Product Owner / Arquitectura), mediante mensaje explícito en la sesión de
  trabajo ("KUOTA — Continuidad del desarrollo sin validación iOS").
- **Decisión:** se **posponen temporalmente todas las validaciones locales de iOS** (build, runtime, simulador y
  pruebas) en la fase actual y en las siguientes funcionalidades, hasta que se revoque expresamente. iOS **sigue dentro
  del alcance del producto**; solo se aplazan sus compilaciones, simulaciones y pruebas.
  - **Motivo:** espacio insuficiente. Runtime iOS 26.2 (arm64) de unos 7,81 GiB con 10,30 GiB libres (disco al 98 %);
    instalarlo comprometería el espacio de Docker, Flutter, PostgreSQL y los builds de Android.
  - **Alcance:** validación local de iOS (`flutter build ios`, `flutter run` en simuladores iOS, pruebas instrumentadas
    de iOS, descarga o instalación de runtimes y simuladores). Prohibido además: `xcodebuild -downloadPlatform`,
    eliminar runtimes antiguos, actualizar Xcode y limpiar cachés del sistema sin autorización. Se pueden mantener los
    archivos de configuración iOS sin ejecutar herramientas que necesiten el runtime.
  - **Plataformas alternativas verificadas:** Android, Flutter Web y Dart VM. **No sustituyen** a iOS en los informes:
    reducen riesgos compartidos, pero no demuestran compatibilidad nativa con iOS.
  - **Riesgo aceptado:** defectos específicos de iOS no detectados temporalmente (configuración nativa, ATS, red local,
    compilación con el SDK 26.2).
  - **Responsable de reactivarla:** Product Owner / Arquitectura.
  - **Condición de reactivación:** autorización expresa y espacio suficiente.
- **Criterios que NO se debilitan:**
  - La Constitución no exige iOS y no se modifica.
  - **SC-008 y el checkpoint de US7 siguen PENDIENTES DE VALIDACIÓN iOS.** No se declaran cumplidos.
  - Las tareas individuales que cumplan literalmente sus criterios pueden cerrarse según las reglas del proyecto.
- **Matriz de validación vigente:** backend NestJS, Dart VM, Flutter Web y Android OBLIGATORIAS; iOS DIFERIDA.
- **Autorizado:** T059, T063 y T065 (US4 Dart) según su texto literal, sin inventar reglas de redondeo de negocio
  (D-FIN-02 sigue pendiente).
- **No autorizado:**
  - push, merge, rebase, nuevas ramas y despliegues;
  - cambios no autorizados en contratos, Constitución o migraciones;
  - borrar cachés o runtimes;
  - limpieza destructiva de Docker;
  - iniciar el siguiente bloque sin aprobación.

## Registro de autorizaciones verificadas (H1 de T092; registrado el 2026-11-23)

Las autorizaciones siguientes se dieron por mensaje explícito del responsable del proyecto en la sesión de trabajo de
Claude Code, pero no tenían entrada en este archivo. **Evidencia verificable:** la transcripción local de la sesión
`19dc21f1-ee7c-4649-92ac-d01c7b5afc2f` (`~/.claude/projects/-Users-ricardogallardo-Documents-Ricardo-Projects-kuota-repo-kuota-platform/19dc21f1-ee7c-4649-92ac-d01c7b5afc2f.jsonl`,
no versionada), con la hora UTC de cada mensaje. Las citas son literales; no se añade ninguna decisión que no figure en
ellas. Las que ya tenían entrada se indican en la última columna.

| Fecha (UTC) | Mensaje | Autorización (cita literal) | Exclusiones (cita literal, extracto) | Entrada previa |
|---|---|---|---|---|
| 2026-11-22 22:45 | "Inicio controlado de G4 tras aprobar Prisma 7" | "Autorizo ejecutar exclusivamente las tareas que pertenezcan a G4" (T016–T021) | "No autorizo G5, G6, G7 ni tareas posteriores." | — |
| 2026-11-22 22:56 | "Implementación controlada de G5: OpenAPI, contratos y bootstrap NestJS" | "Autorizo implementar exclusivamente G5, correspondiente al grupo incremental T022–T025." "Apruebo implementar en T025 el mecanismo de registro condicional del módulo `dev-probe`." | "No autorizo implementar anticipadamente T040–T042 ni crear el módulo funcional dev-probe." | — |
| 2026-11-23 00:55 | "Implementación controlada de G6 (T026–T033)" | "Autorizo implementar exclusivamente G6, correspondiente al grupo incremental T026–T033 de US1." | "No autorizo G7 ni ninguna tarea posterior a T033." | — |
| 2026-11-23 01:21 | "G7a: TenantContext, withTenant y aislamiento PostgreSQL" | "Autorizo ejecutar exclusivamente G7a: T035, T036, T038, T039 y T043." | "No autorizo G7b, T040–T042, T044, T096 ni otras tareas posteriores" | — |
| 2026-11-23 01:45 | "Revisión de seguridad P2 y ejecución limitada del backend de US4" | "Autorizo implementar exclusivamente: T056, T057, T061, T062 y T064" (subconjunto backend de US4); "Autorizo resolver la discrepancia documental de la API pública de módulos." | "No autorizo ejecutar G7b ni implementar anticipadamente dev-probe." | Enmienda 1 de ADR-0002 |
| 2026-11-23 05:00 | "Hardening de T039: riesgo R3 y seguridad del cliente transaccional" | "APRUEBO LA OPCIÓN (a): reforzar T039 para verificar el contexto autorizado en cada ejecución del cliente transaccional." | "No autorizo G7b todavía." "No autorizo cambiar el mecanismo de aislamiento RLS ni las políticas de PostgreSQL." | — |
| 2026-11-23 05:27 | "G7b: dev-probe, aislamiento HTTP y cierre controlado de US2" | "Autorizo ejecutar G7b exclusivamente: T034, T037, T040, T041, T042, T044 y T096, además de completar la parte pendiente de T062"; "Apruebo aclarar la condición C2-1 de ADR-0002" | "No autorizo otras tareas de US4, US6 ni G8." | Enmienda 2 de ADR-0002 |
| 2026-11-23 05:54 | "Implementación controlada de US6 (T072–T079): auditoría multi-tenant" | "Autorizo implementar exclusivamente US6, tareas T072–T079" | "No autorizo avanzar a US5, US7, G12, 002 ni tareas posteriores." | Aprobaciones 3 y 4 (cierre) |
| 2026-11-23 08:09 | "G12 / US3: CI/CD, contratos y seguridad como gates obligatorios" | "Autorizo ejecutar G12 / US3, tareas T045–T055, exclusivamente conforme a sus descripciones y dependencias reales." | "No implementes tareas fuera del alcance autorizado." | — |
| 2026-11-23 13:12 | "Security Hotfix G12: remediar GHSA-7589-6fvf-x4pw sin degradar Prisma" | "APRUEBO la remediación de la vulnerabilidad." (opciones A, actualización de Prisma, y B, override de pnpm) | "NO AUTORIZO la aceptación temporal…", "…reducir la severidad del gate", "…allowlist", "…desactivar osv-scanner" | — |
| 2026-11-23 13:38 | "Minimización de datos de auditoría" | — | — | Aprobación 5 |
| 2026-11-23 14:17 | "Hotfix de privacidad: minimización de logs HTTP con pino-http" | — | — | Aprobación 6 |
| 2026-11-23 14:50 | "US4 TypeScript: exactitud monetaria, pruebas de propiedades y gates financieros" | "APRUEBO desarrollar T058, T060 y T065, siempre que sus dependencias reales estén satisfechas." | "NO AUTORIZO implementar T059 ni T063." | — |
| 2026-11-23 15:25 | "US7a: comenzar la fundación Flutter y desbloquear Money Dart" | "Implementar exclusivamente el alcance de US7a correspondiente a T080–T084" (y, antes, la corrección del arnés de auditoría) | "No cierres T068–T071 salvo autorización independiente." | — |
| 2026-11-23 16:38 | "Desbloquear T080 e implementar T068–T070" | — | — | Aprobación 7 |
| 2026-11-23 17:01 | "CI Flutter y creación de las tres aplicaciones" | "1. Implementar T071, conforme a tasks.md. 2. Implementar T050, conforme a tasks.md." y "Implementa exactamente los criterios de T085" | (no T086, Money Dart ni autenticación) | — (posterior a la Aprobación 7, que no los autorizaba todavía) |
| 2026-11-23 19:17 | "Cierre de conectividad Web, validación iOS y estabilidad de pruebas" | — | — | Aprobación 8 |
| 2026-11-23 20:08 | "Continuidad del desarrollo sin validación iOS" | — | — | Aprobación 9 |
| 2026-11-23 20:43 | "Cierre técnico de 001: métricas, quality gates y revisión final" | "Autorizar exclusivamente: 1. T093 y T094. 2. T087–T092, solo después de revisar sus criterios reales y satisfacer sus dependencias." | "No autorizar todavía push, PR, merge ni despliegue." | — |

**Pendiente de confirmación:** el desglose exacto de tareas de "G4" (T016–T021) se deduce del mensaje de G5 ("T001–T021
completadas"), no de una enumeración en el propio mensaje de G4.

## Aprobación 10 — 2026-11-23 (21:43 UTC): desarrollo solo local, corrección de T092 y ratificación de T094

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Continuidad de
  desarrollo 100% local, sin PR ni GitHub remoto").
- **Política:** el desarrollo continúa **solo en local**. Prohibidos: crear o abrir PR; `git push`, `pull`, `fetch`,
  `merge` y `rebase`; nuevas ramas sin autorización; ejecutar workflows de GitHub Actions; cambiar configuración remota;
  publicar imágenes; desplegar; crear releases. T049 y T052 siguen **PENDIENTES** (sin baseline ficticio de `main`). La
  Aprobación 9 sigue vigente (iOS diferido).
- **Autorizado:** C1 (cobertura de código Dart), C2 (eliminar la duplicidad entre apps), H1 (trazabilidad documental
  comprobable), T094 (ratificación documental del middleware) y H3 (normalización segura de las respuestas 404 según los
  contratos existentes).
- **Ratificación de T094 (condicional, cita):** "Si el middleware actual cumple correctamente y no introduce riesgos,
  ratifico su utilización como solución arquitectónica para T094, siempre que se documente la desviación mediante el
  proceso de gobernanza y se conserven todos los criterios funcionales."
  - **Verificación de la condición (2026-11-23):** el middleware HTTP mide solicitudes correctas, rechazos de guards
    (401), rutas inexistentes (`unmatched`), errores controlados (400/404/409/500) y el tiempo total desde antes del
    enrutado hasta `finish` (`backend/test/integration/metrics.spec.ts`). No expone métricas en el puerto público y no
    añade etiquetas con PII ni de cardinalidad no acotada. Límite conocido: una solicitud abortada por el cliente antes
    de `finish` no se mide.
  - **Desviación registrada:** T094 dice "interceptor HTTP que etiqueta por plantilla de ruta"; la implementación usa
    un middleware de nivel HTTP (`backend/src/common/metrics/http-metrics.ts`), porque un `NestInterceptor` no ve los
    404 del router ni los rechazos de guards que exige T093. El resto de criterios de T094 no cambia. **T094 se cierra.**
- **No autorizado:** cambiar la Constitución, inventar requisitos, modificar el contrato fuente, borrar datos,
  imágenes, cachés o runtimes, ejecutar iOS, y desarrollar 002 (solo evaluar y proponer).

## Aprobación 11 — 2026-11-23: quinto paquete `app_shell` (C2) y exclusión del código generado de la cobertura

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Resolver C2 con
  app_shell y preparar 002 en modo 100 % local").
- **Decisión (cita):** "Apruebo incorporar un quinto paquete llamado: `flutter/packages/app_shell`. Su propósito
  exclusivo es centralizar la composición Flutter compartida por Admin Web, Collector Mobile y Client Mobile." Se
  mantienen `shared_core`, `financial_domain`, `design_system` y `api_client` con su propósito.
  - `app_shell` puede depender de Flutter, Riverpod, `shared_core`, `api_client` y `design_system`. No contiene lógica
    financiera ni de un negocio concreto, no duplica clientes HTTP y no cambia las fronteras de los otros paquetes.
  - Las apps conservan su `main.dart`, identidad, configuración, punto de entrada y plataforma.
- **Cobertura (cita):** "Apruebo asimismo documentar la exclusión del código OpenAPI generado de los umbrales de
  cobertura, siempre que su cobertura se informe por separado y continúen los controles de generación, compilación y
  pruebas de integración." Ratifica la regla aplicada en C1 (`lib/src/generated/**`).
- **Impacto documentado en criterios ya cumplidos (sin alterarlos):**
  - T080 (etapa B) se cumplió con "3 apps y 4 paquetes" el 2026-11-23 y sigue cumplida. El workspace pasa a 3 apps y
    5 paquetes por esta aprobación; la tarea nueva T098 cubre el quinto paquete.
  - `plan.md` (estructura) y `flutter-architecture.md` §3 se actualizan para registrar `app_shell`.
- **No autorizado:** debilitar la Constitución, reducir pruebas, alterar el dominio financiero, operaciones remotas,
  iOS, ni implementar 002 (solo análisis y borradores locales).

