# ADR-0001: Estrategia de repositorio — monorepo único `kuota-platform`

- **Estado:** Aceptado (2026-11-22, responsable del proyecto)
- **Fecha:** 2026-11-22
- **Decisores:** Responsable técnico (arquitectura), responsable de producto
- **Relacionado:** Constitución §Restricciones de stack, ADR-0002, ADR-0003, `docs/architecture/monorepo-strategy.md`

## Contexto

Kuota consta de un backend (Kuota Core, autoridad contable), tres aplicaciones Flutter (Admin, Collector, Client),
contratos OpenAPI e infraestructura. Las capacidades financieras atraviesan varias piezas a la vez: una regla de
pago afecta al contrato, al motor del backend, al simulador de `financial_domain` y a la UI del cobrador.
El equipo inicial es pequeño, se trabaja con Spec-Driven Development (Spec-Kit 1.4.3) y Claude Code, y se necesita
que una especificación sea la fuente de verdad para todos los componentes afectados.

## Opciones consideradas

- **A. Monorepo único**: un repositorio con `backend/`, `flutter/`, `contracts/`, `infra/`, `docs/`, `specs/`.
- **B. Múltiples repositorios**: `kuota-backend`, `kuota-admin`, `kuota-collector`, `kuota-client`, `kuota-infrastructure`.
- **C. Varios monorepos especializados**: `kuota-core` (backend + contratos), `kuota-flutter` (apps + paquetes), `kuota-infrastructure`.

### Evaluación

| Criterio | A. Monorepo único | B. Multi-repo | C. Monorepos especializados |
|---|---|---|---|
| Mantenimiento | ✅ Una configuración de lint, CI, plantillas y docs | ❌ 5× configuración, deriva entre repos | ⚠️ 3× configuración |
| Desarrollo paralelo | ✅ Ramas por feature; path filters evitan interferencia | ✅ Aislamiento natural | ✅ Bueno |
| Reutilización | ✅ Paquetes Dart compartidos y contrato en el mismo árbol | ❌ Requiere publicar paquetes privados y versionarlos | ⚠️ Compartido dentro de Flutter, contrato cruza repos |
| CI/CD | ⚠️ Requiere path filters para no ejecutar todo | ✅ Pipelines simples por repo | ⚠️ Intermedio |
| Versionamiento | ⚠️ Tags por componente (`backend-vX.Y.Z`) | ✅ Natural por repo | ⚠️ Tags por app dentro de `kuota-flutter` |
| Cambios atómicos (contrato + backend + app) | ✅ Un PR | ❌ PRs coordinados en 3+ repos | ❌ 2 PRs coordinados |
| Control de acceso | ⚠️ Granularidad por CODEOWNERS/revisión, no por lectura | ✅ Permisos por repo | ⚠️ Por grupo de repos |
| Escalabilidad organizacional | ⚠️ Adecuado hasta ~3–4 equipos; luego requiere tooling | ✅ Escala con muchos equipos | ✅ Buena |
| Complejidad operativa | ✅ Baja al inicio | ❌ Alta (versiones cruzadas, releases coordinados) | ⚠️ Media |
| Claude Code / Spec-Kit | ✅ Un `.specify/`, una Constitución, el agente ve todo el contexto | ❌ Una Constitución por repo, specs fragmentadas, el agente no ve el contrato real | ⚠️ Specs cross-repo duplicadas |

## Decisión

**Alternativa A: monorepo único `kuota-platform`**, con un **único proyecto Spec-Kit en la raíz**
(`.specify/`, `specs/`, `.claude/skills/`) y una Constitución general.

Razones principales:
1. Las features financieras son transversales; un solo PR puede cambiar contrato, backend y apps de forma atómica
   y revisable contra una sola `spec.md`.
2. Spec-Kit y Claude Code funcionan mejor con todo el contexto disponible: el agente puede leer el contrato
   OpenAPI real al planear la app y la Constitución aplica a todo sin duplicarse.
3. El equipo es pequeño; la sobrecarga de coordinar 3–5 repositorios no se justifica.

No se crean repositorios Git anidados, submódulos ni instalaciones adicionales de `.specify/`.

Cada aplicación y el backend se construyen, prueban y publican de forma independiente: la CI ejecuta solo los
componentes afectados (filtros por ruta, `specs/001-platform-foundation/research.md` §R-17) y cada componente tiene su
propia etiqueta de release.

## Consecuencias

- **Positivas:** una sola fuente de verdad para specs, contratos y Constitución; refactors y cambios de contrato atómicos;
  CI y tooling compartidos.
- **Negativas:** el control de acceso de lectura es todo-o-nada; CI debe usar *path filters* para ejecutar solo lo afectado;
  releases requieren etiquetas por componente.
- **Mitigaciones:** `CODEOWNERS` por directorio, path filters en GitHub Actions, tags `backend-vX.Y.Z`, `admin-vX.Y.Z`,
  `collector-vX.Y.Z`, `client-vX.Y.Z` (ver `docs/process/release-strategy.md`).

## Evolución: múltiples proyectos Spec-Kit dentro del monorepo

Capacidades oficiales verificadas en Spec-Kit **1.4.3** (sin implementar ahora):

- `SPECIFY_INIT_DIR`: variable que apunta al directorio que contiene un `.specify/` concreto, para ejecutar comandos de
  Spec-Kit contra un proyecto miembro desde la raíz del monorepo (`.specify/scripts/bash/common.sh`).
- `branch_template` de la extensión `git` con el token `{app}` (derivado del nombre del directorio de inicialización), p. ej.
  `{author}/{app}/{number}-{slug}` → `jdoe/web/008-guided-tour` para un proyecto en `apps/web/.specify/`.

**Criterios para migrar** a constituciones/proyectos `.specify/` por aplicación (cualquiera de ellos, mediante nuevo ADR):
- Más de 3 equipos autónomos con backlog propio por aplicación.
- Ciclos de release divergentes que generen conflictos frecuentes de numeración o de specs entre apps.
- Requisitos de control de acceso o cumplimiento distintos por aplicación (p. ej. auditoría separada del Core).
- Una aplicación con principios propios que contradigan o extiendan materialmente la Constitución general.

Aun en ese caso, la Constitución raíz seguiría siendo la base y las constituciones por app solo podrían **agregar**
restricciones.

## Validación

- `specify integration status` = OK en la raíz.
- CI con path filters ejecuta solo los jobs del componente afectado (medido en la feature 001).

## Revisión

Reevaluar si: tiempo de CI en PR > 10 min de forma sostenida, > 4 equipos, o necesidad de restringir lectura de código.
