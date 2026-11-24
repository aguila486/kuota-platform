# 002 — Matriz ejecutiva de decisiones para el primer flujo real

> **BORRADOR (2026-11-23). Ninguna opción de este documento está aprobada.** "Recomendada" es una propuesta técnica; la
> decisión es del responsable. Complementa `decisiones-pendientes.md` y `adr-propuesta-d-arc-07.md`.

**Primer flujo real (objetivo):** un operador de plataforma crea una organización, se registra su primer
administrador, y ese administrador inicia sesión de forma segura en Kuota Admin. Collector y Client no participan
todavía; las decisiones se toman sin cerrarles el camino.

Impacto en las aplicaciones: **Core** (backend), **Admin** (Admin Web), **Collector** (Collector Mobile), **Client**
(Client Mobile).

## Resumen

| # | Decisión | Recomendada | ¿Bloquea el primer flujo? |
|---|---|---|---|
| 1 | D-ARC-07: propiedad de tablas | Propiedad exclusiva por módulo (regla A) con identidad, acceso y tenancy separados (descomposición C) | Sí: ninguna tabla de 002 sin ella |
| 2 | Contexto previo a la autenticación | Funciones `SECURITY DEFINER` mínimas con un rol propio + `withIdentity` | Sí: el login busca una identidad sin tenant |
| 3 | Separación plataforma / identidad global / tenant | Tres planos con roles de base de datos y prefijos de API distintos | Sí: el alta de organización es una operación de plataforma |
| 4 | D-AUTH-02 (staff) | Contraseña Argon2id + TOTP obligatorio para el administrador | Sí |
| 5 | D-AUTH-03 (encaje en la Constitución §II) | Puntos de entrada de autenticación con controles propios, sin enmienda | Sí |
| 6 | D-AUTH-01 (clientes) | OTP de enrolamiento + dispositivo vinculado + PIN/biometría | No (Client, fase posterior) |
| 7 | Modelo de sesión web | Access token en memoria + refresh en cookie `HttpOnly` del mismo sitio + CSRF | Sí |
| 8 | JWT y custodia de claves | JWT asimétrico (EdDSA o ES256) con `kid`; local: par efímero por ejecución; entornos reales: KMS (D-ARC-04) | Sí (local no; staging sí) |
| 9 | Roles mínimos | `platform_operator` (plataforma) y `tenant_admin` (tenant), con permisos explícitos | Sí |
| 10 | Requisitos legales bloqueantes | D-LEG-06 (datos del alta) y D-LEG-02 (datos personales) | Sí para producción; no para local/testing |

## 1. D-ARC-07 — Propiedad de tablas

1. **Problema:** con un único `schema.prisma` y un cliente que expone todos los modelos, cualquier módulo puede leer o
   escribir tablas de otro (Constitución IX). 002 crearía las primeras tablas de negocio.
2. **Opciones:** A) cada módulo es dueño exclusivo de sus tablas; B) repositorios compartidos entre módulos;
   C) descomposición `identity` / `access` / `tenancy` bajo la regla A o B.
3. **Recomendada:** A + C.
4. **Justificación:** es la única que cumple IX literalmente y se puede verificar (manifiesto tabla → módulo, verificador
   de catálogo junto a `db:check-rls`, lint por modelo y defecto de referencia en `prove-gates`); separa lo global de lo
   que es por tenant (III).
5. **Riesgo:** más API interna entre módulos; el esquema Prisma multiarchivo de 7.10.1 está sin verificar (alternativa:
   lint por nombre de modelo en un único esquema).
6. **Impacto:** Core (estructura de módulos y verificador); Admin, Collector y Client ninguno directo.
7. **Aprobar:** la regla A con la descomposición C, el mecanismo de verificación y la clasificación de `tenants`.

## 2. Contexto de identidad previo a la autenticación

1. **Problema:** el login necesita encontrar una identidad sin conocer todavía su tenant ni su identidad; hoy todo acceso
   a datos exige `withTenant` (RLS por `app.tenant_id`).
2. **Opciones:** a) funciones `SECURITY DEFINER` mínimas (p. ej. "buscar identidad por correo → id y estado") con un rol
   de autenticación sin acceso a datos de negocio; b) un rol de autenticación con SELECT directo sobre `identities`;
   c) consultas sin RLS desde un módulo privilegiado.
3. **Recomendada:** a) más un contexto `withIdentity` (fija `app.identity_id`) para lo que ocurre tras autenticar y
   antes de elegir organización.
4. **Justificación:** expone solo lo imprescindible, nunca consultas libres; mantiene RLS forzada y la propiedad de la
   transacción de T039.
5. **Riesgo:** enumeración de cuentas y fuerza bruta → respuestas uniformes, límite de tasa y pruebas negativas; es el
   punto más sensible del diseño.
6. **Impacto:** Core (amplía `common/tenant-context`, hoy protegido); Admin (pantalla de login); Collector y Client
   reutilizan el mismo contexto más adelante.
