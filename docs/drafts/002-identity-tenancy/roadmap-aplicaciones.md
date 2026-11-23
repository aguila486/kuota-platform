# 002 — Roadmap funcional por aplicación (fases verticales)

> **BORRADOR (2026-11-23).** Cada fase es vertical: **contrato OpenAPI + backend + pantalla** funcionando juntos y
> verificados (pruebas de contrato, aislamiento y widgets; Android en emulador y Web en Chrome). No se construye ninguna
> pantalla sin su contrato ni se simula autenticación como si fuera real. Cada fase empieza solo cuando sus decisiones
> están aprobadas. iOS: diferido (Aprobación 9).

## Fase 0 — Prerrequisitos (sin código de negocio)

| Entregable | Bloqueado por |
|---|---|
| ADR-0008 de propiedad de tablas, manifiesto y verificador en CI, defecto de referencia en `prove-gates.sh` | D-ARC-07 |
| Spec oficial de 002 con Spec-Kit (rama `feature/002-identity-tenancy`) a partir de `spec-borrador.md` | Autorización de rama |
| `withIdentity` y contexto de pre-autenticación en `common/tenant-context`, con pruebas negativas | Aprobación de ese cambio |
| Decisiones D-AUTH-01/02/03, catálogo de roles, sesión web/CORS | Responsable |

## Fase 1 — Kuota Core: identidad, tenancy y plataforma mínima

- **Backend:** `tenancy` (tenants, sucursales), `identity` (identidades, credenciales), `access` (membresías, roles,
  permisos), `platform-admin` (alta de tenant y primer administrador, `kuota_platform`, auditoría).
- **Contrato:** endpoints de plataforma con prefijo propio.
- **Pantalla:** ninguna todavía (la plataforma opera por API o CLI interna en local/testing).
- **Verificación:** RLS de todas las tablas nuevas, MT-02..06 sobre ellas, auditoría del alta, propiedad de tablas.

## Fase 2 — Admin Web: inicio de sesión de staff y selección de organización

- **Backend:** login de staff (⏳ D-AUTH-02), TOTP si el rol lo exige, sesiones y refresh con rotación, cambio de
  tenant (nuevo access token), revocación propia.
- **Contrato:** login, MFA, selección de tenant, refresh y logout; errores 401/403/429 en problem+json.
- **Admin Web:** pantallas de login, segundo factor y selección de organización; `app_shell` gana el estado de sesión
  y las guardas de navegación; `api_client` el interceptor de autenticación.
- **Verificación:** MT-01 y MT-07; fuerza bruta y enumeración; reutilización de refresh; Chrome real con CORS según la
  decisión de sesión web.

## Fase 3 — Admin Web: roles, permisos y administración inicial

- **Backend:** invitaciones, membresías, roles y permisos (catálogo aprobado), sucursales, auditoría de cada cambio.
- **Admin Web:** gestión de miembros, roles, sucursales y sesiones de otros (`session.revoke.others`).
- **Verificación:** cada endpoint con su permiso y sus pruebas 403; MT-01 por recurso.

## Fase 4 — Collector Mobile: enrolamiento y acceso seguro

- **Backend:** `devices` (registro de llave pública, aprobación por tenant, revocación), challenge firmado.
- **Collector:** primer login, enrolamiento, PIN, selección de tenant si tiene varias membresías, gestión de su
  sesión y dispositivo; almacenamiento seguro (⏳ ubicación del wrapper).
- **Admin Web:** aprobación y revocación de dispositivos.
- **Verificación:** dispositivo revocado rechazado; borrado remoto; límite de sesión offline (⏳ D-SYNC-03) como regla
  local, sin sincronización todavía (011).

## Fase 5 — Client Mobile: enrolamiento e inicio de sesión

- **Backend:** OTP de enrolamiento (interfaz `OtpSender`; emisor técnico solo en local/testing hasta D-ARC-04), device
  binding, challenge firmado, refresh ligado al dispositivo.
- **Client:** activación con el teléfono registrado por el tenant, PIN o biometría (⏳ D-LEG-02), inicio de sesión,
  cambio de empresa.
- **Dependencia:** el registro del teléfono por el tenant pertenece a 003; en 002 se usa un alta técnica de prueba
  limitada a local/testing.
- **Verificación:** antienumeración, OTP vencido o reutilizado, MT-08.

## Fase 6 — Recuperación de acceso y gestión de sesiones

- **Backend:** recuperación con segundo control y periodo de espera (⏳ D-AUTH-01/02), revocación por identidad,
  sesión o dispositivo, avisos.
- **Apps:** flujo de recuperación en Client y Collector; recuperación de staff según la decisión; listado y
  revocación de sesiones propias en las tres apps.
- **Verificación:** una recuperación revoca todas las sesiones anteriores; un SIM-swap solo no basta.

## Resumen por aplicación

| Aplicación | Fases | Primera funcionalidad real |
|---|---|---|
| Kuota Core | 1–6 | Alta de tenant por plataforma (fase 1) |
| Admin Web | 2, 3, 4 (aprobación de dispositivos), 6 | Login de staff y selección de organización (fase 2) |
| Collector Mobile | 4, 6 | Enrolamiento aprobado y acceso con PIN (fase 4) |
| Client Mobile | 5, 6 | Activación con OTP y acceso con PIN (fase 5) |
