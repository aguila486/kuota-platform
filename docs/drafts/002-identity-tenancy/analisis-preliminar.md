# 002-identity-tenancy — Análisis técnico preliminar

> **BORRADOR (2026-11-23). No es una especificación aprobada ni autoriza implementación.** Ninguna decisión pendiente se
> da por aprobada aquí; las recomendaciones citan su fuente (`docs/security/authentication.md`,
> `docs/security/multi-tenant-isolation.md`, `docs/architecture/data-architecture.md`, ADR-0002,
> `docs/business/decisions-register.md`).

## 0. Por qué este documento está aquí y no en `specs/`

- `/speckit-specify` ejecuta un hook obligatorio (`.specify/extensions.yml`, `before_specify` → `speckit.git.feature`)
  que **crea una rama**. Las ramas nuevas no están autorizadas en esta etapa (Aprobación 10 de 001).
- Crear `specs/002-identity-tenancy/` a mano alteraría la numeración secuencial de Spec-Kit
  (`feature_numbering: sequential`) y la feature activa (`.specify/feature.json` → 001).
- **Procedimiento local propuesto:** este borrador vive en `docs/drafts/`. Cuando se autorice crear la rama, se ejecuta
  `/speckit-specify` con este documento como descripción y se siguen `/speckit-clarify`, `/speckit-plan`,
  `/speckit-tasks` y `/speckit-analyze`, con aprobación humana antes de `/speckit-implement` (Constitución I). El
  borrador se elimina o se archiva al crear `specs/002-…/spec.md`.

## 1. Alcance según el mapa de capacidades

`docs/business/capability-map.md`: "Tenants, sucursales, usuarios, roles, autenticación — Alta de tenant (plataforma),
RBAC, login staff con MFA, enrolamiento de dispositivos, identidad global vs membresías". Depende de 001 y de
D-AUTH-01, D-AUTH-02 y D-LEG-06.

Fuera de 002 (según el mapa): datos de cliente y su vínculo con la identidad (003, `customer_links`), portal del cliente
(014), sincronización offline (011). 002 deja preparada la identidad que esas features usan.

## 2. Decisiones que bloquean la implementación (todas PENDIENTES)

| ID | Pregunta | Opciones y recomendación registradas | Qué bloquea en 002 |
|---|---|---|---|
| D-ARC-07 | Propiedad de tablas por módulo (ADR-0002, C2-2) | Recomendado en ADR-0002: manifiesto `backend/db/table-ownership.json` + verificador de catálogo junto a `db:check-rls` + modelos Prisma por módulo y lint. Alternativa más fuerte, no recomendada para v1: esquema y rol por módulo | **Todo.** ADR-0002: "debe resolverse antes de 002"; 002 crea las primeras tablas de negocio (`tenants`, `identities`, `memberships`…) |
| D-AUTH-01 | Autenticación de clientes | Recomendado: OTP solo para enrolamiento y recuperación + device binding + PIN/biometría | Flujos de Kuota Client |
| D-AUTH-02 | Autenticación de staff | Recomendado: contraseña + MFA TOTP obligatorio en roles financieros; passkeys como evolución | Flujos de Kuota Admin (y del primer login del cobrador) |
| D-AUTH-03 | Encaje de login, OTP y recuperación en la Constitución §II (lista cerrada de excepciones) | Recomendado: tratarlos como **puntos de entrada de autenticación** (no excepción) con controles propios (límite de intentos, antienumeración, auditoría); si hiciera falta una categoría nueva, enmienda de §II | Tabla Endpoint Access de 002; posible enmienda constitucional |
| D-LEG-06 | Figura jurídica de los tenants (quién puede prestar o captar) | Especialista; validar por tenant | Onboarding de tenants (qué datos y validaciones pide el alta) |
| D-ARC-04 | Proveedor cloud/hosting | Pendiente | **Proveedor de OTP** (SMS/WhatsApp, `authentication.md` §3.1), custodia de llaves de firma de tokens, almacenamiento de secretos |
| D-SYNC-03 | Expiración de la sesión offline del cobrador | Recomendado: 72 h configurable por tenant | Sesión offline de Kuota Collector |
| D-LEG-02 | Datos personales y biometría | Recomendado: la biometría se queda en el sistema operativo del dispositivo; validar con legal | PIN/biometría en Client y Collector |

Preguntas nuevas detectadas al preparar este análisis (no registradas aún; proponer en `decisions-register.md`):

1. **Catálogo inicial de roles y permisos.** Ningún documento fija los roles (solo "roles con permisos financieros").
2. **CORS con credenciales para Admin Web.** `authentication.md` §3.3 propone cookie `HttpOnly`/`SameSite=Strict`. La
   política CORS de 001 (Aprobación 8) tiene `credentials: false` "salvo requisito documentado y aprobado". 002 debe
   decidirlo junto con CSRF.
3. **Almacenamiento seguro en Flutter.** `flutter-architecture.md` §3 sitúa el wrapper de `flutter_secure_storage` en
   `shared_core`, pero `shared_core` debe ser Dart puro (FR-033, `check_deps.dart`) y ese paquete es un plugin de
   Flutter. Hay que decidir dónde vive el wrapper (p. ej. `app_shell` o un paquete de plataforma).
4. **Llaves de firma de JWT** (rotación con `kid`, `authentication.md` §4): custodia y rotación dependen de D-ARC-04.

## 3. Estructura técnica preliminar

### Backend (módulos de Kuota Core)

