# 002 — Matriz de decisiones de autenticación, legales y operativas

> **BORRADOR (2026-11-23). Ninguna decisión de este documento está aprobada.** "Recomendación" recoge la que ya
> figura en los documentos del proyecto o una propuesta técnica justificada; la decisión es del responsable.

## 1. Qué está aprobado hoy y qué no

| Mecanismo | Plano | Estado | Fuente |
|---|---|---|---|
| Autenticación y autorización en el backend, en cada endpoint; las apps nunca autorizan | Autorización | **APROBADO** | Constitución II |
| Contexto de tenant desde la identidad autenticada, nunca desde parámetros del cliente | Autorización / aislamiento | **APROBADO** | Constitución III |
| Lista cerrada de excepciones de acceso (liveness, readiness, compatibilidad, métricas, mecanismos técnicos de dev/test) | Acceso | **APROBADO** | Constitución II |
| Identidad global; datos de cliente por tenant | Identidad | **APROBADO** (principio) | Constitución III |
| Operaciones de plataforma con rol y módulo separados, auditadas | Autorización | **APROBADO** (principio) | Constitución III |
| Auditoría append-only en la misma transacción (`AuditService`) | Auditoría | **APROBADO e implementado** | 001 (US6) |
| CORS con orígenes exactos, **sin credenciales** salvo requisito documentado y aprobado | Sesión web | **APROBADO** (sin credenciales) | Aprobación 8 |
| Contraseña Argon2id (≥ 12, lista de filtradas) | Autenticación | Propuesta | `authentication.md` §3.3 → D-AUTH-02 |
| MFA TOTP obligatorio en roles financieros o de configuración | Autenticación | Propuesta | §3.3 → D-AUTH-02 |
| OTP solo para enrolamiento y recuperación + device binding + PIN/biometría | Autenticación / dispositivo | Propuesta | §3.1 → D-AUTH-01 |
| Access JWT asimétrico (≈ 10 min, `kid`) | Sesión | Propuesta | §4 (sin ID de decisión) |
| Refresh opaco con hash, rotación en cada uso, revocación de familia por reutilización | Sesión | Propuesta | §4 (sin ID) |
| Cookie `HttpOnly`/`Secure`/`SameSite=Strict` + CSRF en Admin Web | Sesión web | Propuesta | §3.3; **choca con la Aprobación 8** (sin credenciales) hasta decidir |
| Tokens en Keychain/Keystore; nunca en SharedPreferences | Dispositivo | Propuesta | §4, `flutter-architecture.md` §6 |
| Enrolamiento de dispositivo aprobado por un administrador; revocación y borrado remoto | Dispositivo | Propuesta | §3.2 |
| Sesión offline del cobrador hasta 72 h | Sesión / dispositivo | Pendiente | D-SYNC-03 |
| Límite de tasa, antienumeración, OTP fuera de los logs | Autenticación | Propuesta | §5 → criterio de D-AUTH-03 |

## 2. D-AUTH-01, D-AUTH-02 y D-AUTH-03

| | D-AUTH-01 — Clientes (Client) | D-AUTH-02 — Staff (Admin Web; primer login del cobrador) | D-AUTH-03 — Encaje en la Constitución §II |
|---|---|---|---|
| Opciones | (a) OTP en cada login; (b) solo PIN; (c) OTP para enrolamiento y recuperación + device binding + PIN/biometría | (a) contraseña; (b) contraseña + TOTP obligatorio en roles financieros o de configuración; (c) SSO; passkeys como evolución | (a) login/OTP/recuperación como **puntos de entrada de autenticación** con controles propios; (b) enmendar §II con una categoría nueva; (c) exigir credencial también donde hoy no hay |
| Recomendación registrada | (c) | (b), passkeys como evolución | (a); enmienda solo si 012 mantiene la verificación pública de recibos |
| Riesgos que mitiga | SIM-swap y coste de SMS (a); robo del teléfono sin segundo factor (b) | Toma de cuentas con permisos financieros | Endpoints públicos sin controles; contradicción constitucional |
| Dependencias | Proveedor OTP (D-ARC-04); D-LEG-02 (biometría) | Custodia de secretos TOTP (D-ARC-04) | Spec de 002 con su tabla Endpoint Access; 012 |
| Qué hay que aprobar | Opción y parámetros (intentos de PIN 5/10, periodo de espera en recuperación) | Opción, roles a los que se exige TOTP, inactividad 15–30 min | Opción; si es (b), la enmienda constitucional por su procedimiento |

