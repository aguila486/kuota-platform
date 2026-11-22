# Constitución de Kuota

Documento rector de la plataforma Kuota (`kuota-platform`). Aplica a todo el código, contrato, migración,
infraestructura, documento y especificación del monorepo, y a toda persona o agente de IA que contribuya.
Las palabras **DEBE / NO DEBE / DEBERÍA** se interpretan con el sentido de RFC 2119 (MUST / MUST NOT / SHOULD).
Cada principio incluye su **Verificación**: criterios comprobables mediante revisión (R) y mediante pruebas o CI (P).

## Core Principles

### I. Spec-Driven Development (NO NEGOCIABLE)

- Ningún código de producción, migración, contrato o pipeline se escribe sin una feature en `specs/NNN-slug/`
  con `spec.md`, `plan.md` y `tasks.md` **aprobados por un humano**.
- La implementación DEBE limitarse a las tareas de `tasks.md`. Trabajo descubierto fuera del alcance se registra
  como cambio de especificación, no se implementa "de paso".
- `/speckit-implement` NO DEBE ejecutarse sin aprobación humana explícita registrada (comentario de aprobación en el PR
  de especificación o mensaje explícito del responsable).
- Una regla marcada **PENDIENTE** (negocio, financiera, legal) NO DEBE implementarse como aprobada; las tareas que
  dependan de ella quedan bloqueadas.
- `/speckit-analyze` DEBE ejecutarse antes de implementar; hallazgos CRITICAL bloquean la implementación.

**Verificación.** (R) Todo PR de código referencia `specs/NNN-*/tasks.md` e IDs de tarea `T###`; el revisor rechaza
cambios sin tarea asociada. (P) CI valida que la rama sigue el patrón `feature/NNN-*` o `fix/*` y que el directorio
`specs/NNN-*` existe para ramas `feature/`.

**Razón.** En un sistema financiero, el costo de una regla implementada por suposición es dinero mal contabilizado.

### II. Seguridad por diseño

- Cada spec DEBE incluir una sección de riesgos de seguridad (actores, activos, amenazas) y sus mitigaciones.
- Autenticación y autorización DEBEN aplicarse en el backend en cada endpoint; las apps nunca son fuente de autorización.
- **Excepciones de acceso.** Un endpoint sin autenticación o sin autorización solo se admite como excepción. Cada
  excepción DEBE registrarse en la tabla *Endpoint Access* de la spec que la introduce, con:
  1. justificación explícita;
  2. entornos permitidos;
  3. clasificación de los datos expuestos;
  4. controles de seguridad compensatorios;
  5. pruebas que verifican el acceso permitido y el denegado.
- Categorías admisibles (lista cerrada; ampliarla requiere enmienda):
  - *Liveness*: puede ser público si responde solo disponibilidad mínima, sin detalles internos.
  - *Readiness*: puede evaluar dependencias, pero NO DEBE divulgar detalles internos (hosts, versiones, mensajes de
    error, topología); si los incluyera, DEBE ser interno o estar protegido.
  - *Compatibilidad de versión de apps*: puede ser público si su respuesta no expone información interna sensible.
  - *Métricas*: DEBEN ser internas y protegidas mediante restricción de red, autenticación del recolector o un control
    equivalente. Un puerto separado NO constituye por sí mismo un control de seguridad.
  - *Mecanismos técnicos de desarrollo y prueba*: solo en entornos `local`/`testing`, deshabilitados fuera de ellos
    mediante controles verificables por prueba. Un encabezado técnico arbitrario NO es autenticación.
- Ningún endpoint que lea o modifique datos de tenant, datos personales u operaciones financieras puede ser una
  excepción en `staging` o `production`. Las excepciones NO DEBEN usarse para que funcionalidades de negocio omitan
  autenticación.
- Principio de mínimo privilegio para roles de aplicación, cuentas de base de datos, tokens y personal.
- Entradas externas DEBEN validarse contra el contrato (esquema) antes de llegar al dominio.
- Dependencias con vulnerabilidades críticas/altas conocidas NO DEBEN fusionarse a `main`.

**Verificación.** (R) Checklist de seguridad en la plantilla de PR; endpoints nuevos declaran permiso requerido en la
tabla *Endpoint Access*; toda excepción tiene sus cinco elementos y pertenece a una categoría admisible; en el contrato,
`security: []` solo aparece en endpoints públicos registrados como excepción.
(P) Escaneo de dependencias y de secretos en CI (bloqueante); pruebas de autorización negativas (401/403/404) por
endpoint; por cada excepción, pruebas de acceso permitido y denegado (incluida la ausencia del mecanismo técnico en
configuración de `staging`/`production`).

### III. Aislamiento multi-tenant (NO NEGOCIABLE)