7. **Aprobar:** la opción a), la autorización expresa para ampliar `common/tenant-context` y el rol de autenticación.

## 3. Separación entre plataforma, identidad global y tenant

1. **Problema:** crear una organización no ocurre dentro de ningún tenant; la identidad de una persona es global; sus
   permisos son por tenant. Mezclarlos rompe la Constitución III.
2. **Opciones:** a) tres planos con roles de base de datos y prefijos de API distintos (`/v1/platform/*`, `/v1/me/*`,
   `/v1/*` con tenant); b) un solo plano con banderas de "superadministrador".
3. **Recomendada:** a), con `platform_audit_events` (001, T099) para las operaciones de plataforma y `audit_events` para
   las de tenant, sin mezclarlas.
4. **Justificación:** el alta de organización es una operación de plataforma auditada con rol y módulo separados
   (Constitución III); b) reintroduce un "superusuario de aplicación".
5. **Riesgo:** la auditoría de plataforma no protege frente al propietario de la tabla ni al superusuario, y el
   mantenimiento puede insertar eventos fabricados (revisión de T099); hace falta decidir su rol de lectura y una copia
   externa append-only.
6. **Impacto:** Core (rol `kuota_platform`, módulo `platform-admin`); Admin (consola de plataforma separada o ruta
   protegida: decidir); Collector y Client ninguno.
7. **Aprobar:** los tres planos, el rol `kuota_platform`, el prefijo de API de plataforma, las operaciones
   `tenant.create` y `tenant_admin.invite` en la lista cerrada de `platform_audit_events`, y quién puede leerla.

## 4–6. D-AUTH-01, D-AUTH-02 y D-AUTH-03

| | D-AUTH-02 — staff (primer flujo) | D-AUTH-03 — Constitución §II (primer flujo) | D-AUTH-01 — clientes (posterior) |
|---|---|---|---|
| Problema | Cómo se autentica quien administra dinero ajeno | Login y recuperación son públicos por naturaleza; §II exige autenticación salvo excepciones cerradas | Clientes con teléfonos compartidos, SIM-swap y coste de SMS |
| Opciones | a) contraseña; b) contraseña + TOTP; c) SSO; passkeys como evolución | a) puntos de entrada de autenticación con controles propios; b) enmienda constitucional; c) credencial previa | a) OTP en cada login; b) solo PIN; c) OTP de enrolamiento + dispositivo + PIN/biometría |
| Recomendada | b): Argon2id (≥ 12 caracteres, lista de filtradas) + TOTP obligatorio para `tenant_admin` y `platform_operator` | a), registrados en la tabla Endpoint Access con límite de tasa y antienumeración | c) |
| Justificación | Toma de cuentas = acceso a operaciones financieras; TOTP no depende de proveedores (D-ARC-04) | No cambia la Constitución; los controles se prueban como cualquier excepción | Equilibra seguridad y coste |
| Riesgo | Custodia del secreto TOTP (cifrado; clave ⏳) y recuperación del factor | Ambigüedad si 012 publica recibos verificables | Proveedor OTP sin elegir (D-ARC-04); biometría ⏳ D-LEG-02 |
| Impacto | Core (credenciales, factores); Admin (login, alta de TOTP); Collector (primer login del cobrador) | Core (tabla Endpoint Access, pruebas negativas) | Client (enrolamiento); Core (OTP) |
| Aprobar | Opción b, roles que exigen TOTP, inactividad (15–30 min) y el flujo de recuperación del factor | Opción a | Opción c y sus parámetros (cuando se aborde Client) |

## 7. Modelo de sesión web (Admin)

1. **Problema:** Admin Web necesita una sesión resistente a XSS y CSRF; la Aprobación 8 permite CORS solo sin
   credenciales.
2. **Opciones:** a) access token en memoria + refresh opaco en cookie `HttpOnly; Secure; SameSite=Strict` del mismo
   sitio + token CSRF; b) ambos tokens en `localStorage`; c) BFF que guarda los tokens en el servidor.
3. **Recomendada:** a) si Admin y API comparten sitio (subdominios del mismo dominio registrable); c) si no.
4. **Justificación:** el refresh nunca es legible por JavaScript; el access token dura minutos; b) expone tokens a XSS.
5. **Riesgo:** a) exige CORS con credenciales para orígenes exactos → **nueva aprobación que sustituya la Aprobación 8**
   para esa ruta; la topología depende de D-ARC-04.
6. **Impacto:** Admin (almacenamiento y renovación de la sesión en `app_shell`/`api_client`); Core (cookies, CSRF,
   CORS); Collector y Client usan almacenamiento seguro del dispositivo, no cookies.
7. **Aprobar:** la opción a) o c), la topología de dominios y la enmienda de CORS con credenciales para el endpoint de
   renovación.

## 8. JWT y custodia de claves

1. **Problema:** firmar los access tokens sin que una clave filtrada permita falsificarlos y poder rotarla.
2. **Opciones:** a) JWT asimétrico (EdDSA o ES256) con `kid` y rotación; b) JWT simétrico HS256; c) tokens opacos con
   consulta a base de datos en cada solicitud.
