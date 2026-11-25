# Informe de validación de 001-platform-foundation (T091)

**Estado de T091: CERRADA (2026-11-25).** SC-001 aprobado por el mantenedor único `@aguila486` sobre la evidencia de §1c, sin reproducirla, con cachés locales y sin que sea una revisión independiente (`approvals.md`, Aprobación 14). Sigue abierta la observación FR-005 sobre `backend/eslint-rules/`. Este informe recoge la evidencia que Claude Code pudo obtener en local. T091 exige además la
**validación por el mantenedor** (SC-001) y la medición del arranque en un clon limpio siguiendo solo la guía, que no
están hechas.

## 1. Ejecución en un clon limpio (Claude Code, 2026-11-23)

Clon local (`git clone --no-hardlinks` del repositorio, commit `163c529`) en un directorio temporal, sin red para las
dependencias (store local de pnpm). MacBook arm64, 8 núcleos, Docker Desktop 4.43.2 (8 GB para la VM).

| Paso de la guía | Comando | Resultado | Tiempo |
|---|---|---|---|
| Clonar | `git clone` (local) | correcto | < 1 s |
| Herramientas | `make doctor` | "entorno listo" (Docker, Compose, Node, pnpm, FVM, Flutter 3.50.1) | 4 s |
| Dependencias | `pnpm install --frozen-lockfile --offline` | correcto | 3 s (descargas ya en caché: no representa una máquina nueva) |
| Job `general` | `scripts/ci/run-local.sh general` | 5/5 PASS | 5 s |

**FR-005:**

- `find . -type d -empty -not -path './.git/*'` en el clon: **sin resultados**.
- Carpetas de primer y segundo nivel: todas figuran en la estructura de `plan.md` (`backend/{prisma,scripts,src,test}`,
  `contracts/{fixtures,openapi}`, `flutter/{apps,config,packages,tool}`, `infra/docker`, `scripts/{ci,contracts,dev}`,
  `.github/workflows`) o ya existían antes de 001 (`docs/*`, `specs/`, y las de herramientas `.claude/`, `.specify/`).

## 1b. Segunda ejecución en un clon limpio (Claude Code, 2026-11-25)

- **Origen:** clon local `git clone --no-hardlinks` de `feature/001-platform-foundation-baseline` en `a5caf9b` (L3 aplicada),
  en un directorio temporal y sin remoto.
- **Red:** sin red. Dependencias con `--offline` desde las cachés locales; las imágenes de contenedor ya estaban
  presentes.
- **Máquina:** la misma de §1.
- **Advertencia:** los tiempos **no representan una máquina nueva** (cachés llenas).

| Paso de la guía | Comando | Resultado | Tiempo |
|---|---|---|---|
| Clonar | `git clone` (local) | correcto | 1 s |
| FR-005, directorios vacíos | `find . -type d -empty -not -path './.git/*'` (antes de instalar) | **sin resultados** | < 1 s |
| Herramientas | `make doctor` | **entorno listo**, con el Node del proyecto (`.nvmrc`), como indica §0. Un primer intento sin `nvm use` falló como debía (Node 24 y sin pnpm): fue un error de invocación, no del proyecto | 3 s |
| Dependencias | `pnpm install --frozen-lockfile --offline` · `fvm flutter pub get --offline` | correcto · correcto | 2 s · 2 s |
| Pruebas de todo el monorepo (§2) | `scripts/dev/test-all.sh` | **verde**: backend (tipos, lint, formato, 758/758 pruebas, cobertura 98,21 % / 96,54 %), contratos (lint y reglas) y Flutter (análisis y pruebas). **oasdiff OMITIDO**, sin baseline. Un primer intento sin el Node del proyecto falló en los pasos con pnpm; mismo error de invocación | **304 s** |

**FR-005, carpetas de primer y segundo nivel:**

- Coinciden con la lista de §1, más **`backend/eslint-rules/`**.
- Esa carpeta la creó T104 (opción C de la Aprobación 12) y está documentada en `research.md`, pero **no figura en la
  estructura de `plan.md`**.
- Observación: alinear `plan.md` en su próxima enmienda, con nuevo hash (relacionado con I2/I5 del análisis del
  2026-11-25). No se modifica `plan.md` aquí.

**Sigue sin ejecutarse:**

- `scripts/dev/up.sh` (arranque ≤ 15 min);
- por tanto, «arranque + pruebas ≤ 30 min»;
- la validación del mantenedor.

Motivos en §2.

## 1c. Ejecución completa de la guía en un entorno Docker aislado (Claude Code, 2026-11-25)

**Autorización**: el responsable permitió crear y eliminar solo recursos Docker temporales de esta prueba («KUOTA —
Finalizar T091 de 001 con entorno Docker aislado»).

**Condiciones de la prueba:**

- **Origen:** clon local temporal sin red de `feature/001-platform-foundation-baseline` en `8c36c46`. Se eliminó al
  terminar.
- **Entorno:** Node del proyecto (`use_project_node`, equivalente a `nvm use`: Node 26.13.1 y pnpm 12.21.0).
- **Cachés:** instalación **con cachés locales**, imagen de PostgreSQL ya presente y dependencias `--offline`.
  **No es una máquina completamente limpia.** Las descargas no se midieron porque no hubo.

**Aislamiento:**

