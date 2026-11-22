# Autenticación y gestión de sesiones

> Estado: **Propuesto** · 2026-11-22 · Decisiones: **D-AUTH-01** (clientes), **D-AUTH-02** (staff) — pendientes de aprobación.
> Principios: II (Seguridad por diseño), III (Aislamiento), XV (Protección de datos). Feature responsable: **002-identity-tenancy**.

## 1. Actores y contexto de uso

| Actor | App | Contexto | Riesgos dominantes |
|---|---|---|---|
| Staff administrativo (admin, supervisor, cajero, analista) | Kuota Admin (web) | Oficina, navegador | Phishing, robo de credenciales, abuso de privilegios |
| Cobrador | Kuota Collector (móvil) | Campo, sin red hasta 72 h, efectivo | Robo de dispositivo, fraude interno, operación offline |
| Cliente final | Kuota Client (móvil) | Personal, baja alfabetización digital posible | SIM swap, phishing/ingeniería social, dispositivo compartido |
| Operador de plataforma | Admin (módulo plataforma) | Soporte Kuota | Acceso cross-tenant |

## 2. Análisis comparativo de factores

| Factor | SIM swap | Phishing / ingeniería social | Robo de dispositivo | Dispositivo compartido | Offline | Fricción |
|---|---|---|---|---|---|---|
| OTP por SMS/WhatsApp | ❌ Vulnerable | ❌ El código se puede pedir por teléfono | ⚠️ Si el ladrón tiene SIM | ❌ | ❌ Requiere red | Media |
| PIN local (4–6 dígitos) | ✅ No depende de SIM | ⚠️ Puede revelarse | ⚠️ Protegido con límite de intentos + borrado | ⚠️ | ✅ | Baja |
| Biometría del SO | ✅ | ✅ No transferible | ✅ | ✅ | ✅ | Muy baja |
| Device binding (par de llaves en Secure Enclave/Keystore) | ✅ | ✅ El atacante no posee la llave | ⚠️ Requiere además PIN/biometría | ⚠️ | ✅ | Ninguna |
| Contraseña + MFA TOTP | ✅ | ⚠️ TOTP es phishable en tiempo real | ✅ | ✅ | ❌ | Media-alta |
| Passkeys / WebAuthn | ✅ | ✅ Resistente a phishing | ✅ | ✅ | ❌ | Baja |

Conclusión: **ningún factor aislado es suficiente**. OTP solo es aceptable para *enrolamiento y recuperación* con
controles adicionales; el uso diario se basa en **posesión del dispositivo vinculado + conocimiento/biometría**.

## 3. Recomendación por actor

### 3.1 Clientes — D-AUTH-01 (recomendado)

1. **Enrolamiento**: el tenant registra al cliente con su teléfono → la persona instala Kuota Client → OTP al teléfono
   registrado (canal SMS o WhatsApp; proveedor por definir, ver D-ARC-04) → crea PIN → el dispositivo genera un par de llaves
   (no exportable) y registra la pública en el servidor.
2. **Uso diario**: PIN o biometría desbloquea la llave del dispositivo → firma de un *challenge* del servidor → tokens.
3. **Recuperación / cambio de dispositivo**: OTP **más** un segundo control (p. ej. validación presencial con el cobrador o
   la sucursal, o preguntas de datos del préstamo), con periodo de espera configurable y notificación al dispositivo anterior.
4. Límites: 5 intentos de PIN → bloqueo temporal creciente; 10 → requiere recuperación.
5. Las operaciones sensibles (solicitud de préstamo, cambio de teléfono) requieren re-autenticación reciente.

### 3.2 Cobradores

1. **Enrolamiento del dispositivo** aprobado por un administrador del tenant (el dispositivo queda asociado al cobrador).
2. Inicio de sesión con usuario + contraseña (online) la primera vez; después **PIN local** + llave del dispositivo.
3. Operación offline: el PIN desbloquea la base local cifrada; la sesión offline expira a las **72 h** desde la última
   sincronización (D-SYNC-03), tras lo cual no se permiten nuevos cobros hasta sincronizar.