- Todo dato de negocio pertenece a exactamente un tenant y DEBE tener `tenant_id NOT NULL`.
- PostgreSQL Row-Level Security DEBE estar habilitado **y forzado** (`FORCE ROW LEVEL SECURITY`) en toda tabla con datos
  de tenant; la aplicación se conecta con un rol sin `BYPASSRLS` y que no es propietario de las tablas.
- El backend DEBE fijar el contexto de tenant por transacción a partir de la identidad autenticada, nunca a partir de
  parámetros enviados por el cliente.
- Una misma persona puede ser cliente de varios tenants: su identidad de autenticación es global, pero sus datos de cliente,
  préstamos, ahorro y documentos DEBEN existir por tenant y NO DEBEN ser visibles entre tenants.
- Operaciones de plataforma (cross-tenant) DEBEN usar un rol y módulo separados, auditados y fuera de la API de tenants.

**Verificación.** (P) Suite de pruebas de acceso cruzado obligatoria: para cada recurso, un usuario del tenant A recibe
404 al acceder a IDs del tenant B; prueba de base de datos que confirma que una consulta sin contexto de tenant devuelve
0 filas. (P) Verificación automática en CI de que toda tabla con `tenant_id` tiene RLS habilitado y forzado.
(R) Revisión de toda migración que cree tablas.

### IV. Precisión financiera (NO NEGOCIABLE)

- El dinero NO DEBE representarse ni calcularse con punto flotante binario (`number`, `double`, `float`, `real`).
- Montos persistidos: entero en unidades mínimas de la moneda (`BIGINT`) más código de moneda ISO 4217, o `NUMERIC` con
  escala explícita cuando el diseño aprobado lo justifique (tasas, factores).
- Cálculos intermedios DEBEN usar aritmética decimal con precisión y **modo de redondeo explícitos**; cada motor documenta
  en su spec dónde se redondea, a qué escala y con qué modo.
- Cada regla financiera DEBE tener casos numéricos de referencia (entradas → salidas exactas) aprobados por negocio.
- Las tasas DEBEN almacenarse con su base explícita (por periodo, mensual, anual, total) y nunca inferirse.

**Verificación.** (P) Regla de lint/CI que rechaza tipos flotantes en módulos y DTOs financieros; pruebas *golden* con los
casos numéricos de referencia; pruebas de propiedad (p. ej. suma de cuotas = principal + intereses). (R) Revisión de cada
fórmula contra la spec.

### V. Inmutabilidad del ledger (NO NEGOCIABLE)

- El ledger es de **partida doble**: cada asiento tiene ≥ 2 movimientos y la suma de débitos = suma de créditos por moneda.
- Los asientos y movimientos son **append-only**: NO DEBEN modificarse ni eliminarse (sin `UPDATE`/`DELETE`).
- Toda corrección se hace con un **asiento de reverso** que referencia al original, más un asiento correcto si aplica.
- Los saldos operativos (préstamo, ahorro, caja) son proyecciones derivadas del ledger y DEBEN poder reconstruirse desde él.

**Verificación.** (P) Permisos de base de datos/trigger que impiden `UPDATE`/`DELETE` sobre tablas del ledger, con prueba
que lo confirma; invariante de balance verificado por prueba y por job de reconciliación; prueba de reconstrucción de saldos.
(R) Ninguna migración altera filas históricas del ledger.

### VI. Idempotencia

- Toda operación que cree o modifique estado financiero DEBE aceptar una **clave de idempotencia** generada por el
  originador (app o integración), única por tenant.
- Repetir una solicitud con la misma clave y el mismo contenido DEBE devolver el mismo resultado sin efectos duplicados;
  con contenido distinto DEBE rechazarse con error explícito.
- Los consumidores de eventos y jobs DEBEN ser idempotentes.

**Verificación.** (P) Pruebas que envían la misma operación N veces (secuencial y concurrente) y verifican un único efecto
contable; restricción `UNIQUE (tenant_id, idempotency_key)` en base de datos.

### VII. Auditoría

- Toda acción que cambie estado de negocio, permisos o configuración financiera DEBE registrar: actor, rol, tenant,
  acción, entidad, valores relevantes antes/después, fecha-hora del servidor, fecha-hora del dispositivo (si aplica),
  dispositivo/origen y correlation id.
- La bitácora de auditoría es append-only y no editable por usuarios de tenant.

**Verificación.** (P) Pruebas de integración que verifican el registro de auditoría para cada comando de escritura.
(R) Los specs listan los eventos auditables.

### VIII. Clean Architecture

- Las reglas de dominio (motores financieros, políticas) DEBEN vivir en capas sin dependencias de framework, ORM, HTTP ni UI.
- Dependencias apuntan hacia adentro: infraestructura → aplicación → dominio.
- Los motores de cálculo DEBEN ser funciones/servicios puros y deterministas (reloj y calendario inyectados).