| Módulo | Responsabilidad | Tablas candidatas | Alcance de datos |
|---|---|---|---|
| `tenancy` | Tenants y sucursales | `tenants`, `branches` | `tenants` es de plataforma (rol `kuota_platform`, `data-architecture.md` §2); `branches` con `tenant_id` y RLS forzado |
| `identity` | Identidad global, credenciales y factores | `identities` (sin `tenant_id`, política por `app.identity_id`, sin datos de negocio), credenciales de staff, secretos TOTP cifrados | Global |
| `access` | Membresías, roles y permisos por tenant | `memberships`, catálogo de roles y permisos | Por tenant (RLS) |
| `devices` | Enrolamiento, llaves públicas, aprobación y revocación | `devices` | Por identidad y, para cobradores, por tenant |
| `sessions` | Tokens y sesiones | `sessions`, `refresh_tokens` (hash, familia, rotación) | Por identidad |
| `platform-admin` | Alta de tenants y operaciones cross-tenant | Usa `tenants`/`memberships` vía funciones `SECURITY DEFINER` auditadas | Plataforma (Constitución III) |

- **Fin del contexto técnico de 001:** el contexto de tenant se fija desde el token verificado
  (`sub`, `tenant_id`, `roles`, `device_id`, `session_id`, `amr`), nunca desde `X-Kuota-Dev-Tenant`. Esto cierra el
  riesgo de identidad confiable de P2 (ADR-0004) y requiere una variante de `TenantContext` con identidad autenticada.
  `dev-probe` sigue limitado a local/testing.
- **Pruebas de aislamiento** que 002 debe aportar (`multi-tenant-isolation.md` §9): MT-01 por endpoint, MT-07 (`tenant_id`
  del cliente ignorado o rechazado) y MT-08 (misma persona en dos tenants).
- **Auditoría:** `AuditService` de 001 en la misma transacción; los actores pasan de `dev:*` a identidades reales.

### Apps Flutter

- `app_shell` (Aprobación 11) es el lugar natural para el estado de sesión compartido (providers de sesión, guardas
  de navegación con `go_router`), siempre sin lógica financiera.
- `api_client`: interceptor de autenticación (`flutter-architecture.md` §3: "interceptores (auth, …)"); el contrato
  OpenAPI define los endpoints de autenticación y genera el cliente (Constitución XII).
- Tokens en Keychain/Keystore, nunca en SharedPreferences ni en la base local sin cifrar (`authentication.md` §4).

## 4. Flujos (recomendaciones de `authentication.md`, pendientes de decisión)

| Actor | Alta y enrolamiento | Uso diario | Recuperación y revocación |
|---|---|---|---|
| Staff (Admin Web) | Cuenta creada por el tenant o la plataforma; correo + contraseña (≥ 12, Argon2id, lista de contraseñas filtradas); TOTP en roles financieros | Cookie `HttpOnly`/`Secure`/`SameSite=Strict` + CSRF; expiración por inactividad 15–30 min (a definir) | Revocación de sesiones; recuperación por definir (no consta en los documentos) |
| Cobrador (Collector) | Dispositivo aprobado por un administrador del tenant; primer login con usuario + contraseña | PIN local + llave del dispositivo; sesión offline hasta 72 h (D-SYNC-03) | Revocación y borrado remoto (las operaciones pendientes se suben antes si la llave sigue válida; si el dispositivo fue robado → REQUIRES_REVIEW) |
| Cliente (Client) | El tenant registra el teléfono → OTP → PIN → par de llaves no exportable | PIN/biometría desbloquea la llave → firma de un *challenge* → tokens; cambio de tenant = nuevo token | OTP + segundo control, periodo de espera y aviso al dispositivo anterior; 5 intentos de PIN → bloqueo creciente, 10 → recuperación |
| Plataforma | MFA resistente a phishing | — | *Break-glass* con motivo y caducidad, auditado |

Tokens (`authentication.md` §4): access JWT asimétrico de ≈ 10 min; refresh opaco con hash en servidor, rotación en
cada uso y revocación de toda la familia ante reutilización; refresh de móvil ligado a `device_id` y prueba de
posesión.

## 5. Seguridad, auditoría y privacidad (a llevar a la spec)

- Límite de tasa por IP, identidad y teléfono en login, OTP y recuperación; respuestas idénticas exista o no la cuenta.
- OTP: 6 dígitos, ≤ 5 min, un solo uso, intentos limitados, **nunca en logs** (la redacción de 001 debe ampliarse).
- Auditoría de inicio y fallo de sesión, enrolamiento, cambio de PIN o teléfono, revocaciones y accesos de plataforma.
- Notificación ante dispositivo nuevo o recuperación.
- `identities` sin datos de negocio; un tenant no puede saber si una persona existe en otro tenant
  (`multi-tenant-isolation.md` §7).
- Métricas sin etiquetas de tenant ni identidad (FR-039 de 001); nuevos contadores de autenticación con etiquetas
  acotadas (resultado, método), sin teléfono ni correo.

## 6. Propuesta de orden de trabajo (cuando se autorice)

1. Resolver D-ARC-07 e implementar su verificador (prerrequisito de cualquier tabla de 002).
2. Resolver D-AUTH-01/02/03, D-LEG-06 y las preguntas nuevas 1–4; registrar decisiones y, si procede, la enmienda de §II.
3. Crear la rama y la spec de 002 con Spec-Kit a partir de este borrador.
4. Implementar en incrementos: identidad y tenancy (backend + RLS + MT-01/07/08) → staff (Admin Web) → dispositivos y
   cobrador → cliente (OTP depende del proveedor, D-ARC-04).