### Recuperación sin reducir la seguridad (propuesta)

- **Cliente:** OTP **más** un segundo control (validación presencial con el cobrador o la sucursal, o datos del
  préstamo), periodo de espera configurable, aviso al dispositivo anterior y revocación de sus sesiones al completar
  (`authentication.md` §3.1). Nunca solo OTP: un SIM-swap no debe bastar.
- **Staff:** recuperación iniciada por un administrador del tenant con TOTP, o por soporte de plataforma con
  *break-glass* auditado; restablece contraseña **y** factor, y revoca todas las sesiones. Los documentos no fijan este
  flujo: **pendiente de decisión**.
- **Cobrador:** el dispositivo se vuelve a enrolar y lo aprueba un administrador; el anterior queda revocado.

### Revocación de sesiones comprometidas (propuesta)

- Reutilización de un refresh ya usado → se revoca toda la familia y se audita (detección automática).
- Revocación manual por identidad, sesión o dispositivo (administrador del tenant o la propia persona); los access
  tokens caducan en minutos, así que no hace falta una lista negra de access tokens si su vida es corta.
- Revocación de dispositivo → la app borra la base local al siguiente contacto (tras intentar subir lo pendiente si la
  llave sigue válida; si el dispositivo fue robado, lo pendiente pasa a REQUIRES_REVIEW).

## 3. Decisiones legales y operativas

