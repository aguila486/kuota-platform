## Resumen

<!-- Qué cambia y por qué (1–3 frases). -->

## Especificación y tareas

- Spec: `specs/NNN-slug/spec.md`
- Tareas cubiertas: `T0XX`, `T0YY`
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
- [ ] II. Riesgos de seguridad considerados; autorización aplicada en backend
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

## Evidencia de pruebas

<!-- Comandos ejecutados y resultado. -->

## Riesgos y rollback

<!-- Cómo revertir: revert, feature flag, redespliegue de tag anterior. -->