- Proyecto de Compose único `kuota-t091-20261125004128`, usando las variables que `up.sh` ya admite
  (`KUOTA_COMPOSE_PROJECT`, `KUOTA_ENV_FILE`, puertos). No se modificó ningún script.
- `.env` copiado de `.env.example` (valores ficticios) con puertos propios: PostgreSQL 55991, API 3091 y métricas 9491.

| Hito (cronómetro desde el clon terminado) | Comando | Resultado | Tiempo |
|---|---|---|---|
| FR-005 | `find . -type d -empty -not -path './.git/*'` | sin resultados | < 1 s |
| Herramientas | `make doctor` | entorno listo | 5 s |
| Dependencias (se miden aparte, SC-001) | `pnpm install --frozen-lockfile --offline` · `fvm flutter pub get --offline` | correcto | 4 s (con cachés) |
| **Arranque (SC-001 ≤ 15 min)** | `scripts/dev/up.sh` → `/health/ready` 200 | **listo** (17 s desde que se lanzó `up.sh`) | **26 s** |
| §1 de la guía | `curl` a `health/live`, `health/ready`, compatibilidad y métricas | live `{"status":"ok"}` · ready `up` · compatibilidad 200 · métricas con token (45 líneas de las series de FR-039) · sin token **401** · `/metrics` en el puerto de la API **404** | — |
| PostgreSQL | `pg_isready` dentro del contenedor temporal | accepting connections | — |
| Migraciones | `public._prisma_migrations` | `0001_foundation`, `0002_idempotency_maintenance`, `0003_platform_audit` terminadas (las de 001); preflight y `migrate deploy` correctos | — |
| US1-2 | `docker compose -p <temporal> stop postgres` | ready **503** (`database: down`), live **200** | — |
| **Arranque + pruebas (SC-001 ≤ 30 min)** | `scripts/dev/test-all.sh` | **verde**: backend 758/758 y cobertura, contratos, Flutter. oasdiff **OMITIDO** (sin baseline) | **368 s** (6 min 8 s) |

**Recursos Docker creados y eliminados**, todos con el prefijo del proyecto temporal:

| Recurso | Nombre | Eliminado con |
|---|---|---|
| Contenedor | `kuota-t091-20261125004128-postgres-1` | `docker compose -p … down` |
| Red | `kuota-t091-20261125004128_default` | `docker compose -p … down` |
| Volumen | `kuota-t091-20261125004128_kuota-pgdata` | `docker volume rm` por nombre explícito |

No se usó `down -v`, `prune`, ni ninguna acción sobre recursos ajenos.

**Comprobación de antes y después** (`docker ps -a`, `docker volume ls`, `docker network ls`):

- 0 diferencias en contenedores, volúmenes y redes.
- `kuota-postgres-1` sigue en ejecución y sano.
- `kuota_kuota-pgdata` y `kuota-g6check_kuota-pgdata` conservan su fecha de creación.

**SC-001: técnicamente cumplido en esta máquina con cachés; aprobado por el mantenedor el 2026-11-25 (Aprobación 14).**

## 2. No ejecutado en el clon y por qué

| Paso | Motivo |
|---|---|
| `make up` (arranque ≤ 15 min, SC-001) | Con el proyecto de Compose por defecto (`kuota`) usaría el volumen persistente `kuota_kuota-pgdata`, que está protegido; con otro proyecto crearía un volumen persistente nuevo que luego no se podría borrar sin autorización (`docker volume rm` prohibido). Debe hacerlo el mantenedor |
| Arranque + pruebas ≤ 30 min (SC-001) | Depende del arranque anterior y de una máquina sin cachés; las descargas se miden aparte |
| Validación por el mantenedor | SC-001 exige una persona distinta de quien implementó; con mantenedor único, el mantenedor valida lo implementado por Claude Code |

## 3. Evidencia local del repositorio de trabajo (no del clon)

Ejecutada con los mismos scripts que CI, en secuencia (los jobs pesados nunca en paralelo):

| Control | Resultado (2026-11-23) |
|---|---|
| `run-local.sh general` | 5/5 PASS |
| `run-local.sh contracts` | 5 PASS + oasdiff contra `main` **OMITIDO** (sin baseline, T049) |
| `run-local.sh flutter` | 14/14 PASS (124 pruebas, VM y Chrome; Web release y 2 APK) |
| `run-local.sh backend` | 18/18 PASS, 687/687 pruebas en 50 archivos (segunda ejecución; la primera falló por un timeout de Testcontainers, ver `research.md`) |
| `prove-gates.sh` (T087) | 6/6 gates probados: pasan con el código limpio y fallan con su defecto de referencia |
| Duración de CI solo documentación (T088) | 4 s en local (`quickstart.md` §8) |

## 4. Pendientes registrados

- **US3-8 (asignación automática de revisores, FR-036): PENDIENTE.** Desde `a5caf9b`, `.github/CODEOWNERS` nombra al
  mantenedor único `@aguila486` en sus 15 reglas. La asignación solo puede verificarse abriendo un PR en GitHub, lo que
  requiere autorización remota.
- **SC-001:** pendiente de la ejecución y validación del mantenedor (sección 2).
- **SC-008 / checkpoint de US7:** PENDIENTE DE VALIDACIÓN iOS (Aprobación 9). iOS: DIFERIDO POR DECISIÓN
  ARQUITECTÓNICA — NO PROBADO.
- **T049 y T052:** requieren el contrato en `main` y la ejecución del workflow en GitHub.