3. **Recomendada:** a), vida ≈ 10 min, refresh opaco con hash, rotación en cada uso y revocación de la familia ante
   reutilización. Local/testing: par efímero generado por ejecución, nunca versionado. Entornos reales: KMS o gestor de
   secretos del proveedor (⏳ D-ARC-04).
4. **Justificación:** la clave pública puede distribuirse sin riesgo; `kid` permite rotar sin cortar sesiones.
5. **Riesgo:** sin D-ARC-04 no hay custodia real → bloquea staging/producción, no el desarrollo local.
6. **Impacto:** Core (emisión, verificación, rotación); Admin, Collector y Client (renovación transparente; Collector
   debe tolerar caducidad offline ⏳ D-SYNC-03).
7. **Aprobar:** algoritmo, vidas del access y del refresh, la política de rotación y el mecanismo local de claves.

## 9. Roles mínimos

1. **Problema:** ningún documento fija un catálogo de roles; sin él los permisos serían arbitrarios.
2. **Opciones:** a) dos roles para el primer flujo (`platform_operator`, `tenant_admin`) y catálogo completo después;
   b) catálogo completo desde el inicio (cobrador, cajero, supervisor…).
3. **Recomendada:** a), con permisos definidos por el sistema (`tenant.create`, `tenant_admin.invite`,
   `membership.manage`) y roles por tenant que los agrupan.
4. **Justificación:** solo lo que el flujo necesita (Constitución, principio de mínimo privilegio); el resto se decide
   con los dominios financieros.
5. **Riesgo:** reabrir el modelo de permisos al añadir roles → el modelo (rol → permisos) ya lo admite.
6. **Impacto:** Core (tablas `roles`, `permissions`, `memberships`); Admin (gestión de membresías); Collector y Client
   más adelante.
7. **Aprobar:** los dos roles, sus permisos iniciales y quién puede asignar `tenant_admin`.

## 10. Requisitos legales bloqueantes

| Decisión | Problema | Recomendada | Riesgo | Aprobar |
|---|---|---|---|---|
| D-LEG-06 (figura jurídica de los tenants; depende de D-LEG-01) | Qué datos y validaciones exige el alta de una organización | Alta mínima (nombre, identificador fiscal opcional, país) solo en local/testing hasta la validación legal | Operar con organizaciones no autorizadas | Datos obligatorios del alta y si se permite el alta mínima en local/testing |
| D-LEG-02 (datos personales y biometría) | Qué datos personales del administrador se guardan y cómo | Mínimos: nombre, correo y teléfono opcional; la biometría queda en el sistema operativo | Tratamiento indebido de datos personales | Datos mínimos de identidad y su base legal (validación legal; no se inventan obligaciones) |

## Propuesta del primer flujo vertical (pendiente de las decisiones anteriores)

| Paso | Core (backend) | Contrato (OpenAPI) | Admin Web |
|---|---|---|---|
| 1. Alta de organización | Módulo `platform-admin` con rol `kuota_platform`: crea `tenants` y registra `tenant.create` en `platform_audit_events` | `POST /v1/platform/tenants` (plataforma, MFA) | Fuera de Admin de tenant: consola o script de plataforma (decidir) |
| 2. Invitación del primer administrador | Crea la identidad (si no existe) y una membresía `tenant_admin` pendiente; invitación de un solo uso con caducidad | `POST /v1/platform/tenants/{id}/admin-invitations` | — |
| 3. Aceptación y credenciales | Contraseña Argon2id + alta de TOTP; la invitación se consume | `POST /v1/auth/invitations/{token}/accept` (punto de entrada de autenticación) | Pantallas de aceptación, contraseña y QR de TOTP |
| 4. Inicio de sesión | Búsqueda de identidad vía función `SECURITY DEFINER`; contraseña + TOTP; emisión de access JWT y refresh opaco | `POST /v1/auth/login`, `POST /v1/auth/token/refresh`, `POST /v1/auth/logout` | Login con TOTP, sesión en memoria, renovación silenciosa |
| 5. Selección de organización | `withIdentity` lista las membresías activas; `withTenant` para todo lo demás | `GET /v1/me/memberships` | Selector de organización (si hay varias) |
| 6. Primera operación protegida | Endpoint con permiso declarado; denegación por defecto | `GET /v1/me` (perfil y permisos efectivos) | Pantalla inicial autenticada |

**Pruebas mínimas del flujo:** acceso cruzado entre dos tenants (MT-01..08), enumeración de cuentas, fuerza bruta con
límite de tasa, refresh reutilizado (revoca la familia), CSRF en la renovación, token de otro tenant rechazado,
auditoría de plataforma y de tenant separadas, y gates de 001 en verde.

**Orden sugerido una vez aprobadas las decisiones:** `/speckit-specify` (requiere autorizar la rama `feature/002-…`) →
`/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → aprobación → implementación.
