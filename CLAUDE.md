# CLAUDE.md — Guía operativa para Claude Code en Kuota

> Este archivo lo lee Claude Code al iniciar cada sesión en `kuota-platform`.
> La autoridad máxima del proyecto es la **Constitución**: `.specify/memory/constitution.md`.
> Si este archivo y la Constitución se contradicen, prevalece la Constitución.

## 1. Qué es Kuota

Kuota es una plataforma **SaaS multi-tenant** para empresas que otorgan préstamos y microcréditos,
administran ahorro programado y operan cobranza en campo (con frecuencia en efectivo y sin conectividad).

| Componente | Nombre técnico | Ubicación | Rol |
|---|---|---|---|
| Kuota Core | backend | `backend/` | API REST, motor financiero, **ledger (autoridad contable)** |
| Kuota Admin | admin_web | `flutter/apps/admin_web/` | Panel administrativo (Flutter Web) |
| Kuota Collector | collector_mobile | `flutter/apps/collector_mobile/` | App de cobradores, **offline-first** |
| Kuota Client | client_mobile | `flutter/apps/client_mobile/` | App de clientes finales |

Estado actual: **fase de fundación**. Todavía no hay código de aplicación. Muchas carpetas de la estructura objetivo
aún no existen y **no deben crearse vacías** solo para completar el árbol; se crean cuando una tarea aprobada lo requiere.

## 2. Arquitectura seleccionada (resumen)

- **Monorepo único** (ADR-0001): un solo repositorio Git y un solo proyecto Spec-Kit en la raíz.
- **Backend**: Node.js LTS + TypeScript + NestJS como **monolito modular** (no microservicios) — ADR-0002.
  pnpm workspaces sin Nx/Turborepo en la etapa inicial.
- **Base de datos**: PostgreSQL con **Row-Level Security** por `tenant_id`; ORM Prisma (propuesto) — ADR-0004.
- **Ledger**: partida doble, append-only, correcciones por reverso — ADR-0005.
- **Flutter**: Dart pub workspaces (+ Melos para orquestar scripts) — ADR-0003. Drift/SQLite para offline.
- **Contratos**: OpenAPI en `contracts/openapi/` es la fuente de verdad REST; el cliente Dart se **genera**.
- **Offline**: sincronización por **comandos idempotentes** (outbox), servidor autoritativo — ADR-0006.

Detalle: `docs/architecture/` y `docs/decisions/`.

## 3. Metodología: Spec-Driven Development con GitHub Spec-Kit

Spec-Kit **v1.4.3** (oficial, `github/spec-kit`) con integración `claude`. Skills disponibles:

| Paso | Skill | Produce |
|---|---|---|
| Principios | `/speckit-constitution` | `.specify/memory/constitution.md` |
| Especificar | `/speckit-specify` | rama `feature/NNN-slug` + `specs/NNN-slug/spec.md` |
| Clarificar | `/speckit-clarify` | sección *Clarifications* en `spec.md` |
| Planear | `/speckit-plan` | `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |
| Tareas | `/speckit-tasks` | `tasks.md` |
| Analizar | `/speckit-analyze` | reporte de consistencia (solo lectura) |
| Checklist | `/speckit-checklist` | checklists de calidad de requisitos |
| Implementar | `/speckit-implement` | código — **solo con aprobación humana explícita** |

Extensión `git` (incluida en Spec-Kit) instalada: crea ramas `feature/NNN-slug`
(`.specify/extensions/git/git-config.yml`). El auto-commit está desactivado.

### Reglas de uso de especificaciones

1. **Ninguna línea de código de producción sin una spec aprobada** (`spec.md` + `plan.md` + `tasks.md`
   revisados y aprobados por un humano, y `/speckit-analyze` sin hallazgos CRITICAL).
2. Implementa **solo** las tareas de `tasks.md` de la feature activa. Si detectas que falta algo, **detente**
   y propón actualizar la spec; no lo agregues "de paso".
3. No mezcles archivos internos de `.specify/` con documentos funcionales de `specs/`.
4. Las decisiones marcadas como **PENDIENTE** en specs o en `docs/business/decisions-register.md`
   no deben implementarse como si estuvieran aprobadas. Si una tarea depende de una decisión pendiente, se bloquea.
5. El roadmap y las dependencias entre features están en `docs/business/capability-map.md`.
   No inicies una feature cuyas dependencias no estén al menos en estado *Planned/Approved*.

## 4. Restricciones de seguridad financiera (no negociables)

- **Nunca** uses `number`/`double`/`float` para dinero. TypeScript: enteros en unidades mínimas (`bigint`) o
  librería decimal aprobada; Dart: `Decimal`/enteros en centavos. PostgreSQL: `BIGINT` (unidades mínimas) o `NUMERIC`.
- **Nunca** hagas `UPDATE`/`DELETE` sobre asientos del ledger ni sobre operaciones financieras confirmadas.
  Las correcciones son **reversos** (nuevos asientos que referencian al original).
- Toda operación financiera que cruce la red lleva una **clave de idempotencia** generada por el cliente.
- Toda consulta a datos de negocio debe ejecutarse **dentro del contexto de un tenant** (RLS activo).
  Nunca uses el rol de base de datos propietario/superusuario desde la aplicación.
- Los cálculos en Flutter son **proyecciones/simulaciones**; el backend es la única autoridad contable.
- Los recibos offline son **provisionales** y deben distinguirse visualmente de los confirmados.
- No inventes requisitos regulatorios. Lo regulatorio no validado se marca como `PENDIENTE-LEGAL`.

## 5. Políticas para modificar el código

- Ramas: `feature/NNN-slug` (Spec-Kit), `fix/<slug>`, `chore/<slug>`, `docs/<slug>`. Nunca trabajes directo en `main`.
- Commits: **Conventional Commits** con scope de componente: `feat(backend): …`, `fix(collector): …`,
  `docs(adr): …`, `chore(ci): …`. Scopes válidos en `docs/architecture/monorepo-strategy.md`.
- No hagas `git push`, no crees repos remotos, no cambies políticas de GitHub sin aprobación explícita.
- No crees repositorios Git anidados, submódulos ni instalaciones adicionales de `.specify/`.
- No agregues dependencias nuevas sin justificarlas en `plan.md`/`research.md` de la feature.
- Nunca versiones secretos. Solo `.env.example` con valores ficticios.
- Toda migración de base de datos es aditiva/compatible hacia atrás (expand → migrate → contract).
- Cambios a `contracts/openapi/` requieren revisar compatibilidad (no romper clientes móviles desplegados).
- Antes de proponer un PR: pruebas locales verdes, lint, y checklist de la Constitución.

## 6. Comandos útiles

```bash
specify check                      # Verifica herramientas
specify integration status         # Verifica integración Claude
specify extension list             # Extensiones instaladas (git)
.specify/scripts/bash/check-prerequisites.sh --json   # Estado de la feature activa
```

## 7. Mapa de documentación

- `docs/architecture/` — visión, C4, backend, Flutter, datos, contratos, offline, despliegue, monorepo.
- `docs/business/` — dominio financiero, motores (préstamo, ahorro, garantía), prelación, liquidación,
  mapa de capacidades y registro de decisiones.
- `docs/security/` — aislamiento multi-tenant, autenticación, threat model, privacidad, matriz regulatoria.
- `docs/quality/` — estrategia de pruebas, invariantes financieras, resiliencia.
- `docs/decisions/` — ADRs.
- `docs/process/` — Git, PRs, releases, uso de Spec-Kit.
