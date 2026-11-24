# Manifiesto del PR de integración de 001 (línea base del monorepo)

> Fase L autorizada («KUOTA — Autorizar fase L de integración 001», 2026-11-24). Procedimiento:
> `docs/drafts/001-integration-github-bootstrap.md` (commit `8ce8cc1` de la rama de trabajo). Este documento acompaña al
> futuro PR. No autoriza operaciones remotas.

## 1. Origen del candidato

| Elemento | Valor |
|---|---|
| Base | `main` = `b63f9a4` (Constitución 1.2.0) |
| Historial de 001 conservado | `b63f9a4..9f6f8af`: 156 commits con sus SHA originales, uno de ellos el merge `8e2182f` |
| Aplicado | `504b33e` → `c48d37c` (`cherry-pick -x`; 001 T101; blobs idénticos al original) |
| Retirado del árbol | `docs/drafts/002-identity-tenancy/` (7 borradores de 002) → `eb4c780` |
| Excluido | `d2f5e10` (`Tasks: T048 (002)`; excepción gitleaks de un commit de 002) y todo commit de 002 |
| Árbol de código verificado | `1ca6cb51338de3ec67eb57cf5ab07d52a8b7bbb1`, igual que la simulación previa |
| Copia del historial original | `~/kuota-backups/kuota-platform-2026-11-24.bundle` (SHA-256 `e4b6353f…`; `git bundle verify`: completo) |

## 2. Archivos por sección (531 frente a `main`)

| # | Sección revisable | Archivos | Líneas |
|---|---|---:|---|
| 1 | Gobernanza, specs y docs de 001 (`specs/001`, `docs/`, plantilla de PR) | 42 | +5 773 / −202 |
| 2 | CI y repositorio (`.github/`, `scripts/ci/`, configuración de editorconfig) | 35 | +2 129 |
| 3 | Infra y entorno local (`infra/`, `scripts/dev/`, `Makefile`, `.env.example`) | 14 | +713 |
| 4 | Backend: código, migraciones `0001`–`0003` y configuración | 79 | +6 350 |
| 5 | Backend: pruebas | 74 | +12 623 |
| 6 | Contrato OpenAPI, fixtures de dinero y scripts de contrato | 49 | +3 287 |
| 7 | Flutter: paquetes compartidos (código escrito a mano) | 43 | +2 828 |
| 7b | Flutter: cliente Dart **generado** (`api_client/lib/src/generated`; verificado por el gate de regeneración) | 30 | +2 816 |
| 8 | Flutter: apps, `tool/` y workspace | 161 | +4 787 |
| 9 | Lockfiles (`pnpm-lock.yaml`, `flutter/pubspec.lock`) y workspace raíz | 4 | +8 251 |
| | **Total** | **531** | **+49 557 / −202** |

Lista exacta: `git diff --name-only b63f9a4 <commit final>`.

**Fuera del PR** (verificado sobre el árbol):
- `specs/002-identity-tenancy/`;
- migraciones `0004`–`0008`;
- `platform-api`, identidad e invitaciones;
- contratos y cliente Dart de 002;
- `.gitleaksignore` y SEC-2026-002;
- ADR-0008;
- borradores de 002 y de la enmienda 1.3.0.

## 3. Desviación de tamaño (autorizada, limitada a este PR)

El PR supera el objetivo de 400 líneas (`docs/process/git-workflow.md` §3) porque establece la fundación completa del
monorepo. La desviación vale **solo para este PR inicial** y no autoriza PR futuros de tamaño ilimitado. Mitigación:
- revisión por las secciones de §2;
- 30 archivos generados y 8 251 líneas de lockfiles comprobados por gates;
- implementación ya aprobada por grupos en `specs/001-platform-foundation/approvals.md`.

## 4. Evidencia de pruebas sobre el candidato real (`eb4c780`, 2026-11-24, local)

| Verificación | Resultado |
|---|---|
| `run-local.sh general` | 6 PASS: rama, gitleaks historial, gitleaks sin confirmar, editorconfig, actionlint, doctor |
| `run-local.sh contracts` | 5 PASS + 1 **OMITIDO** (oasdiff contra `main`: sin baseline legítimo; nunca PASS); Vitest 110/110 |
| `run-local.sh backend` | 19 PASS; Vitest 758/758 (incluida `log-destination.spec.ts`) y 10/10; cobertura 98,21 % líneas, 96,54 % ramas; ESLint + dependency-cruiser; osv-scanner |
| `run-local.sh flutter` | 15 PASS: análisis, formato, pruebas, `check_deps`, cobertura de paquetes, anti-float, osv, builds Web y Android |
| `prove-gates.sh` | 10 PASS: cada gate falla con su defecto de referencia y pasa limpio |
| gitleaks sobre todo lo alcanzable desde el candidato, con `.gitleaksignore` anulado | 161 commits, sin hallazgos |
| `/speckit-analyze` de 001 (solo lectura) | **0 CRITICAL**; 1 HIGH (E1: tareas sin cita `Entity.field` de `platform_audit_events`), 2 LOW; cobertura 49/49 |
| Archivos de 002 en el árbol | ninguno |

**Abiertas** (no se declaran superadas):
- T049: oasdiff, pendiente de baseline en `main`;
- T052: primera ejecución real del workflow;
- T091: clon limpio validado por el mantenedor;
- US3-8: CODEOWNERS con usuarios reales;
- E1: requiere aprobación para editar `tasks.md`;
- iOS: diferido (Aprobación 9).

## 5. Condiciones obligatorias antes de fusionar

1. `.github/CODEOWNERS` con usuarios reales de GitHub con permiso de escritura. Hoy conserva `<maintainer-handle>`:
   **no publicable** hasta que el responsable dé los usuarios.
2. Primera ejecución real de `CI` en el PR con `CI: resultado` = success. Si no aparece o queda pendiente, no se fusiona;
   no se reduce, retira ni evita el control.
3. Aprobación de un revisor distinto del autor en GitHub, checklist constitucional y `/speckit-analyze` sin CRITICAL.
4. Fusión con **Squash and merge** y mensaje «título del PR + lista de commits» (`pr-title-commits`). La lista conserva
   en `main` los asuntos de los 158 commits con su referencia a tareas.
5. Tras fusionar: CI verde en `main`, baseline de oasdiff disponible y registro en `approvals.md` de:
   - el SHA del squash;
   - el rango original `b63f9a4..<commit final>`;
   - el bundle.
