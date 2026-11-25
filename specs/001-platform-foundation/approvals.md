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


## Aprobación 12 — 2026-11-23: T104 por la opción C (regla anti-float con análisis de tipos) e interpretación de FR-021

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo ("KUOTA — Cierre de T104
  mediante análisis de tipos y preparación de 002").
- **Decisión (cita):** "AUTORIZO la opción C para resolver T104: Implementar una regla anti-float basada en AST y
  análisis de tipos que detecte operaciones monetarias inseguras, sin prohibir usos legítimos de number."
- **Interpretación de FR-021 (cita):** "prohibición de utilizar representación y aritmética de punto flotante para
  valores monetarios. No significa prohibir number en cualquier circunstancia."
  - **Permitido:** `number` para índices, contadores, versiones, escalas, y ratios o pesos que la API de Money ya admite,
    respetando su contrato exacto.
  - **Prohibido:** convertir montos a `number`; `Decimal.toNumber()` sobre importes; `parseFloat()` de cantidades
    monetarias; aritmética monetaria en punto flotante; conversiones inseguras de `number` a `BigInt`; parsing de montos
    JSON como números; `Math` para calcular importes cuando corresponde Money.
- **Límites:** no se modifican las firmas de Money ni las interpretaciones financieras pendientes. La opción literal de
  T104 ("toda anotación `number`") queda sustituida por esta interpretación; el texto de T104 no se reescribe.
- **No autorizado:** implementar 002, cambios en la auditoría de plataforma, operaciones remotas, iOS.

## Aprobación 13 — 2026-11-24: corrección E1 de `tasks.md` (citas de `platform_audit_events` en T099)

- **Quién:** responsable del proyecto, mediante mensaje explícito en la sesión de trabajo.
- **Decisión (cita):** "Apruebo aplicar exclusivamente `tasks-e1.diff`, SHA-256
  `945530ba9a6470f00c43b75ce42425b9815de0319478b4bfbd5ce4e915cb2e85`, sobre `specs/001-platform-foundation/tasks.md` en
  `feature/001-platform-foundation-baseline`. El SHA-256 esperado del documento resultante es
  `a0592bf2f448e28915a77e518418e3a7ad0b971d9a0b59e9a6579538fc8ec8b3`."
- **Origen:** hallazgo E1 (HIGH) del `/speckit-analyze` de 001 sobre el candidato de integración (0 CRITICAL): T099 no
  citaba como `Entity.field` los campos de data-model.md `platform_audit_events`.
- **Cambio:** solo la línea de T099. Se añaden las 14 citas, verificadas contra data-model.md, la migración
  `0003_platform_audit` y `backend/test/integration/platform-audit.spec.ts`: `id`, `run_id`, `operation`, `status`,
  `executed_by`, `occurred_at`, `correlation_id`, `dry_run`, `batch_size`, `max_batches`, `expired_before`,
  `affected_rows`, `batches`, `result_code`.
- **Hashes de `tasks.md`:** `247987ebf33bbeb3c33d430be5a44c02054e35f7d79bf25521ec0de970fca72e` →
  `a0592bf2f448e28915a77e518418e3a7ad0b971d9a0b59e9a6579538fc8ec8b3` (verificado tras aplicar).
- **Sin cambios:** spec.md, plan.md, data-model.md, el resto de tareas, el código y la Constitución.
- **Decisión asociada (sin ejecutar):** la futura integración de 002 usará la alternativa B por etapas. No se autoriza
  todavía construir ni publicar esa rama.
- **No autorizado:** operaciones remotas, modificaciones de `main`, cambios constitucionales.

## Registro 2026-11-25 — Gobernanza de mantenedor único, L3 detenida y L4 sobre el candidato

Texto del responsable («KUOTA — Aprobar gobernanza de mantenedor único y ejecutar L3/L4 de 001»):

- Es el único desarrollador y ejerce las responsabilidades técnica y de producto.
- Adopta `docs/drafts/governance-single-maintainer.md` (`f4feb3a`).
- No existe segundo desarrollador ni segundo revisor técnico.

**Interpretación registrada del propietario**: con un solo mantenedor, la aprobación humana que exige la Constitución
(Flujo de desarrollo, excepción de mantenedor único) la da el propio propietario, registrada en el PR y en
`approvals.md`. **No es una revisión independiente.** La Constitución 1.2.0 no cambia; la aclaración 1.3.1 sigue como
propuesta.

**Cambios aplicados en esta rama**: `6d4c256`, que fija la política de revisión de `docs/process/git-workflow.md` §5
(T055): 0 reviews exigidas en GitHub y ninguna review de CODEOWNERS mientras haya un solo mantenedor. Los borradores
del plan de integración y del paquete 1.3.0 se ajustaron en la rama de trabajo, no en esta.

**L3 (CODEOWNERS): DETENIDA.** El texto de aprobación traía el usuario como marcador literal (`@[TU_USUARIO_GITHUB]`),
sin un valor real. `.github/CODEOWNERS` conserva `<maintainer-handle>` en sus 17 reglas; no se escribe ningún usuario
no confirmado.

**L4** (2026-11-25, árbol `bb4521cf…`, commit `6d4c256`, anterior a L3; `scripts/ci/run-local.sh` y
`scripts/ci/prove-gates.sh` en secuencia, deteniéndose ante cualquier fallo):

| Job | PASS | FAIL | OMITIDO |
|---|---|---|---|
| `general` | 6 | 0 | 0 |
| `contracts` | 5 | 0 | **1**: oasdiff contra `main`, sin baseline legítimo. No es PASS; se desbloquea al fusionar el contrato (T049) |
| `backend` | 19 | 0 | 0. 758/758 pruebas; cobertura global 98,21 % sentencias / 96,54 % ramas |
| `flutter` | 15 | 0 | 0. Builds de Android y Web; **iOS fuera** (Aprobación 9) |
| `prove-gates` | 10 | 0 | 0 |

**Validez tras L3**: el único cambio pendiente es `.github/CODEOWNERS`. Ningún job lo lee como entrada; solo aparece en
`scripts/dev/path-filters.sh`, como disparador de la suite completa. Tras L3 se demostrará que el diff contra
`bb4521cf…` se limita a ese archivo; el commit de este registro solo añade documentación.

**`/speckit-analyze` de 001** (solo lectura): **0 CRITICAL**, 0 HIGH, 3 MEDIUM y 5 LOW.

- Cobertura: 49/49 requisitos (100 %) y 46/46 campos restringidos citados.
- Checklist `requirements.md` 16/16; sin violaciones de la Constitución 1.2.0.
- `tasks.md` coincide con el SHA-256 de la Aprobación 13.
- Los 3 MEDIUM son condiciones de fusión ya conocidas:
  - C1: OMITIDO de oasdiff, que necesita aprobación explícita al fusionar;
  - C2: SC-008 pendiente de validar en iOS;
  - C3: T091 (clon limpio) y CODEOWNERS sin usuario real.
- Los 5 LOW son documentales:
  - recuento de tareas en las notas de `tasks.md` (96 frente a 108);
  - cifras de alcance de `plan.md`;
  - textos de T094 y T104 frente a las decisiones aprobadas;
  - estado «Draft» de `spec.md`;
  - hash de la versión vigente de `plan.md` no registrado.

**Pendiente de CI remoto (no PASS):**

- T052: primera ejecución real de `CI: resultado`.
- T049: oasdiff.
- US3-8: asignación automática de revisores.

**Pendiente local:** L3 (usuario confirmado) y T091.

## Registro 2026-11-25 (2) — L3 completada y T091 avanzada

Texto del responsable («KUOTA — Completar L3 de 001 con el CODEOWNER confirmado»): «Confirmo expresamente que mi usuario
oficial de GitHub es @aguila486.» Autoriza L3, `general`, T091 en un clon local temporal sin red y estos registros.

**L3: COMPLETADA** (`a5caf9b`, `chore(ci)`, T053).

- `.github/CODEOWNERS` tiene 15 reglas, cada una con un patrón y un único dueño, `@aguila486`, sin patrones duplicados.
- No queda ningún `<maintainer-handle>` y no hay segundo dueño.
- La sustitución alcanzó también 2 comentarios, que se reescribieron:
  - el usuario está confirmado y ser CODEOWNER no es una aprobación;
  - no se añade un segundo dueño sin decisión expresa.
- El recuento de «17 reglas» de los informes anteriores era el de ocurrencias del marcador, no el de reglas.
- No es una revisión independiente de GitHub.

**Validez de L4**: el árbol de `a5caf9b` solo difiere del de L4 (`bb4521cf`) en `.github/CODEOWNERS` y en este archivo,
y ningún job lee ninguno de los dos como entrada. Las 55 verificaciones PASS, 0 FAIL y 1 OMITIDO (oasdiff) de L4 siguen
siendo válidas.

**Job `general` sobre `a5caf9b`**: **6 PASS, 0 FAIL, 0 OMITIDO**.

**T091: SIGUE ABIERTA**, con avance; detalle en `validation-report.md` §1b.

- Clon limpio sin red: FR-005 sin directorios vacíos y `make doctor` con «entorno listo».
- `scripts/dev/test-all.sh` en verde en 304 s, con oasdiff OMITIDO.
- Observación FR-005: `backend/eslint-rules/` no figura en la estructura de `plan.md`.

Falta, por motivos de autorización y no técnicos:

1. `scripts/dev/up.sh` con su medición (≤ 15 min y ≤ 30 min con pruebas). Crea un volumen persistente de Compose y la
   política vigente prohíbe crearlo o borrarlo sin autorización. Lo puede ejecutar el propio mantenedor.
2. La validación por el mantenedor (SC-001), que es una acción humana suya.

**Spec-Kit:**

- Trazabilidad verificada: T053 → FR-036 / US3-8, y T091 → SC-001 / FR-005.
- `/speckit-analyze` no se repitió: desde el del 2026-11-25 (0 CRITICAL) solo cambiaron `.github/CODEOWNERS`,
  `approvals.md` y `validation-report.md`; ningún documento normativo.
- `tasks.md` no se marca (fijado por hash).

## Registro 2026-11-25 (3) — T091 en entorno Docker aislado

Autorización del responsable: crear y eliminar solo recursos Docker temporales de esta prueba, con un proyecto único y
volúmenes nuevos, sin tocar recursos ajenos ni preexistentes.

**Resultado técnico** (detalle en `validation-report.md` §1c; clon temporal de `8c36c46`; con cachés, no es una máquina
limpia):

- Arranque listo en **26 s** desde el clon, frente a un límite de 15 min.
- Arranque más pruebas completas en verde en **368 s**, frente a un límite de 30 min.
- Las comprobaciones del §1 de la guía coinciden con lo esperado; migraciones 0001–0003 aplicadas; FR-005 sin
  directorios vacíos.
- oasdiff OMITIDO; no es PASS.

**Docker:**

- Creados y eliminados por nombre: el contenedor, la red y el volumen del proyecto `kuota-t091-20261125004128`.
- Antes y después: 0 diferencias; volúmenes protegidos intactos.

**SC-001 / T091: PENDIENTE DE APROBACIÓN HUMANA del mantenedor.** No se registra ninguna conformidad en su nombre.

**Spec-Kit:**

- Trazabilidad: T091 → SC-001 y FR-005; FR-005 tiene una observación pendiente (`backend/eslint-rules/` fuera de la
  estructura de `plan.md`).
- No cambió ningún documento normativo, así que no se repitió `/speckit-analyze`.

## Aprobación 14 — 2026-11-25: SC-001 y cierre de T091

Texto del responsable («KUOTA — Aprobar SC-001 y ejecutar R0 (solo lectura)», §1), mantenedor único `@aguila486`:

> «Acepto la ejecución documentada sin reproducirla personalmente. […] Como responsable técnico y propietario de Kuota:
> Apruebo SC-001 y autorizo el cierre de T091.»

Evidencia: `validation-report.md` §1c (commit `6e5356d`).

Reconocimientos expresos del responsable:

- La validación usó cachés locales; no se probó una instalación nueva sin cachés.
- Su aprobación no es una revisión técnica independiente.
- La observación FR-005 sobre `backend/eslint-rules/` sigue **abierta**.
- oasdiff contra `main` sigue **OMITIDO** y no se registra como PASS.

**Estado**: **SC-001 aprobado por el mantenedor** (con las salvedades anteriores) y **T091 cerrada**, con trazabilidad
T091 → SC-001 y FR-005. `tasks.md` no se marca porque está fijado por SHA-256 (Aprobación 13); el cierre consta aquí.
El `/speckit-analyze` del 2026-11-25 (0 CRITICAL) sigue vigente: no cambió ningún documento normativo.

**Tareas de 001 aún abiertas**: T049 (oasdiff, necesita `main` con el contrato) y T052 (primera ejecución del CI en
GitHub). También siguen pendientes SC-008 (validación iOS diferida, Aprobación 9) y US3-8 (asignación automática de
revisores en un PR real).

## Registro 2026-11-25 (4) — R0 de solo lectura: BLOQUEADO

Autorización del responsable: solo consultas de lectura para verificar la viabilidad de GitHub; usuario oficial
`@aguila486`; no cambiar cuentas, credenciales ni permisos.

**Identidad**: `gh auth status` muestra dos cuentas autenticadas (nombres omitidos por privacidad). **Ninguna es
`@aguila486`.** Se detuvo toda consulta que requiera acceso autorizado; no se cambió de cuenta ni de token.

**Sin credenciales**: `GET https://api.github.com/users/aguila486` (anónimo) confirma que la cuenta existe: tipo `User`,
creada en 2013. El plan solo es visible para la propia cuenta autenticada: **no verificado**.

**Documentación pública de GitHub** (docs.github.com; consultada el 2026-11-25):

| Capacidad | Resultado |
|---|---|
| Ramas protegidas en repositorios privados de cuenta personal | Requieren **GitHub Pro** o superior; Free solo en públicos. Esto último se deduce de que Free no las lista |
| Rulesets | La documentación las sitúa en Team o Enterprise; no confirma su disponibilidad en Pro personal. Se usará la protección clásica |
| `required_approving_review_count: 0` | Admitido: «0 to not require reviewers» |
| PR obligatorio con 0 aprobaciones | **No confirmado** por la documentación; verificar en R4 tras aplicarlo, leyendo la protección y probando un push directo rechazado |
| `require_last_push_approval` | Debe ser `false`: exige la aprobación de otra persona |
| Checks requeridos, historial lineal, resolución de conversaciones, sin *bypass* | Forman parte de la protección de ramas (Pro). El historial lineal exige permitir *squash* o *rebase*. Las listas de *bypass* y las restricciones de usuarios son solo de organización |

**R0: BLOQUEADO** hasta que el responsable inicie sesión con `@aguila486` y confirme un plan Pro o superior.

## Registro 2026-11-25 (5) — R0 tras iniciar sesión como `@aguila486`

- El responsable inició sesión él mismo con `gh auth login --web`. La cuenta **activa es `aguila486`** (tipo `User`); las
  otras dos cuentas guardadas quedan inactivas y no se tocaron.
- Ámbitos del token de `aguila486`: `gist`, `read:org`, `repo`. **Faltan `workflow` y `user`/`read:user`.**
  - Sin `read:user`, `GET /user` devuelve `plan: null`. **El plan sigue sin verificar.**
  - Sin `workflow`, GitHub rechaza publicar commits que contengan `.github/workflows/`. 001 contiene `ci.yml`, así que
    **R5 fallaría.**
- `aguila486/kuota-platform` **no existe** (404): el nombre está libre para R1.
- No se crearon recursos ni se cambiaron ámbitos, cuentas o permisos.

**R0: BLOQUEADO** (plan sin verificar). Lo resuelve el responsable ampliando los ámbitos de su propio token, sin que
Claude Code los cambie.

## Registro 2026-11-25 (6) — R0: NO-GO con el plan actual

El responsable declara: «no es una cuenta pro, es una cuenta free». El dato lo confirma el responsable; no se verificó por
API.

Según la documentación pública de GitHub (registro 4), las ramas protegidas en repositorios **privados** requieren
GitHub Pro o superior. El plan de integración exige protección efectiva de `main` antes del primer PR, y la Constitución
exige `main` protegida y merge solo vía PR. **R0: NO-GO** mientras la cuenta sea Free y el repositorio privado. No se
crea nada en GitHub; la decisión sobre cómo seguir es del responsable.

## Registro 2026-11-25 (7) — Plan verificado por API

El responsable amplió él mismo los ámbitos del token (`gh auth refresh --scopes read:user,workflow`). `GET /user` con la
cuenta activa `aguila486` devuelve **`plan: free`**. Coincide con lo declarado en el registro 6. **R0 sigue en NO-GO**
para un repositorio privado.

## Registro 2026-11-25 (8) — Decisión: repositorio PÚBLICO (opción B)

Decisión del responsable ante el NO-GO de R0 con plan Free: **publicar `aguila486/kuota-platform` como repositorio
público**. GitHub Free permite proteger ramas en repositorios públicos. Sustituye, por decisión expresa del responsable,
la frase del plan de integración «hacer público el repositorio no es aceptable».

Revisión previa de exposición (lo que se publicaría: `main` y esta rama, 175 commits):

| Dato expuesto | Decisión del responsable |
|---|---|
| Correo de autor de todos los commits | **Aceptado**: se publica tal cual (permanente) |
| Nombres de otras cuentas de GitHub del responsable, en el registro 4 (commits sin publicar del 2026-11-25) | **Eliminados del historial**. Se reescribieron solo los 4 commits de registro del 2026-11-25 posteriores a `7b865f4` (`746e897`…`8844f52` → `4d16536`…`731f8bb`). El árbol solo cambia en esa línea. Copia local `refs/backup/001-baseline-pre-rewrite-20261125`, que no se publica |
| Usuario del sistema operativo en una ruta local del registro H1 (`c207e58`, 2026-11-23) | Pendiente de decisión. Riesgo bajo; reescribirlo cambiaría commits ya aprobados |

Consecuencias que se asumen:

- Código, specs, documentos de seguridad y el modelo financiero quedan públicos.
- Sin licencia, el código conserva todos los derechos reservados; la licencia es una decisión pendiente.
- El CI de un repositorio público no consume minutos del plan.
- R1–R9 siguen necesitando autorización expresa.

## Registro 2026-11-25 (9) — Publicación R1–R6, primer CI real y tres defectos de portabilidad

Autorización del responsable: «Publicación controlada en GitHub de 001» (R1, R2, R4, R5, R6; sin merge ni otras ramas),
«Autorizo cerrar y reabrir el PR #1 para disparar el CI» y «Autorizo corregir los tres defectos de portabilidad y
publicarlos en el PR».

Estado verificado por API (solo lectura) antes de publicar las correcciones:

| Paso | Hecho |
|---|---|
| R1 | `aguila486/kuota-platform` creado **público** (2026-11-25T07:44:04Z); rama por defecto `main` |
| R2 | `main` publicada (`b63f9a4`) |
| R4 | Protección de `main`: check obligatorio `CI: resultado` (strict), `enforce_admins`, historial lineal, resolución de conversaciones, 0 aprobaciones requeridas (mantenedor único), sin force push ni borrado |
| R5 | Rama `feature/001-platform-foundation-baseline` publicada en `1d9914e` (sin protección) |
| R6 | PR #1 (`feature/001-platform-foundation-baseline` → `main`) abierto 07:45:37Z; el CI no se disparó y, con autorización, se cerró y reabrió |

Ajustes del repositorio observados y **no modificados**: merge commit deshabilitado, squash y rebase habilitados,
borrado de la rama al fusionar. El método de fusión («Rebase and merge») sigue pendiente de decisión del responsable.

**Primer CI real** (run `45572631758`, `pull_request`, `1d9914e`): **failure**. `changes` y `flutter` en verde;
`general`, `contracts` y `backend` fallaron por tres defectos de portabilidad a Linux (no de producto). T052 no se cierra.

| Tarea | Defecto | Causa confirmada (reproducida en `node:26.13.1-bookworm` antes del cambio) | Commit |
|---|---|---|---|
| T107 | `doctor.test.sh` «Docker ausente» → exit 0 | El PATH de la prueba incluía `/usr/bin`, que en el runner contiene docker real | `fc8ef05` |
| T023 | `lint-rules.test.sh`: 6 negativos «fallidos» | Con `CI` y `GITHUB_ACTIONS`, Redocly colorea el nombre de la regla (ANSI) y el texto esperado no coincide; el lint sí rechazaba (exit 1) | `1e9003d` |
| T025 (y T096) | `main-process.spec.ts`: 2/758 con error interno de Node | `nest build` (`deleteOutDir`) en dos suites paralelas borraba el `dist/main.js` de la otra. La hipótesis previa (escritura síncrona de logs) era errónea | `c504fb6` |

Sin cambios de código de producción, `nest-cli.json`, `vitest.config.ts`, workflow ni protección.

Regresión local completa sobre `c504fb6` (macOS, Node 26.13.1): `general` 0, `contracts` 0, `backend` 0 (758/758),
`flutter` 0, `prove-gates` 0. Único OMITIDO: oasdiff sin baseline en `main` (pendiente conocido; **no es PASS**).

Siguiente paso autorizado: publicar solo esta rama en el PR #1 y esperar `CI: resultado`. Sin merge.

## Registro 2026-11-25 (10) — CI real en verde sobre `faff72c` (evidencia de T052)

Autorización del responsable: «Autorizar reejecución de CI del PR #1», opción 1 (solo jobs fallidos).

- Run `45596776064` (`pull_request`, PR #1, `faff72c`):
  https://github.com/aguila486/kuota-platform/actions/runs/45596776064
- **Intento 1**: `changes`, `general`, `contracts` y `backend` en verde. `flutter` falló en `assembleDebug`, porque
  Maven Central respondió HTTP 429 (límite de peticiones externo) al resolver dependencias de Gradle. Las pruebas Dart
  y Flutter habían pasado y ningún commit nuevo toca `flutter/`.
- **Intento 2** (`gh run rerun 45596776064 --failed`, cuenta `aguila486`): `flutter` success. **`CI: resultado`
  success.** Los jobs del intento 1 siguen en verde: `changes`, `general`, `contracts` y `backend`.
- PR #1: abierto, `mergeable`, `mergeStateStatus: CLEAN`. Sin merge.
- **T052**: se cumple su criterio pendiente (primera ejecución real de `CI: resultado` en verde). Su cierre lo aprueba
  el responsable en la Aprobación 15.
- Riesgo observado: la descarga de Gradle depende de un servicio externo con límite de peticiones. Una caché o
  reintentos necesitarían una tarea y una aprobación propias.

## Aprobación 15 — 2026-11-25: cierre de T052 y condiciones de integración de 001 (PR #1)

Aprobación humana de `@aguila486`, responsable técnico y de producto, como **mantenedor único**. **No es una revisión
independiente** y no hay otros revisores.

1. **T052 cerrada.** Evidencia: run `45596776064`, intento 2, commit `faff72c`. `CI: resultado`, `flutter`, `general`,
   `contracts` y `backend` en SUCCESS. La aprobación vale para ese commit; no garantiza el resultado de commits
   posteriores, que necesitan su propio CI en verde.
2. **oasdiff: OMITIDO**, no PASS. Se acepta fusionar este primer PR sin comparación de compatibilidad, porque `main` no
   contiene un contrato que sirva de baseline. Este PR establece la baseline. **T049 sigue abierta** y se valida con la
   primera comparación real.
3. **SC-008 / iOS: diferido** (Aprobación 9), ni validado ni completado. No bloquea la integración inicial de 001. Sigue
   siendo requisito para las funcionalidades que dependan de él (checkpoint de US7).
4. **Estrategia de fusión: solo «Rebase and merge»**, sin squash ni merge commits, para conservar cada commit con sus
   líneas `Spec:`/`Tasks:` en un historial lineal. GitHub puede generar hashes nuevos en `main`; la trazabilidad se
   verifica por mensaje y por árbol.
5. **Tamaño del PR**: excepción **exclusiva** para la integración inicial de 001 (100 commits antes del registro 10,
   533 archivos, unas 50 082 líneas añadidas). Los PR posteriores respetan los límites ordinarios de la gobernanza.
6. Condiciones verificadas para el mantenedor único (Constitución 1.2.0, excepción vigente):
   - checklist constitucional del PR completo (27/27);
   - `/speckit-analyze` del 2026-11-25 con 0 CRITICAL, vigente porque no cambió ningún documento normativo;
   - CI obligatorio en verde en `faff72c`. El head final que incluya este registro necesita su propio CI en verde antes
     de fusionar.

Se mantienen: sin bypass administrativo; sin cambios de protección; sin push directo a `main`; Constitución 1.2.0 sin
cambios y 1.3.0 sin ratificar.

## Registro 2026-11-25 (11) — «Rebase and merge» rechazado y linealización local del historial de 001

Autorización del responsable: «Corregir historial de PR #1 mediante linearización local segura» (solo local; sin push,
sin force-push y sin merge). Este registro **corrige** un dato de la Aprobación 15 sin modificar su texto.

**Corrección de la Aprobación 15, punto 5.** El PR #1 tenía **176 commits**, no 100. `gh pr view --json commits`
devuelve como máximo 100 y ese límite se tomó por el total. Tamaño real en `dcd80b4` respecto a `main` (`b63f9a4`):
176 commits (175 tras la linealización), 533 archivos, 50 126 líneas añadidas y 202 eliminadas. La excepción de
tamaño sigue siendo **exclusiva** de la integración inicial de 001 y cubre estas cifras.

**Causa del bloqueo.** Tras el CI en verde del run `45622784250` sobre `dcd80b4`, `gh pr merge 1 --rebase
--match-head-commit dcd80b4…` fue rechazado («This branch can't be rebased»). La rama contenía el merge commit
`8e2182f` («integrate constitution v1.2.0 into 001-platform-foundation»; padres `5189da7` y `b63f9a4`), y «Rebase and
merge» no puede reaplicar merge commits. No se fusionó nada.

**Procedimiento (local).**

1. Estado verificado: worktree limpio; rama local, remota y head del PR en `dcd80b4`; `main` en `b63f9a4`.
2. Respaldo local, no publicado: `refs/backup/001-baseline-pre-linearize-20261125` → `dcd80b4`. Árbol original
   `c8b9497a74b98c058d3c84167880270c6da6bf9c`. `git fsck --connectivity-only` sin errores. El respaldo anterior
   `refs/backup/001-baseline-pre-rewrite-20261125` → `8844f52` se conserva.
3. Reconstrucción sobre `b63f9a4` en la rama local `tmp/001-linear-20261125`, con `commit-tree`. Se conservan, byte a
   byte, autor, committer, fechas y mensajes (incluidas las líneas `Spec:`/`Tasks:`):
   - los 9 commits anteriores al merge (desde la base común `2f9e193`) se reaplican en orden;
   - el merge `8e2182f` se **omite**: sobre la nueva base su árbol es idéntico al del commit anterior (commit vacío);
   - los 166 commits posteriores conservan su árbol exacto, con el nuevo padre.
4. **Conflicto único**, resuelto de forma explícita y no con «ours»/«theirs» global. `bd3cfec` (commit 2) añadía a
   `.specify/memory/constitution.md` el mismo texto de la excepción de mantenedor único que `main` y fijaba la versión
   **1.1.0**. `main` ya contiene la Constitución **1.2.0** y `docs/process/constitution-amendments.md`. Se conserva el
   blob 1.2.0 (`677092e2`), el mismo que tenían `b63f9a4`, `8e2182f` y `dcd80b4`. Un cherry-pick real de control
   produjo un único hunk en conflicto, la línea de versión (1.2.0 frente a 1.1.0), y con la resolución 1.2.0 dio el
   mismo árbol. Ningún commit posterior toca la Constitución. 1.3.0 no se ratifica.

**Equivalencia verificada** (head reconstruido `7b54565`, antes de este registro):

| Verificación | Resultado |
|---|---|
| A. Árbol final | `c8b9497a…`, idéntico al de `dcd80b4`; `git diff` vacío |
| B. Constitución | blob `677092e2` (1.2.0) en ambos |
| C. Commits | 176 originales → 175 nuevos + 1 merge omitido; 0 perdidos, 0 duplicados, 0 vacíos, 0 combinados |
| D. Merges | 0 en el historial nuevo (antes, 1) |
| E. Metadatos | autor, committer y mensajes idénticos byte a byte; `Spec:` 20 y `Tasks:` 20 en ambos historiales |
| F. Cambios por commit | los 166 posteriores, árbol y parche idénticos; los 9 anteriores, parche idéntico salvo los hunks de la Constitución de `bd3cfec` |

Ningún commit original estaba firmado.

**Pruebas locales sobre `7b54565`** (macOS, Node 26.13.1; el CI anterior no es evidencia del historial nuevo):
`contracts` 0, `backend` 0, `flutter` 0 (sin iOS). `general`: todas las verificaciones en PASS salvo «Nombre de
rama», que falla por el nombre temporal `tmp/…` y se valida aparte con el nombre del PR. `prove-gates`: 9/10 gates en
PASS; `secreto` falla solo en su control positivo por la misma causa de nombre de rama y se repite aparte. Un primer
intento de `prove-gates` quedó bloqueado en `cobertura-dart` (`flutter test` de `app_shell` sin CPU durante 2 h 48 min);
se detuvo y, al repetirlo, el gate pasó. oasdiff sigue **OMITIDO** (no PASS) y T049 sigue abierta.

**Pendiente:** actualizar la rama del PR #1 con `--force-with-lease`, ejecutar un CI nuevo y fusionar con «Rebase and
merge». Cada paso requiere una autorización expresa del responsable. Las referencias a SHA en los registros 9 y 10 y
en la Aprobación 15 (`1d9914e`, `fc8ef05`, `1e9003d`, `c504fb6`, `faff72c`, `dcd80b4`) son del historial anterior;
su equivalencia está en la tabla siguiente. Las corridas de CI citadas se ejecutaron sobre esos SHA anteriores.

<details>
<summary>Correspondencia de commits: historial anterior → historial lineal (176 filas)</summary>

| n | Anterior | Nuevo | Asunto |
|---|---|---|---|
| 1 | `2d47f96` | `42df91e` | docs(specs): add 001-platform-foundation specification |
| 2 | `bd3cfec` | `17e5ea7` | docs(specs): clarify 001 (FVM toolchain, single-maintainer review, CI build targets) |
| 3 | `395049d` | `8f5d73c` | docs(specs): add 001 implementation plan, research, data model, contracts and quickstart |
| 4 | `7c6ccec` | `1f3708a` | docs(specs): add 001 tasks (92 tasks, tests-first, spike RLS gate) |
| 5 | `79906e6` | `fe22ad8` | docs(specs): resolve 001 analyze findings (D1–D4, F1, C1–C4) |
| 6 | `002b28e` | `573eb65` | docs(spec): align platform foundation with constitution v1.2.0 |
| 7 | `47dd7aa` | `2b60733` | docs(adr): record architecture decisions and add ADR-0007 money representation |
| 8 | `78a8d49` | `734efc7` | docs(docs): align architecture, security and quality docs with accepted decisions |
| 9 | `5189da7` | `c69f832` | docs(specs): trace 001 to D-FIN-01, D-ARC-02 and ADR-0004 spike criteria |
| 10 | `8e2182f` | — (omitido) | docs(constitution): integrate constitution v1.2.0 into 001-platform-foundation |
| 11 | `b2becb4` | `62b9fce` | docs(specs): resolve final 001 analyze findings (A1, B1, C1, I1, I2) |
| 12 | `94356ee` | `fd79f89` | docs(specs): record approval of 001 spec, plan and tasks (G1 authorized) |
| 13 | `6adbbbb` | `4c3430d` | chore: pin Node 26.13.1 and pnpm 12.21.0, add env example and doctor script |
| 14 | `9788788` | `a6372b9` | chore(infra): add local PostgreSQL 18 compose and database roles |
| 15 | `081f15a` | `19e51ba` | chore(backend): scaffold NestJS 12 backend with SWC, Vitest, lint and Testcontainers |
| 16 | `d154a26` | `665c5fc` | docs(specs): record G1 implementation decisions and mark T001-T011 done |
| 17 | `054c24e` | `093ced0` | feat(backend): add 0001_foundation migration with forced RLS, grants and append-only audit |
| 18 | `9dfa9b8` | `55761c8` | docs(specs): record 0001_foundation implementation details and mark T013 done |
| 19 | `e843977` | `f9c38df` | docs(specs): amend T012/T014/T015 scope and close T012 |
| 20 | `e6e4b91` | `6d0e423` | chore(backend): add Prisma 7 spike tooling and T014 RLS spike |
| 21 | `76db959` | `8e1bf3b` | docs(specs): add T014 spike report and mark T014 done |
| 22 | `2670c4b` | `5c7d354` | chore(backend): apply ADR-0004 conditions P1-P4 for Prisma migrations and tenant context |
| 23 | `68fb152` | `f1671e7` | docs(adr): accept ADR-0004 with conditions P1-P8 (D-ARC-01: Prisma 7) |
| 24 | `8cf8580` | `a17365b` | docs(specs): close T015 with the conditional Prisma approval |
| 25 | `389162f` | `3b14910` | feat(backend): add validated configuration with startup guards (T016, T017) |
| 26 | `9c4b4b3` | `39cf57e` | feat(backend): add structured logging with correlation and redaction (T018, T019) |
| 27 | `e844393` | `7c60054` | feat(backend): add global problem+json error filter (T020, T021) |
| 28 | `a1938a9` | `c20983c` | docs(specs): record G4 implementation decisions and mark T016-T021 done |
| 29 | `11655f8` | `af11ab6` | feat(contracts): materialize multi-file OpenAPI source, Redocly rules and oasdiff check (T022-T024) |
| 30 | `3127f5a` | `05205fe` | fix(backend): stop mapping uncovered HttpException statuses to validation-error |
| 31 | `48e37f0` | `d44e01b` | feat(backend): wire bootstrap with config, logging, problem filter and dev-module registry (T025) |
| 32 | `61741c6` | `20b9f26` | docs(specs): record G5 implementation decisions and mark T022-T025 done |
| 33 | `07478e9` | `4c892c3` | fix(backend): mount request context middleware for routes outside the /v1 prefix |
| 34 | `9a99bb5` | `72af188` | feat(backend): add health and compatibility endpoints (T026-T029) |
| 35 | `ca72b6b` | `9401ab3` | feat: add local up/down, test-all and test-affected scripts with Makefile (T030-T032) |
| 36 | `d97e11d` | `340e343` | docs: add developer quick start to README (T033) |
| 37 | `47aa7b1` | `513328f` | docs(specs): record G6 implementation decisions and pending items; mark T026-T033 done |
| 38 | `a876b1b` | `5e14f8a` | feat(backend): add TenantContext, DevTenantGuard and withTenant (T038, T039) |
| 39 | `7fb40c9` | `054b8bb` | feat(backend): add db:check-rls catalog verifier and RLS database tests (T035, T036, T043) |
| 40 | `869f826` | `b14fc66` | docs: adopt index.ts as the public API of a module |
| 41 | `2b3e9d9` | `1929359` | docs(specs): record G7a implementation decisions and mark T035, T036, T038, T039, T043 done |
| 42 | `62aabd9` | `dc8f9d7` | docs(adr): amend ADR-0002 to name index.ts as the module public API |
| 43 | `7d8c1fd` | `d5a97c1` | test(backend): add P2 residual-risk evidence and cover tenant-context defensive branches |
| 44 | `fc0b429` | `c699780` | docs(adr): record P2 residual-risk assessment; P2 stays partial |
| 45 | `fd39ca0` | `ddaeb46` | feat(contracts): add shared Money fixtures, schema and currency catalog (T056) |
| 46 | `94150d6` | `3fd30cb` | feat(backend): add exact Money primitive, JSON boundary and anti-float rule (T057, T061, T062 partial, T064) |
| 47 | `66c5ea4` | `ffe0ecd` | docs(specs): record US4 backend decisions and pending items; mark T056, T057, T061, T064 done |
| 48 | `1f6057e` | `b730fe5` | test(backend): reproduce P2 risk R3 on the transactional client before hardening |
| 49 | `d19bb14` | `61f1e41` | fix(backend): bind the transactional client to its owning withTenant (P2 R3) |
| 50 | `db8c2d4` | `ec60a4f` | docs(adr): record R3 hardening in the P2 assessment; P2 stays partial |
| 51 | `56b3e0f` | `45cf4d1` | docs(specs): mark P2 R3 resolved and flag ADR-0002 C2-1 wording for review |
| 52 | `f5e4434` | `7b8d244` | docs(adr): ADR-0002 amendment 2 — clarify C2-1 (CLS context, private ALS transaction ownership) |
| 53 | `678546f` | `4274f43` | feat(backend): add dev-probe module with tenant-scoped repository and Money boundary (T040–T042, T062) |
| 54 | `ccd251f` | `dbf3d0e` | test(backend): add reusable describeTenantIsolation suite and test:tenancy (T034, T037, T044) |
| 55 | `4629613` | `c32b7cc` | test(backend): verify dev-probe routes do not exist outside local/testing (T096) |
| 56 | `65f801c` | `d00d2f5` | test(backend): give the in-test container start of foundation-schema an explicit timeout |
| 57 | `234b3cf` | `89fb210` | docs(specs): mark G7b tasks done (T034, T037, T040–T042, T044, T096, T062) and record dev-probe decisions |
| 58 | `240d308` | `753468e` | test(backend): attach the rejection handler of the late-query R3 test immediately |
| 59 | `8d1f65d` | `53a4fb6` | feat(backend): add reusable idempotency and append-only audit building blocks (T074–T077) |
| 60 | `64593fc` | `429b2a4` | feat(backend): make dev-probe create idempotent and audit create/update (T072, T073, T078 partial, T079 partial) |
| 61 | `47a2ca9` | `4ab7fb3` | docs(specs): mark T072, T074–T077 done; record US6 decisions and the DELETE-audit and purge blockers |
| 62 | `63edf38` | `3196d62` | test(backend): check input reflection only in errors[] of dev-probe validation responses |
| 63 | `6a303ac` | `a04dad7` | feat(contracts): declare 400 validation-error on deleteDevProbeItem for the audited-operation actor policy |
| 64 | `16e70b2` | `2a5fc93` | feat(backend): audit deleteDevProbeItem with the explicit-actor policy (T073, T078) |
| 65 | `2edd08b` | `9a91eaa` | feat(infra): provision least-privilege maintenance roles for idempotency purge (US6, T079) |
| 66 | `7fbf2fa` | `a9b2f86` | feat(backend): add migration 0002 for expired-key purge and verify it in db:check-rls (T079) |
| 67 | `7b3c1e8` | `e107f50` | feat(backend): add manual idempotency purge run by the maintenance identity (T079) |
| 68 | `46e57d1` | `a895893` | docs(adr): assess audit origin ip-hash privacy and propose HMAC (no algorithm change) |
| 69 | `1f9ad1c` | `23ad3f2` | docs(specs): close US6 tasks T073, T078, T079; unmark T072 pending its text amendment; record approval 3 |
| 70 | `04381fc` | `76eb60e` | test(backend): add expectToMatchContract and contract tests for real responses (T066, T067) |
| 71 | `4ba7b45` | `f1814af` | test(backend): contract-test the idempotency responses of createDevProbeItem (T095) |
| 72 | `73b0ca2` | `5139d1e` | docs(specs): apply the approved T072 amendment and close T072, T066, T067, T095 (approval 4) |
| 73 | `dd9f9ce` | `1b8e01a` | docs(adr): ADR-0004 amendment 1 — record the idempotency maintenance roles in C4-1 |
| 74 | `77a24eb` | `e405c9a` | feat(backend): read-only migration preflight before make up migrates (0002 prerequisites) |
| 75 | `71d59cb` | `6c0bb29` | test(backend): regression review of the maintenance roles' effective privileges |
| 76 | `6a05430` | `848eb2a` | docs(specs): record US5a notes, preflight mitigation and the origin minimization recommendation |
| 77 | `08e42c6` | `61de639` | style(backend): strip two trailing spaces in schema.prisma |
| 78 | `de0fda9` | `8db580d` | feat(ci): add CI job scripts and their tests (T045–T049, T051) |
| 79 | `ab14b55` | `d26a2b8` | feat(ci): add the GitHub Actions workflow with a fail-closed result job (T052) |
| 80 | `bdcc831` | `8b14a3b` | chore(ci): add CODEOWNERS with a placeholder owner and update the PR template (T053, T054) |
| 81 | `8f5bd19` | `ae2e273` | docs(specs): document main branch protection ready to apply and record CI validation limits (T055) |
| 82 | `9573293` | `0ad5fcd` | fix(ci): report the skipped oasdiff comparison as OMITIDO in make test, not as passed |
| 83 | `b413537` | `9436553` | docs(specs): close T045–T048, T051, T053–T055; keep T049, T050, T052 open; record G12 decisions |
| 84 | `1803b0e` | `5583c0d` | fix(backend): override effect to 3.22.1 under @prisma/config (GHSA-7589-6fvf-x4pw) |
| 85 | `ac2d07e` | `9481328` | fix(ci): make the dependency gate fail closed on invalid osv-scanner reports |
| 86 | `af2e1f4` | `98a249e` | docs(specs): record security decision SEC-2026-001 for effect GHSA-7589-6fvf-x4pw |
| 87 | `a80da0c` | `df25424` | feat(backend): record a logical audit origin with no network data (Approval 5) |
| 88 | `9c845cc` | `77c871a` | docs(specs): amend data-model audit_events.origin to a logical origin and record Approval 5 |
| 89 | `c5a6877` | `11ff251` | docs(adr): mark the audit origin assessment resolved by minimization; track SEC-2026-001 |
| 90 | `f0ed0b9` | `f5babc1` | fix(backend): log HTTP requests through allowlist serializers (no IP, headers or query) |
| 91 | `16db35e` | `c4ae4dc` | chore(ci): require the HTTP log privacy suites in the backend job |
| 92 | `bc6fa09` | `ad4e19a` | docs(specs): record Approval 6 and the HTTP log minimization notes |
| 93 | `4fae968` | `f3b54fd` | docs(adr): add the HTTP log minimization policy and close the access-log finding |
| 94 | `5b2568a` | `cf2956d` | test(backend): add fast-check property tests for Money (T058) |
| 95 | `14ef560` | `e98ede1` | feat(ci): add the anti-float reference file and gate scripts in the backend job (T060, T065) |
| 96 | `cfcf1cd` | `ad855ae` | docs(specs): close T058 and T060; keep T065 open for its Dart part; record US4 TS notes |
| 97 | `bcf55d6` | `e4b483e` | test(backend): move service-level audit tests to their own file so the HTTP app keeps its CLS host |
| 98 | `b9cffcf` | `216db73` | feat(flutter-pkg): add the FVM-pinned Flutter workspace with shared_core, financial_domain, design_system and check_deps (T080–T084) |
| 99 | `8d41796` | `8b415a0` | fix(ci): treat a Dart directory without files as PENDIENTE and list local Flutter checks in run-local |
| 100 | `34c958c` | `7fcd59f` | docs(specs): close T081–T084, keep T080 open with an amendment proposal, record US7a decisions |
| 101 | `e07bb8f` | `5824143` | docs(specs): split T080 into initialization (A) and final composition (B) to break the T070/T085 cycle (Approval 7) |
| 102 | `1e8d7c6` | `14ebfff` | test(ci): require breaking.sh to fail when a required CompatibilityInfo field is removed (T068) |
| 103 | `8de9b61` | `52ee038` | feat(contracts): add the client bundle without dev-probe and the pinned dart-dio generator script (T069, T070) |
| 104 | `ca910ca` | `b2197cd` | feat(flutter-pkg): add api_client generated from the client contract with correlation and app-version interceptors (T070) |
| 105 | `7c97f02` | `8e6fc6f` | docs(specs): close T068–T070 and record the dart-dio spike result in R-12 |
| 106 | `81331d8` | `26c0d7d` | feat(ci): make the Dart client regeneration gate mandatory and add test:contract (T071) |
| 107 | `eeafe98` | `a724f81` | feat(ci): add the Flutter job script with Dart dependency scanning and coverage (T050) |
| 108 | `51242f1` | `27e90eb` | feat(flutter-pkg): add compatibility classification to api_client and the common startup screen to design_system (T085) |
| 109 | `6bf5584` | `1b9f225` | feat(admin): add the Kuota Admin, Flutter Web shell (provisional, D-ARC-03) with the startup screen (T085) |
| 110 | `2b19aac` | `fc4addd` | feat(collector): add the Kuota Collector, Android and iOS shell with the startup screen (T085) |
| 111 | `db88a9b` | `ada9937` | feat(client): add the Kuota Client, Android and iOS shell with the startup screen (T085) |
| 112 | `ac846e0` | `d5a4550` | feat(flutter-pkg): register the three apps in the workspace and add per-environment configs (T085, T080 stage B) |
| 113 | `1f2d99a` | `51062ab` | docs(specs): close T050, T071, T080 and T085; record CI Flutter, app evidence, CORS gap and iOS blocker |
| 114 | `7501ed7` | `e68dbf6` | feat(backend): add an exact-origin CORS policy for Kuota Admin on Flutter Web (Approval 8) |
| 115 | `839f719` | `d35944c` | fix(backend): wait for Docker to confirm exit before removing Testcontainers databases |
| 116 | `93c35cb` | `952e37a` | feat(ci): verify the single workspace lockfile and document the mobile commands (T086) |
| 117 | `7f808b8` | `5a64640` | docs(specs): record Approval 8, close T086 and T097, document CORS, iOS blocker and Testcontainers root cause |
| 118 | `a54378b` | `5ff1d04` | feat(flutter-pkg): implement Money and RoundingMode in Dart with BigInt (T063) |
| 119 | `d8ed355` | `a851a97` | test(flutter-pkg): run the shared Money fixtures on the Dart VM and in Chrome (T059) |
| 120 | `e930167` | `2396ed9` | feat(ci): verify the Dart anti-float rule on real Money code and a defective reference (T065) |
| 121 | `f9240a1` | `86a1cff` | docs(specs): record Approval 9 (iOS validation deferred), close T059, T063 and T065, and fix quickstart section 5 |
| 122 | `1902a5f` | `c745efe` | docs(specs): correct the Flutter test total in the US4 Dart record (124) |
| 123 | `d569081` | `c2981a6` | feat(backend): add OpenTelemetry metrics on a separate, token-protected listener (T094) |
| 124 | `4f576c5` | `1888248` | test(backend): cover metrics access, content, privacy and cardinality (T093) |
| 125 | `f554ae5` | `10c3b8f` | feat(ci): prove that each blocking gate fails on its reference defect (T087) |
| 126 | `6a8f901` | `23f8467` | docs(specs): record the documentation-only CI duration in the quickstart (T088) |
| 127 | `776a6a6` | `1125645` | docs: update CLAUDE.md with the real commands and the existing folders (T089) |
| 128 | `163c529` | `942f9d7` | docs(adr): record the post-implementation state of ADR-0002, 0003 and 0004 without re-approving them (T090) |
| 129 | `5dfc6a1` | `5447018` | docs(specs): add the 001 validation report with clean-clone evidence; T091 stays open |
| 130 | `fc3fbc9` | `2acf9fd` | docs(specs): close T093 and T087-T090, keep T094 pending ratification, record the read-only T092 analysis (2 CRITICAL) |
| 131 | `ee3fd55` | `74eec13` | feat(ci): add a blocking line and branch coverage gate for the shared Dart packages (C1) |
| 132 | `28277f5` | `15f8e2e` | fix(ci): resolve symlinks in the Dart coverage gate package path (C1) |
| 133 | `87b5874` | `968fcd1` | refactor(flutter-pkg): move config loading and compatibility classification out of the apps (C2, partial) |
| 134 | `c207e58` | `fbafe73` | docs(specs): record verified past authorizations (H1), Approval 10 (local-only) and the ratification of T094 |
| 135 | `ce76132` | `829227a` | fix(backend): answer problem+json not-found for every unmatched path, not only under /v1 (H3) |
| 136 | `5737ffd` | `489e386` | docs(specs): record C1 coverage before/after, C2 alternatives, H3 fix and the local regression |
| 137 | `f9d4062` | `5597d66` | docs(specs): record Approval 11 (app_shell, generated-code coverage rule) and add task T098 |
| 138 | `fbe568d` | `b2a16e0` | feat(flutter-pkg): add app_shell and move the shared app composition out of the three apps (T098, C2) |
| 139 | `bb49614` | `a67be84` | docs(adr): amend ADR-0003 with app_shell and update the architecture, plan and README (Approval 11) |
| 140 | `1831bde` | `5fcd5fd` | docs(specs): close T098 with C2 evidence, keep T092 open, specify H2 behavior and add the 002 draft analysis |
| 141 | `4b9602b` | `2d9eec9` | docs: add the 002 draft package (D-ARC-07 ADR proposal, decision matrices, draft spec, roadmap) |
| 142 | `4cc9e4e` | `7bb8485` | docs(specs): run the local convergence of 001 (T092): append T099-T108, fix stale doc comments |
| 143 | `ec53fa3` | `f40a585` | fix(flutter-pkg): quote-free test:financial description so the workspace pubspec parses again |
| 144 | `ff204cc` | `993a333` | feat(backend): audit every cross-tenant idempotency purge in platform_audit_events (T099) |
| 145 | `815368b` | `50022ae` | feat(backend): enforce allowlist dependency rules for domain/ and common/money (T100) |
| 146 | `62ea557` | `aa94da5` | docs: reflect the platform audit separation in the 002 drafts and list the decisions needed before tenants, users and sessions |
| 147 | `9eee7e8` | `40467cd` | fix(backend): finish the T099/T100 test and format updates |
| 148 | `c8c52b6` | `3ec187f` | docs(specs): close T099, T100 and T092 with evidence; record the residual tenant-client exposure as a proposal |
| 149 | `bde6385` | `2dc8b77` | feat(backend): structured lifecycle, readiness and conflict events, and a suite-wide log privacy gate (T101, T102) |
| 150 | `e09e00e` | `011805b` | feat(contracts): block removal of optional response properties in the breaking-change gate (T103) |
| 151 | `e0d5381` | `fe4921a` | feat(ci): prove the generated-client gate, test doctor.sh with fake binaries, require the access-exception suites (T106-T108) |
| 152 | `849249b` | `4d3d4b6` | docs(specs): trace migrations 0002 and 0003, the maintenance roles and the migration preflight in the plan structure (T105) |
| 153 | `13294f8` | `f84f001` | docs(specs): close T101-T103 and T105-T108 with evidence; keep T104 pending a FR-021 decision; record the T099 re-audit |
| 154 | `beae6db` | `2333f73` | feat(backend): type-aware anti-float rule for monetary values (T104, option C of Approval 12) |
| 155 | `793712e` | `074c261` | docs(specs): record Approval 12 (T104 option C and the FR-021 interpretation) |
| 156 | `9f6f8af` | `1754fa4` | docs(specs): close T104 with evidence, explain the backend gate count, and add the 002 first-flow decision matrix |
| 157 | `c48d37c` | `3a4fabf` | fix(backend): synchronous stdout log destination so shutdown events survive SIGTERM (001 T101) |
| 158 | `eb4c780` | `debefff` | docs: keep the 002 drafts out of the 001 baseline |
| 159 | `b6c1cad` | `ade682e` | docs(specs): add the 001 baseline PR manifest with review sections and local evidence |
| 160 | `cba357d` | `1c55b33` | docs(specs): cite the platform_audit_events fields in T099 and record Approval 13 (E1) |
| 161 | `6d4c256` | `9dc63b8` | docs(process): single-maintainer review policy for main protection (001 T055) |
| 162 | `3cf8517` | `80bdeb8` | docs(specs): record single-maintainer interpretation, L3 stop and L4 results on the 001 candidate |
| 163 | `a5caf9b` | `f9a772f` | chore(ci): name the single real code owner @aguila486 (001 T053) |
| 164 | `8c36c46` | `81ade8b` | docs(specs): record L3 completion, general job and the second clean-clone run of T091 (001) |
| 165 | `6e5356d` | `5220abb` | docs(specs): record the isolated Docker run of the 001 quickstart for T091 (technical part done) |
| 166 | `7b865f4` | `e87561d` | docs(specs): record the maintainer's SC-001 approval and close T091 (001 approval 14) |
| 167 | `4d16536` | `9823b7c` | docs(specs): record the read-only R0 result for the 001 integration (blocked: authenticated account is not @aguila486) |
| 168 | `28a826d` | `4d7e198` | docs(specs): record R0 after logging in as @aguila486 (plan unverifiable: token lacks read:user; workflow scope needed for R5) |
| 169 | `f253539` | `3f138f9` | docs(specs): record R0 NO-GO for the 001 integration (owner states @aguila486 is on GitHub Free) |
| 170 | `731f8bb` | `c94bbee` | docs(specs): record API-verified GitHub plan for @aguila486 (free): R0 stays NO-GO |
| 171 | `1d9914e` | `ceed14d` | docs(specs): record the owner's decision to publish 001 as a public repository and the pre-publication exposure review |
| 172 | `fc8ef05` | `044571f` | fix(ci): isolate the doctor test PATH from system binaries so "Docker absent" holds on Linux |
| 173 | `1e9003d` | `f486421` | fix(ci): run the contract lint-rule test without colors so rule names match on GitHub Actions |
| 174 | `c504fb6` | `a4f0a15` | fix(backend): give each process test its own build so parallel `nest build` cannot delete it |
| 175 | `faff72c` | `cbb18cf` | docs(specs): record the 001 publication (R1-R6), the first CI run and the three portability fixes |
| 176 | `dcd80b4` | `7b54565` | docs(specs): record the green CI run for 001 and Approval 15 (close T052, integration conditions) |

</details>
