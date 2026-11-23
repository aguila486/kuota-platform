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

Estado actual (2026-11-23): **fundación técnica (feature 001) implementada en local, sin funcionalidad de negocio**.
Existen y tienen código y pruebas:

| Carpeta | Contenido |
|---|---|
| `backend/` | Kuota Core: health, compatibilidad, métricas protegidas, contexto de tenant con RLS forzado, `Money`, idempotencia, auditoría append-only y el endpoint técnico `dev-probe` (solo local/testing) |
| `contracts/` | `openapi/` (contrato v1 y bundles) y `fixtures/money/` (fixtures compartidos backend/Dart) |
| `flutter/` | Workspace con `apps/{admin_web,collector_mobile,client_mobile}` (solo pantalla de inicio) y `packages/{api_client,app_shell,design_system,financial_domain,shared_core}` (`app_shell`: arranque compartido) |
| `infra/docker/` | Docker Compose de PostgreSQL local y scripts de aprovisionamiento de roles |
| `scripts/` | `ci/` (los mismos scripts que GitHub Actions), `dev/` (arranque y pruebas locales), `contracts/` (bundle, breaking, cliente Dart) |
| `specs/`, `docs/` | Especificaciones Spec-Kit y documentación |

No existen todavía autenticación (002), entidades de negocio ni sincronización offline. Las carpetas de la estructura
objetivo que faltan **no deben crearse vacías**; se crean cuando una tarea aprobada lo requiere.

## 2. Arquitectura seleccionada (resumen)

- **Monorepo único** (ADR-0001): un solo repositorio Git y un solo proyecto Spec-Kit en la raíz.
- **Backend**: Node.js LTS + TypeScript + NestJS como **monolito modular** (no microservicios) — ADR-0002.
  pnpm workspaces sin Nx/Turborepo en la etapa inicial.
- **Base de datos**: PostgreSQL con **Row-Level Security** por `tenant_id`; ORM Prisma 7 (aceptado con condiciones
  P1–P8: migraciones SQL con transacción explícita, contexto solo vía `withTenant`, sin `db push`/`migrate dev`) — ADR-0004.
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
make doctor                          # herramientas requeridas (scripts/dev/doctor.sh)
make up                              # PostgreSQL (Docker Compose) + migraciones + backend; espera /health/ready
make down                            # detiene backend y PostgreSQL (conserva los datos; nunca `docker compose down -v`)
make test                            # pruebas de todos los componentes
make test-affected BASE=main         # pruebas de los componentes afectados

scripts/ci/run-local.sh general|backend|contracts|flutter   # un job de CI, con los mismos scripts que GitHub Actions
scripts/ci/run-local.sh affected [base]                     # solo los jobs afectados respecto a base (por defecto main)
scripts/ci/prove-gates.sh            # demuestra que cada gate bloqueante falla con su defecto de referencia (T087)

pnpm --filter backend test:tenancy   # suite de aislamiento multi-tenant (acceso cruzado)
pnpm --filter backend test:contract  # respuestas reales contra el contrato OpenAPI
pnpm --filter backend test:idempotency   # idempotencia, 100 repeticiones (SC-006)
pnpm contracts:lint && pnpm contracts:test   # contrato: lint y detector de cambios incompatibles

cd flutter && fvm dart run melos run test --no-select   # pruebas del workspace Flutter (comandos móviles: flutter/README.md)

specify check                      # Verifica herramientas
specify integration status         # Verifica integración Claude
specify extension list             # Extensiones instaladas (git)
.specify/scripts/bash/check-prerequisites.sh --json   # Estado de la feature activa
```

Los jobs pesados (`backend` con Testcontainers y `flutter` con builds de Android) se ejecutan uno tras otro: Docker
Desktop tiene memoria limitada. La validación local de iOS está diferida (Aprobación 9 de 001): no descargar runtimes
de iOS ni ejecutar `flutter build ios`.

## 7. Mapa de documentación

- `docs/architecture/` — visión, C4, backend, Flutter, datos, contratos, offline, despliegue, monorepo.
- `docs/business/` — dominio financiero, motores (préstamo, ahorro, garantía), prelación, liquidación,
  mapa de capacidades y registro de decisiones.
- `docs/security/` — aislamiento multi-tenant, autenticación, threat model, privacidad, matriz regulatoria.
- `docs/quality/` — estrategia de pruebas, invariantes financieras, resiliencia.
- `docs/decisions/` — ADRs.
- `docs/process/` — Git, PRs, releases, uso de Spec-Kit.
