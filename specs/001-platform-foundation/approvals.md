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
