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