| Tema | Estado | Evidencia | Opciones | Recomendación | Riesgo si no se decide | Requiere aprobación |
|---|---|---|---|---|---|---|
| **D-LEG-06** figura jurídica de los tenants | Pendiente-legal | `decisions-register.md` | Según país (D-LEG-01, también pendiente) | Especialista; validar por tenant en el alta | Operar con tenants no autorizados | Qué datos y validaciones exige el alta de tenant; puede implementarse un alta mínima sin validación legal solo en local/testing |
| **D-ARC-04** proveedor cloud/hosting | Pendiente | `decisions-register.md`; `deployment-architecture.md` | AWS · GCP · Azure · otros | No seleccionar sin autorización | Bloquea staging/producción, OTP real y custodia de llaves | Proveedor (no lo bloquea el desarrollo local) |
| **D-SYNC-03** sesión offline del cobrador | Pendiente | `authentication.md` §3.2 | 24 h · 72 h · configurable por tenant | 72 h configurable por tenant | Cobros sin control prolongado o cobradores bloqueados en campo | Valor por defecto y si es configurable |
| **D-LEG-02** datos personales y biometría | Pendiente-legal | `authentication.md` §6 | La biometría se queda en el SO · otra | Biometría solo en el SO; Kuota no recibe plantillas | Tratamiento indebido de datos sensibles | Validación legal (no se inventan obligaciones) |
| **Custodia de llaves de firma** (JWT) | Sin decisión | `authentication.md` §4 (rotación con `kid`) | KMS/HSM del proveedor · secreto montado · generadas por despliegue | Local/testing: par efímero por ejecución, nunca versionado; entornos reales: gestor del proveedor (D-ARC-04) | Falsificación de tokens si la llave se filtra | Mecanismo y periodo de rotación |
| **Proveedor OTP** (SMS/WhatsApp) | Sin decisión | §3.1 ("proveedor por definir, ver D-ARC-04") | Varios (no se selecciona aquí) | Interfaz `OtpSender` en el backend; en local/testing un emisor técnico que **no** envía mensajes y está deshabilitado fuera de esos entornos (como dev-probe) | Bloquea el enrolamiento real de clientes | Proveedor y canal |
| **Catálogo inicial de roles** | Sin decisión | Ningún documento lo fija ("roles con permisos financieros") | Ver la propuesta de `spec-borrador.md` §7 | Partir de pocos roles con permisos explícitos | Permisos excesivos o arbitrarios | Lista de roles y permisos iniciales |
| **Almacenamiento seguro móvil** | Contradicción documental | `flutter-architecture.md` §3 pone el wrapper en `shared_core` (Dart puro por FR-033); `flutter_secure_storage` es un plugin Flutter | Wrapper en `app_shell` · paquete nuevo de plataforma · interfaz en `shared_core` e implementación en `app_shell` | Interfaz Dart pura en `shared_core` e implementación con el plugin en `app_shell` (no rompe FR-033) | Tokens en almacenamiento inseguro | Ubicación y la versión del plugin (dependencia nueva) |
| **CORS con credenciales** (Admin Web) | Aprobado sin credenciales (Aprobación 8) | §3.3 propone cookie | Cookie + `credentials: true` con orígenes exactos + CSRF · tokens en memoria con refresh por cookie del mismo sitio · BFF | Decidir junto con la topología de despliegue (mismo sitio o no), que depende de D-ARC-04 | CSRF o tokens expuestos a XSS | Modelo de sesión web y, si procede, una nueva aprobación de CORS |
| **Auditoría de plataforma en 002** | Tabla y escritura de la purga implementadas (T099); sin rol de lectura ni retención. Límites verificados: el propietario y el superusuario pueden alterarla; mantenimiento puede insertar eventos fabricados | `platform_audit_events` (migración 0003), `data-model.md`, `research.md` (revisión adicional de T099) | Rol `kuota_platform` de solo lectura · lectura solo por soporte con break-glass | Rol de lectura de plataforma con MFA y su propia auditoría de acceso; vista de ejecuciones incompletas (`started` sin resultado y sin bloqueo tomado); trigger que rechace resultados sin inicio; copia externa append-only frente a propietario y superusuario (D-ARC-04); nuevas operaciones (`tenant.create`, `breakglass`) en la lista cerrada | Operaciones de plataforma sin trazabilidad, lectura indebida o alteración no detectada | Rol de lectura, operaciones nuevas, copia externa y política de retención |
| **Contexto de identidad y pre-autenticación** | Sin decisión | `adr-propuesta-d-arc-07.md` §4.3 | `withIdentity` + funciones `SECURITY DEFINER` mínimas · rol de autenticación separado | Ambos, con pruebas negativas | Búsquedas de identidad sin control o bypass de RLS | Ampliar `common/tenant-context` (protegido) |

## 4. Decisiones necesarias antes de crear tenants, usuarios y sesiones

| Antes de crear… | Decisión | Por qué bloquea |
|---|---|---|
| Cualquier tabla de 002 | D-ARC-07 (propiedad de tablas y su verificador) | ADR-0002 la exige antes de la primera tabla de negocio |
| `tenants` | D-LEG-06 (datos del alta); rol `kuota_platform` y operaciones de plataforma auditadas | El alta es una operación de plataforma (Constitución III) |
| `identities` y credenciales | D-AUTH-02 (staff), D-AUTH-01 (clientes), D-AUTH-03 (encaje en §II); contexto `withIdentity` y pre-autenticación | Definen qué se guarda, cómo se busca una identidad antes de autenticar y qué endpoints son puntos de entrada |
| `memberships`, `roles`, `permissions` | Catálogo inicial de roles y permisos | Sin él, los permisos serían arbitrarios |
| `sessions`, `refresh_tokens` | Modelo de sesión web (cookie + CSRF + CORS con credenciales, u otro) y custodia de llaves de firma (D-ARC-04 en entornos reales) | Determinan el formato y la protección de los tokens |
| `devices` | D-SYNC-03, D-LEG-02 y la ubicación del almacenamiento seguro móvil | Enrolamiento, PIN/biometría y sesión offline |

