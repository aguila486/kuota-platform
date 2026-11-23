# 002-identity-tenancy — Paquete documental en BORRADOR

> **BORRADOR (2026-11-23). No es una especificación aprobada ni autoriza implementación.** No existen tablas de negocio
> ni endpoints de autenticación. Ninguna decisión pendiente se da por aprobada.

| Documento | Contenido |
|---|---|
| `analisis-preliminar.md` | Primer análisis: alcance, decisiones bloqueantes y estructura |
| `adr-propuesta-d-arc-07.md` | Propuesta de ADR de propiedad de tablas (alternativas A, B y C; recomendación; tablas por módulo; contextos de ejecución) |
| `decisiones-pendientes.md` | Qué está aprobado y qué no; matriz D-AUTH-01/02/03; recuperación y revocación; decisiones legales y operativas |
| `spec-borrador.md` | Objetivo, historias, requisitos, C4, modelo de datos, roles y permisos, flujos, secretos, aislamiento, pruebas y riesgos |
| `roadmap-aplicaciones.md` | Fases verticales para Kuota Core, Admin Web, Collector y Client |

**Por qué vive en `docs/drafts/`:** `/speckit-specify` ejecuta un hook obligatorio (`speckit.git.feature`) que crea
una rama, y las ramas no están autorizadas. Crear `specs/002-…` a mano alteraría la numeración y la feature activa de
Spec-Kit. Cuando se autorice la rama, `/speckit-specify` usará `spec-borrador.md` como descripción y se seguirá el
procedimiento oficial (clarify → plan → tasks → analyze → aprobación humana → implement).