**Verificación.** (P) Reglas de lint de dependencias (p. ej. `dependency-cruiser` en backend, `import_lint`/análisis en
Dart) que fallan si `domain/` importa NestJS, Prisma, Flutter o HTTP. (R) Revisión de estructura de carpetas por módulo.

### IX. Modularidad

- Kuota Core es un **monolito modular**: módulos con límites explícitos que se comunican vía interfaces públicas o eventos
  internos; NO DEBEN acceder a tablas de otro módulo directamente.
- No se crean microservicios ni despliegues separados sin un ADR aprobado que justifique la necesidad con métricas.
- El código compartido entre apps Flutter vive en `flutter/packages/`; NO DEBE duplicarse entre apps.

**Verificación.** (P) Reglas de dependencias entre módulos en CI. (R) Todo nuevo servicio desplegable requiere ADR.

### X. Test-Driven Validation

- Las pruebas de una regla DEBEN escribirse antes o junto con su implementación y fallar antes de la implementación.
- Los motores financieros DEBEN tener: pruebas unitarias con casos numéricos de referencia, pruebas de propiedades e
  invariantes, y pruebas de borde (redondeo, pagos parciales, fechas límite, reversos).
- Cobertura mínima en dominio financiero: **90 % de líneas y ramas**; resto del backend y paquetes compartidos: 80 %.
- Ningún PR se fusiona con pruebas fallidas u omitidas sin issue y aprobación explícita.

**Verificación.** (P) Umbrales de cobertura configurados como bloqueantes en CI; tareas de prueba preceden a tareas de
implementación en `tasks.md`.

### XI. Offline Resilience

- Kuota Collector DEBE operar sin conectividad al menos **72 horas** para las capacidades definidas como offline.
- Cada operación local DEBE tener identificador único (UUID generado en el dispositivo), clave de idempotencia y un estado
  explícito de sincronización; los estados válidos se definen en la spec de sincronización.
- El servidor es autoritativo: una operación local no es definitiva hasta ser **confirmada**; rechazos y conflictos se
  muestran al usuario y se resuelven por flujo explícito, nunca se descartan en silencio.
- Los datos locales sensibles DEBEN cifrarse en reposo y las credenciales guardarse en el almacén seguro del sistema.

**Verificación.** (P) Pruebas de sincronización con red intermitente, reintentos, duplicados y reloj del dispositivo
desfasado; prueba de 72 h simuladas (reloj controlado). (R) Toda pantalla que muestre datos locales indica su frescura.

### XII. API Contract-First

- La especificación OpenAPI en `contracts/openapi/` es la fuente de verdad de la API REST y se modifica **antes** que el
  código que la implementa.
- El backend DEBE validarse contra el contrato (pruebas de contrato) y el cliente Dart DEBE generarse desde él, no escribirse
  a mano.
- Los DTOs de red NO son modelos de dominio; cada lado mapea a su propio dominio.

**Verificación.** (P) CI ejecuta lint del contrato, detección de cambios incompatibles contra `main`, pruebas de contrato del
backend y verifica que el cliente generado está actualizado.

### XIII. Observabilidad

- Logs estructurados (JSON) con `correlation_id`, `tenant_id`, actor (identificador, no PII) y módulo.
- Los logs NO DEBEN contener PII ni secretos (nombres, teléfonos, CURP/identificadores fiscales, tokens, OTP).
- Health checks de *liveness* y *readiness* (incluyendo base de datos) y métricas técnicas y de negocio básicas.
- Los errores financieros (desbalance, falla de conciliación) DEBEN generar alertas.

**Verificación.** (P) Pruebas que verifican redacción de campos sensibles en logs; endpoints de health probados en CI.
(R) Cada spec declara métricas y eventos de log relevantes.

### XIV. Evolución compatible

- Migraciones de base de datos DEBEN ser compatibles hacia atrás (patrón expand → migrate → contract).
- La API se versiona semánticamente; cambios incompatibles requieren nueva versión mayor y periodo de convivencia.
- Versiones de apps móviles en producción DEBEN seguir funcionando durante una ventana de soporte definida
  (PENDIENTE: duración de la ventana, ver registro de decisiones); el backend expone versión mínima soportada.
- Las operaciones offline creadas con una versión anterior de la app DEBEN poder sincronizarse.

**Verificación.** (P) Detección de breaking changes en OpenAPI; pruebas de migración sobre una copia de esquema previo.
(R) Revisión de migraciones destructivas (prohibidas sin fase de *contract* aprobada).

### XV. Protección de datos

