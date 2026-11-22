# Kuota Platform

Plataforma SaaS multi-tenant para empresas de **préstamos, microcréditos, ahorro programado y cobranza en campo**.

> **Estado:** fundación arquitectónica y metodológica. No hay código de aplicación todavía.
> Todo desarrollo sigue Spec-Driven Development con [GitHub Spec-Kit](https://github.com/github/spec-kit) v1.4.3.

## Ecosistema

| Aplicación | Tecnología | Ruta (cuando exista) |
|---|---|---|
| **Kuota Core** — backend y motor financiero | Node.js LTS · TypeScript · NestJS · PostgreSQL | `backend/` |
| **Kuota Admin** — panel administrativo | Flutter Web | `flutter/apps/admin_web/` |
| **Kuota Collector** — app de cobradores (offline-first) | Flutter · Drift/SQLite | `flutter/apps/collector_mobile/` |
| **Kuota Client** — app de clientes | Flutter | `flutter/apps/client_mobile/` |

Contratos REST: `contracts/openapi/` (fuente de verdad; cliente Dart generado).

## Estructura actual

```text
kuota-platform/
├── .claude/skills/        # Skills de Spec-Kit para Claude Code (generado por specify)
├── .specify/              # Configuración interna de Spec-Kit (memory/, templates/, scripts/, extensions/)
├── specs/                 # Especificaciones por capacidad funcional (NNN-slug/)
├── docs/                  # Arquitectura, negocio, seguridad, calidad, ADRs y procesos
├── CLAUDE.md              # Reglas operativas para Claude Code
└── README.md
```

`backend/`, `flutter/`, `contracts/`, `infra/` y `.github/workflows/` se crean cuando una tarea aprobada los requiera
(ver `specs/001-platform-foundation/tasks.md`).

## Cómo empezar

1. Lee la Constitución: [`.specify/memory/constitution.md`](.specify/memory/constitution.md).
2. Lee la visión general: [`docs/architecture/overview.md`](docs/architecture/overview.md).
3. Revisa el roadmap: [`docs/business/capability-map.md`](docs/business/capability-map.md).
4. Revisa decisiones pendientes: [`docs/business/decisions-register.md`](docs/business/decisions-register.md).
5. Flujo de trabajo: [`docs/process/spec-kit-workflow.md`](docs/process/spec-kit-workflow.md)
   y [`docs/process/git-workflow.md`](docs/process/git-workflow.md).

## Requisitos de entorno

| Herramienta | Requerida para | Versión mínima |
|---|---|---|
| git | todo | 2.40+ |
| Python + uv | Spec-Kit CLI | Python 3.11+, uv reciente |
| specify-cli | SDD | **1.4.3** (fijada) |
| Claude Code | SDD | actual |
| Node.js | backend | 26 LTS (nvm, `.nvmrc`) |
| pnpm | backend (workspaces) | 12.x vía `corepack` (fijado en `packageManager`) |
| Flutter / Dart | apps | Flutter 3.50.x (Dart 3.14) fijado con **FVM** (`.fvmrc`); mínimo Dart ≥ 3.6 |
| FVM | apps | ≥ 3.2 (instalado 3.2.1; 4.3.x disponible) — D-ENV-01 |
| Docker | entorno local | 24+ |

Detalle y diagnóstico: [`docs/process/environment.md`](docs/process/environment.md).
