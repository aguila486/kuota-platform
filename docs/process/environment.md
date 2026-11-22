# Diagnóstico de entorno y herramientas

Fecha de diagnóstico: **2026-11-22** · Equipo: macOS 26.1 (25B78), Apple Silicon `arm64`, shell `zsh`.

## 1. Resultado del diagnóstico (Fase 0)

| Herramienta | Comando | Versión detectada | Clasificación | Observación |
|---|---|---|---|---|
| git | `git --version` | 2.48.1 | ✅ Disponible | — |
| Python | `python3 --version` | 3.12.13 | ✅ Disponible | Cumple requisito de Spec-Kit (≥ 3.11) |
| uv | `uv --version` | 0.11.32 | ✅ Disponible | Gestor de la herramienta `specify` |
| specify-cli | `specify version` | **1.4.3** | ✅ Disponible | Instalado desde `git+https://github.com/github/spec-kit.git@v1.4.3` (ver §2) |
| Claude Code | `claude --version` | 2.1.330 | ✅ Disponible | `specify check` → "Claude Code (available)" |
| gh (GitHub CLI) | `gh --version` | 2.96.0 | ⚪ Opcional | No se usa para publicar sin aprobación |
| Node.js | `node --version` | 24.18.0 (nvm) | ✅ Disponible / fase futura | Node 24 es LTS; adecuado para backend |
| npm | `npm --version` | 11.16.0 | ✅ Disponible | — |
| corepack | `which corepack` | presente | ✅ Disponible | Permite activar pnpm sin instalador externo |
| pnpm | `pnpm --version` | — | ⚠️ No disponible · necesario en fases futuras | Activar con `corepack enable pnpm` al iniciar el scaffolding del backend (tarea de 001) |
| Flutter | `flutter --version` | 3.24.3 (stable) | ⚠️ **Disponible pero incompatible** | Incluye Dart 3.5.3; **pub workspaces requiere Dart ≥ 3.6**. Requiere actualizar Flutter antes de crear `flutter/` |
| Dart | `dart --version` | 3.5.3 | ⚠️ Disponible pero incompatible | Ídem |
| Docker | `docker --version` | 28.3.2 | ✅ Disponible / fase futura | Para Docker Compose local (PostgreSQL, Redis) |

### Decisiones sobre instalaciones

- **No se instaló ni actualizó nada globalmente** en esta fase. Spec-Kit ya estaba instalado con la versión fijada correcta.
- **pnpm**: no es necesario para la fase de especificación. Se activará con `corepack` (herramienta oficial de Node.js)
  cuando se ejecute la tarea de scaffolding del backend.
- **Flutter**: la actualización (`flutter upgrade`, canal stable) es una **acción pendiente de aprobación**, porque modifica
  una instalación global que hoy funciona y puede afectar otros proyectos del equipo. Alternativa: usar FVM por proyecto.
  Ver decisión `D-ENV-01` (aprobada 2026-11-22: FVM por proyecto).

## 2. Spec-Kit (Fase 2)

| Elemento | Valor verificado |
|---|---|
| Fuente | `https://github.com/github/spec-kit` (oficial) |
| Versión | `v1.4.3` fijada (`uv-receipt.toml`: `git = "https://github.com/github/spec-kit.git?rev=v1.4.3"`) |
| Comando de instalación | `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v1.4.3` |
| `specify self check` | `Up to date: 1.4.3` |
| Inicialización | `specify init --here --integration claude --script sh` (registrado en `.specify/init-options.json`) |
| `specify integration status` | `OK` · claude · 0 archivos gestionados modificados · 0 faltantes |
| Numeración de features | `sequential` |
| Extensiones | `git` v1.0.8 (incluida en el paquete oficial, instalada con `specify extension add git`, sin red) |

### Directorios generados

```text
.specify/
├── init-options.json, integration.json     # Configuración de la instalación
├── integrations/                           # Manifiestos con hash de archivos gestionados
├── memory/constitution.md                  # Constitución (artefacto del proyecto)
├── scripts/bash/                           # Scripts de soporte de los skills
├── templates/                              # Plantillas spec/plan/tasks/checklist/constitution
├── workflows/speckit/workflow.yml          # Workflow "Full SDD Cycle" con gates
├── extensions/git/git-config.yml           # Config de ramas (prefijo feature/)
└── extensions.yml                          # Hooks registrados por extensiones
.claude/skills/speckit-*/SKILL.md           # 14 skills (9 core + 5 git)
```

### Actualizar Spec-Kit

```bash
specify self check                      # ¿hay versión nueva?
specify self upgrade --dry-run          # previsualizar
# Para fijar una versión concreta (recomendado, reproducible):
uv tool install specify-cli --force --from git+https://github.com/github/spec-kit.git@vX.Y.Z
specify init --here --integration claude --script sh   # refresca archivos gestionados (preserva cambios locales en memory/)
specify integration status
```

Toda actualización de Spec-Kit se hace en una rama `chore/speckit-vX.Y.Z`, revisando el diff de `.specify/` y `.claude/skills/`.