- Minimización: solo se recolectan datos personales con propósito definido en la spec.
- Cifrado en tránsito (TLS) obligatorio; cifrado en reposo para base de datos, respaldos y almacenamiento local de apps.
- PII enmascarada en UI y exportaciones según rol; acceso a PII completa queda auditado.
- Retención y eliminación según política aprobada. Los requisitos legales NO DEBEN inventarse: lo no validado por
  especialista se marca **PENDIENTE-LEGAL** y no se presenta como cumplimiento.

**Verificación.** (R) Cada spec incluye inventario de datos personales y su propósito. (P) Pruebas de enmascaramiento por rol.

## Restricciones de stack y tecnología

- **Repositorio**: monorepo único `kuota-platform`; un solo proyecto Spec-Kit en la raíz; sin repos anidados ni submódulos.
- **Backend**: Node.js LTS, TypeScript estricto, NestJS, PostgreSQL. pnpm workspaces. Redis solo con justificación en plan.
- **Apps**: Flutter/Dart con pub workspaces; Drift/SQLite para persistencia offline; almacenamiento seguro de credenciales.
- **Contratos**: OpenAPI 3.x; cliente Dart generado.
- **Infraestructura**: Docker Compose para desarrollo local; CI/CD en GitHub Actions. No se aprovisionan servicios cloud
  de pago sin aprobación.
- Cambiar cualquiera de estas elecciones requiere un ADR aprobado en `docs/decisions/`.

## Flujo de desarrollo y quality gates

- Rama principal `main` protegida: sin pushes directos; solo merge vía Pull Request.
- Ramas: `feature/NNN-slug` (generadas por Spec-Kit), `fix/<slug>`, `hotfix/<componente>-<slug>` (urgencias de
  producción), `chore/<slug>`, `docs/<slug>`.
- Commits con **Conventional Commits** y scope de componente (`backend`, `admin`, `collector`, `client`, `flutter-pkg`,
  `contracts`, `infra`, `ci`, `specs`, `docs`, `adr`, `constitution`, `speckit`).
- Todo PR requiere: al menos 1 aprobación (2 si toca ledger, motores financieros, autenticación o RLS), CI verde,
  referencia a spec/tareas y checklist de la Constitución.
- **Excepción de mantenedor único**: mientras el proyecto tenga un solo mantenedor, los PR en áreas que exigen 2
  aprobaciones requieren 1 aprobación humana + checklist constitucional completo + `/speckit-analyze` sin hallazgos
  CRITICAL + CI verde. La regla de 2 aprobaciones se activa automáticamente al registrarse un segundo mantenedor
  en CODEOWNERS.
- Gates bloqueantes de CI: lint, tipos, pruebas unitarias e integración de componentes afectados, cobertura, contrato
  OpenAPI y compatibilidad, pruebas de aislamiento multi-tenant, escaneo de secretos y dependencias.
- Releases independientes por componente con versionado semántico y etiquetas `backend-vX.Y.Z`, `admin-vX.Y.Z`,
  `collector-vX.Y.Z`, `client-vX.Y.Z` y, para el contrato de API, `contracts-vX.Y.Z`.

## Reglas para agentes de IA

- Claude Code y cualquier agente DEBEN leer esta Constitución y `CLAUDE.md` antes de modificar el repositorio.
- NO DEBEN implementar funcionalidad fuera de la spec y `tasks.md` aprobados de la feature activa.
- NO DEBEN hacer `git push`, crear repos remotos, publicar paquetes ni cambiar configuraciones remotas sin aprobación.
- NO DEBEN crear repos anidados, submódulos ni instalaciones adicionales de `.specify/`.
- NO DEBEN escribir secretos en archivos versionados.
- Ante ambigüedad de negocio, financiera o legal DEBEN detenerse, registrar alternativas y recomendación, y solicitar
  decisión; NO DEBEN asumir la respuesta.
- NO DEBEN marcar tareas o fases como completadas sin evidencia verificable (archivos, comandos y resultados).

## Governance

- Esta Constitución prevalece sobre cualquier otra guía del repositorio (`CLAUDE.md`, docs, specs).
- **Enmiendas**: mediante PR en rama `docs/constitution-*` que incluya justificación, impacto en specs/código existentes
  y plan de migración; requiere aprobación del responsable técnico y del responsable de producto.
- **Versionado** semántico: MAJOR = eliminar o redefinir un principio; MINOR = agregar principio/sección o ampliar
  materialmente; PATCH = aclaraciones de redacción.
- **Cumplimiento**: cada PR incluye el checklist de la Constitución; el *Constitution Check* de cada `plan.md` DEBE pasar
  o justificar excepciones en su tabla de complejidad; `/speckit-analyze` trata violaciones como CRITICAL.
- Revisión periódica de la Constitución al cierre de cada iteración mayor.

**Version**: 1.2.0 | **Ratified**: 2026-11-22 | **Last Amended**: 2026-11-22