4. **Revocación y borrado remoto**: el admin puede revocar el dispositivo; al siguiente contacto con el servidor la app
   borra la base local tras intentar subir operaciones pendientes (las operaciones pendientes se suben antes del borrado
   si la llave sigue siendo válida; si el dispositivo fue reportado robado, se rechazan y pasan a REQUIRES_REVIEW).

### 3.3 Staff — D-AUTH-02 (recomendado)

- Correo + contraseña (mínimo 12 caracteres, verificación contra listas de contraseñas filtradas, hash Argon2id).
- **MFA TOTP obligatorio** para roles con permisos financieros o de configuración; passkeys como evolución preferida.
- Sesión web con cookie `HttpOnly`, `Secure`, `SameSite=Strict` y protección CSRF; expiración por inactividad (15–30 min, a definir).

### 3.4 Operadores de plataforma

MFA resistente a phishing (passkeys/llave física), acceso *break-glass* con motivo y caducidad; todo auditado.

## 4. Tokens y sesiones

| Elemento | Propuesta |
|---|---|
| Access token | JWT firmado (asimétrico, rotación de llaves con `kid`), vida corta (≈10 min). Claims: `sub`, `tenant_id`, `roles`, `device_id`, `session_id`, `amr` |
| Refresh token | Opaco, almacenado con hash en servidor, **rotación en cada uso** con detección de reutilización (reutilización ⇒ revocar toda la familia) |
| Ligado a dispositivo | Refresh tokens de móvil ligados a `device_id` y prueba de posesión de la llave del dispositivo |
| Almacenamiento móvil | Keychain (iOS) / Keystore (Android) vía almacenamiento seguro; nunca en SharedPreferences ni en la BD local sin cifrar |
| Cambio de tenant (Client) | Nuevo access token con el `tenant_id` seleccionado; validación de `customer_link` activo |
| Revocación | Lista de sesiones por identidad/dispositivo; revocación inmediata de refresh; access tokens caducan en minutos |

```mermaid
sequenceDiagram
    autonumber
    participant D as Dispositivo (Client/Collector)
    participant API as Kuota Core
    D->>API: POST /auth/challenge {device_id}
    API-->>D: nonce
    D->>D: PIN/biometría desbloquea llave privada
    D->>API: POST /auth/token {device_id, firma(nonce)}
    API->>API: Verifica firma con llave pública registrada, estado del dispositivo
    API-->>D: access (10 min) + refresh (rotativo)
    D->>API: POST /auth/refresh {refresh}
    API->>API: Rota; si refresh ya usado → revoca familia + alerta
    API-->>D: nuevo par
```

## 5. Controles transversales

- Limitación de tasa por IP, identidad y teléfono en login, OTP y recuperación; protección contra enumeración
  (respuestas idénticas exista o no la cuenta).
- OTP: 6 dígitos, vida ≤ 5 min, un solo uso, máximo de intentos, nunca en logs.
- Auditoría de: inicio/fallo de sesión, enrolamiento, cambio de PIN/teléfono, revocaciones, accesos de plataforma.
- Notificación al usuario ante nuevo dispositivo o recuperación.
- Detección de dispositivo comprometido (root/jailbreak) como **señal de riesgo**, no como único control.

## 6. Decisiones pendientes

| ID | Pregunta | Recomendación |
|---|---|---|
| D-AUTH-01 | Factores de autenticación para clientes | OTP solo para enrolamiento/recuperación + device binding + PIN/biometría |
| D-AUTH-02 | Factores para staff | Contraseña + MFA TOTP obligatorio en roles financieros; passkeys como evolución |
| D-SYNC-03 | Expiración de sesión offline del cobrador | 72 h configurable por tenant |
| D-LEG-02 | Tratamiento de datos biométricos | La biometría se queda en el SO del dispositivo; Kuota no recibe ni almacena plantillas (validar con legal) |
