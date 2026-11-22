# Registro de enmiendas de la Constitución

Evidencia de gobernanza de `.specify/memory/constitution.md`. Cada enmienda conserva aquí su Informe de Impacto, que
se retira del encabezado de la Constitución al confirmarla (regla de `/speckit-constitution`). Versionado según la
sección *Gobernanza*: MAJOR = eliminar o redefinir un principio; MINOR = agregar principio o sección, o ampliar
materialmente; PATCH = aclaraciones de redacción.

| Versión | Fecha | Tipo | Cambio | Origen / aprobación | Commit (rama) |
|---|---|---|---|---|---|
| 1.0.0 | 2026-11-22 | Ratificación | 15 principios con criterios de verificación | Prompt maestro de inicialización | `3ea06ed` (`docs/foundation-governance`) |
| 1.0.1 | 2026-11-22 | PATCH | Ramas `hotfix/`, scopes `constitution`/`speckit`, etiqueta `contracts-vX.Y.Z` | Alineación con convenciones de Git | `257443c` (`docs/foundation-governance`) |
| 1.1.0 | 2026-11-22 | MINOR | Excepción de mantenedor único (1 aprobación humana + checklist + `/speckit-analyze` sin CRITICAL + CI verde) | Clarificación de 001 (respuesta del responsable: "Solo yo por ahora") | `bd3cfec` (`feature/001-platform-foundation`, junto con la spec); se incorpora a la línea de gobernanza en el commit de 1.2.0 |
| 1.2.0 | 2026-11-22 | MINOR | §II: procedimiento de excepciones de acceso y lista cerrada de categorías admisibles | Hallazgo A1 de `/speckit-analyze` sobre 001; aprobado por el responsable | Rama `docs/constitution-endpoint-access` |

## 1.2.0 — Informe de Impacto

- **Versión**: 1.1.0 → 1.2.0. Es MINOR y no PATCH porque añade un procedimiento normativo nuevo (requisitos obligatorios
  para toda excepción de acceso y una lista cerrada de categorías); la aprobación inicial pedía PATCH y se ajustó a la
  regla de versionado.
- **Principio modificado**: II. Seguridad por diseño (excepciones de acceso, categorías admisibles, verificación R/P).
- **Secciones añadidas o eliminadas**: ninguna.
- **Contenido**:
  - Toda excepción a autenticación o autorización se registra en la tabla *Endpoint Access* de la spec con
    justificación, entornos permitidos, clasificación de datos, controles compensatorios y pruebas de acceso
    permitido y denegado.
  - Categorías admisibles: liveness, readiness (sin detalles internos), compatibilidad de versión de apps, métricas
    (internas y protegidas; un puerto separado no es un control) y mecanismos técnicos de desarrollo y prueba (solo
    `local`/`testing`; un encabezado técnico no es autenticación). Ampliar la lista requiere enmienda.
  - Ningún endpoint con datos de tenant, datos personales u operaciones financieras puede ser excepción en
    `staging`/`production`.
- **Plantillas**: sin cambios requeridos. La plantilla de PR se actualiza con la feature 001, que aplica la regla.
- **Impacto en specs**: 001-platform-foundation añade *Endpoint Access* y FR-040. Pendiente para 002 y 012: el login y
  la verificación pública de recibos no están en la lista cerrada (hallazgo M1).
- **Por qué 1.1.0 viaja en este commit**: la enmienda 1.1.0 se confirmó en `bd3cfec`, dentro de la rama de la feature.
  Para que la rama de gobernanza tenga la Constitución completa, el commit de 1.2.0 parte de 1.0.1 e incluye ambos
  cambios. Mientras no se integre, `feature/001-platform-foundation` conserva 1.1.0 en su árbol.
- **Orden de integración** (sin push ni merge hasta aprobación del responsable):
  1. `docs/foundation-governance` → `main`.
  2. `docs/constitution-endpoint-access` → `main`.
  3. Integrar `main` (o esta rama) en `feature/001-platform-foundation` **antes** de `/speckit-implement`, resolviendo
     `.specify/memory/constitution.md` con la versión 1.2.0 de esta rama (es un superconjunto de 1.1.0).
  4. `feature/001-platform-foundation` → `main` mediante PR.
