## Resumen

<!-- Qué cambia y por qué (1–3 frases). -->

## Especificación y tareas

- Spec: `specs/NNN-slug/spec.md`
- **Tareas cubiertas (obligatorio):** `T###`, `T###`. Todo PR referencia al menos una tarea aprobada de
  `specs/NNN-slug/tasks.md` (Constitución I). Sin tarea no se revisa.
- Decisiones `D-*` relacionadas (deben estar **aprobadas** si se implementan):

## Componentes afectados

- [ ] backend
- [ ] contracts (OpenAPI)
- [ ] admin_web
- [ ] collector_mobile
- [ ] client_mobile
- [ ] flutter/packages
- [ ] infra / ci
- [ ] specs / docs / ADR / Constitución

## Checklist de la Constitución

- [ ] I. Solo implementa tareas aprobadas de `tasks.md`; nada fuera de alcance
- [ ] II. Riesgos de seguridad considerados; autorización aplicada en backend en cada endpoint
- [ ] II. **Acceso a endpoints:** cada endpoint nuevo o modificado figura en la tabla *Endpoint Access* de la spec con su permiso requerido. Toda excepción (sin autenticación o sin autorización):
  - pertenece a una categoría admisible (liveness, readiness, compatibilidad, métricas protegidas, mecanismo técnico solo en `local`/`testing`);
  - tiene justificación, entornos, clasificación de datos, controles compensatorios y pruebas de acceso permitido y denegado;
  - en el contrato, `security: []` solo aparece en endpoints públicos registrados;
  - ningún endpoint que lea o modifique datos de tenant, datos personales u operaciones financieras es excepción en `staging`/`production`.
- [ ] II. Sin dependencias con vulnerabilidades altas/críticas (gate `osv-scanner`)
- [ ] III. Tablas nuevas con `tenant_id` + RLS forzado; pruebas de acceso cruzado
- [ ] IV. Sin punto flotante para dinero; redondeo según spec; casos numéricos de referencia
- [ ] V. Ledger sin `UPDATE`/`DELETE`; correcciones por reverso
- [ ] VI. Operaciones financieras con clave de idempotencia y prueba de reintento
- [ ] VII. Eventos auditables registrados
- [ ] VIII/IX. Dominio sin dependencias de framework; sin acceso a tablas de otros módulos
- [ ] X. Pruebas escritas y verdes; cobertura dentro de umbral
- [ ] XI. Comportamiento offline / estados de sincronización (si aplica)
- [ ] XII. Contrato OpenAPI actualizado antes del código; cliente regenerado
- [ ] XIII. Logs estructurados sin PII
- [ ] XIV. Migración compatible (expand/contract); sin breaking changes no declarados
- [ ] XV. Datos personales minimizados y justificados en la spec
- [ ] Sin secretos en el diff

## Áreas financieras sensibles (requieren 2 aprobaciones)

- [ ] Este PR toca ledger, motores financieros, autenticación, RLS/tenancy, migraciones o la Constitución
- [ ] **Mantenedor único** (Constitución v1.2.0, mientras CODEOWNERS tenga un solo mantenedor): en esas áreas el PR
      requiere 1 aprobación humana + este checklist completo + `/speckit-analyze` sin hallazgos CRITICAL + CI verde
      (`CI: resultado`). La regla de 2 aprobaciones se activa al registrarse un segundo mantenedor en CODEOWNERS.

## Evidencia de pruebas

<!-- Comandos ejecutados y resultado. Reproducir CI en local: scripts/ci/run-local.sh affected main -->
<!-- Un job OMITIDO o PENDIENTE no es una aprobación: indícalo aquí. -->

## Riesgos y rollback

<!-- Cómo revertir: revert, feature flag, redespliegue de tag anterior. -->
