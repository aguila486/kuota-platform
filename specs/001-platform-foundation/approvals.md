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

### Propuesta de enmienda (PENDIENTE de aprobación): texto de T072

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
