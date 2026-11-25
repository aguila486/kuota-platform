# Evaluación de privacidad: `audit_events.origin` = `ip-hash:<sha256(IP)>`

- **Fecha:** 2026-11-23 (cierre de US6, feature 001). **Actualización (2026-11-23, Aprobación 5):**
- **Estado:** **RESUELTO POR MINIMIZACIÓN.**
  - Desde la Aprobación 5, `origin` es el origen lógico `http`. `AuditActorGuard` ya no lee la IP y `AuditService`
    rechaza cualquier valor fuera de `AUDIT_ORIGINS`.
  - No se adoptó HMAC.
  - Los eventos anteriores con `ip-hash:` se conservan intactos (append-only). En 001 solo hay datos sintéticos.
  - Las secciones 1–4 describen la situación previa y se mantienen como registro del análisis.
  - Ver §6.
- **Relacionado:** FR-025, data-model.md `audit_events.origin` (enmienda del 2026-11-23), `docs/security/privacy.md`,
  `backend/src/common/audit/audit-actor.guard.ts`.

## 1. Situación actual (código inspeccionado)

- **Dónde se genera:** `AuditActorGuard.canActivate` guarda en CLS
  `origin = "ip-hash:" + hex(SHA-256(UTF-8(req.socket.remoteAddress ?? 'desconocida')))`, y `AuditService.record()` lo
  escribe en `audit_events.origin` (`NOT NULL`).
- **IP utilizada:** la del socket TCP. No se configura `trust proxy` ni se lee `X-Forwarded-For`. Detrás de un proxy o
  balanceador, `origin` sería el hash de la IP del proxy, no la del cliente.
- **Usos:**

| Interviene en | ¿Usa `origin`? |
|---|---|
| Identidad de idempotencia (`request_hash` = método, ruta y body; bloqueo = tenant y clave) | No |
| Métricas (US1 aún no implementadas) y logs | No |
| Auditoría, para correlacionar eventos de un mismo origen de red | Sí, es su único uso |

- **Retención:** `audit_events` es append-only y no tiene política de retención ni seudonimización definidas.
  `docs/security/privacy.md` marca los plazos como PENDIENTE-LEGAL. El valor persiste indefinidamente.

## 2. Riesgo

- **IPv4 se puede reconstruir:** el espacio es de 2³² ≈ 4,3·10⁹ valores. Un SHA-256 sin secreto se invierte con una
  búsqueda exhaustiva en minutos con hardware común, o con una tabla precalculada. Quien lea `audit_events` (un
  operador, una copia de seguridad, una fuga de la base) obtiene la IP en claro.
- **IPv6:** la enumeración completa no es viable, pero los prefijos y las asignaciones de proveedores reducen mucho el
  espacio. Tampoco es una seudonimización robusta.
- **Clasificación:** dato personal seudonimizado de forma débil. Además, es inútil detrás de un proxy, porque hoy se
  guarda la IP del proxy.

## 3. Propuesta (requiere decisión antes de implementarse)

### 3.1 Minimizar primero

Antes de cambiar el algoritmo, decidir si el dato es necesario:
- **(a)** Si solo se usa para correlacionar eventos de una misma sesión de red, basta un identificador por solicitud,
  que ya existe: `correlation_id`.
- **(b)** Desde 002, el origen útil es `device_id` (apps) o `job` (procesos), y la IP solo para seguridad (002).

**Recomendación:** mantener `ip-hmac` solo si la seguridad de 002 lo justifica. Si no, registrar
`origin = "http"`/`device_id`/`job` sin IP.

### 3.2 Sustituir por HMAC-SHA-256 con un secreto gestionado

- **Formato versionado:** `origin = "ip-hmac:v<k>:" + hex(HMAC-SHA-256(K_k, ip_normalizada))`. Truncar a 32 hex
  (128 bits) es opcional.
- **Normalización de la IP:**
  - IPv4 mapeada a IPv6 (`::ffff:a.b.c.d`) se convierte en `a.b.c.d`;
  - IPv6 se convierte a su forma canónica (RFC 5952);
  - opcionalmente, se trunca a /24 en IPv4 o /48 en IPv6 si basta con el origen aproximado.
- **El secreto `K_k`:**
  - Variable de configuración nueva, por ejemplo `KUOTA_AUDIT_ORIGIN_KEY_V<k>`, de al menos 32 bytes aleatorios.
  - Gestionada por el gestor de secretos del despliegue (D-ARC-04). Nunca en el repositorio; en `.env.example`, un valor
    ficticio.
  - La validación de configuración exige el secreto cuando hay auditoría y rechaza valores débiles, como ya se hace con
    `KUOTA_METRICS_TOKEN`.
- **IP real detrás de proxies:** configurar `trust proxy` con la lista explícita de proxies del despliegue
  (D-ARC-04). Nunca confiar en `X-Forwarded-For` sin esa lista.

### 3.3 Versionado, rotación y despliegue

- **Versionado:**
  - El prefijo `ip-hmac:v<k>:` identifica el algoritmo y la clave. Los registros existentes `ip-hash:` no se reescriben,
    porque `audit_events` es append-only.
  - Para correlacionar eventos entre versiones, un operador autorizado calcula el valor con cada clave vigente.
- **Rotación:**
  - Se introduce `K_{k+1}`: escribir con la versión nueva y conservar `K_k` solo mientras sea necesario correlacionar.
  - Destruir `K_k` seudonimiza definitivamente los registros de esa versión. Es un borrado criptográfico, útil para
    cumplir la retención sin tocar la tabla append-only.
- **Despliegue (expand → contract, Constitución XIV):**
  1. añadir la configuración y el código que escribe `ip-hmac:v1`, con pruebas que comprueben que nunca aparece una IP
     ni un `ip-hash`;
  2. documentar el cambio de semántica de `origin` en data-model.md;
  3. definir la retención de `audit_events` (PENDIENTE-LEGAL).

  No requiere migración de esquema: `origin` es `text NOT NULL`.

### 3.4 Datos ya existentes

En 001 solo hay datos sintéticos (dev-probe, local/testing). No hay registros reales que migrar. Antes de 002 conviene
confirmar que ningún entorno persistente contiene eventos con IPs reales.

## 4. Recomendación (2026-11-23, Aprobación 4; sin implementar)

- **¿Hay necesidad funcional o contractual de un identificador derivado de la IP?** No.
  - El contrato OpenAPI no expone `origin` en ninguna operación.
  - FR-025 exige registrar el *origen*, no la IP.
  - Ningún flujo de 001 (idempotencia, métricas, autorización) usa `origin`.
  - El único requisito escrito es la nota de data-model.md (`origin`: "ip-hash / device_id / job"), una decisión de
    diseño enmendable, no una regla de negocio.
- **Recomendación: minimizar.**
  - Para solicitudes HTTP, registrar un origen sin datos de red (por ejemplo `http`, y `device_id` o `job` cuando
    existan en 002 y 011), y eliminar el derivado de la IP.
  - Requiere una enmienda de data-model.md y un cambio de `AuditActorGuard`, ambos pendientes de aprobación.
  - Usar HMAC versionado (§3.2) solo si 002 justifica la IP para seguridad (detección de abuso, investigación de
    incidentes), con el secreto gestionado según D-ARC-04.
- **Efecto:**
  - **Auditoría:** se pierde la correlación por red entre eventos. La correlación por solicitud (`correlation_id`) y
    por actor se mantiene.
  - **Soporte:** las investigaciones por IP dependerían de los logs del borde y del proxy, con su propia retención
    acotada, en lugar de una tabla append-only sin plazo.
  - **Retención:** al no guardar un dato personal en `audit_events`, que no puede borrarse, el problema de la retención
    indefinida de IPs desaparece. Si se adopta HMAC, destruir la clave antigua seudonimiza de forma irreversible los
    registros de esa versión.

## 5. Decisiones pendientes (responsable del proyecto)

1. Minimizar (sin IP) o seudonimizar con HMAC.
2. Introducir el secreto nuevo y quién lo gestiona (D-ARC-04).
3. Lista de proxies de confianza.
4. Retención de `audit_events` (PENDIENTE-LEGAL).

## 6. Resolución (2026-11-23, Aprobación 5) y hallazgo adicional

- **Decisión 1:** minimizar.
  - `origin` = `http` para toda operación HTTP auditada. El guard no consulta `req.ip`, `socket.remoteAddress` ni
    encabezados de proxy.
  - `AuditService` solo acepta valores de la lista `AUDIT_ORIGINS`.
  - Pruebas sobre PostgreSQL 18 (`test/integration/audit.spec.ts`, bloque "origin lógico sin datos de red"):
    - CREATE, UPDATE y DELETE con `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `X-Client-IP` y `True-Client-IP`
      guardan `http` y ningún valor de red;
    - el origen no se puede fijar por body, query ni encabezado;
    - sin actor → 400 sin escritura;
    - un evento histórico con `ip-hash:` queda intacto;
    - un barrido de la tabla no encuentra IP ni hash de IP en los eventos de la aplicación.
- **Decisiones 2 y 3 (secreto HMAC y lista de proxies):** ya no aplican a `audit_events`.
  - Si 002 justifica la IP para seguridad, deberá decidirse aparte, fuera de esta tabla.
- **Decisión 4 (retención de `audit_events`):** sigue PENDIENTE-LEGAL.
- **Hallazgo adicional (PENDIENTE de decisión; no corregido porque está fuera del alcance autorizado): el log de acceso
  registra datos de red.**
  - **Qué se observa:** pino-http usa su serializador de solicitudes por defecto. Cada línea `request completed`
    incluye `req.remoteAddress`, `req.remotePort` y **todos** los encabezados no redactados, incluidos
    `X-Forwarded-For` y `X-Real-IP`.
  - **Evidencia:** verificado el 2026-11-23 levantando el build en local con `GET /health/live` y
    `X-Forwarded-For: 198.51.100.23`; la línea contenía `remoteAddress: ::ffff:127.0.0.1` y ambos encabezados.
  - **Alcance:** no afecta a `audit_events`. Es una exposición en los logs, que tienen otra retención (D-ARC-04).
  - **Propuesta:**
    - un serializador `req` mínimo (método, ruta sin query y `correlation_id`);
    - o redactar `req.remoteAddress`, `req.remotePort` y los encabezados de red;
    - con pruebas en `test/unit/logging/` y `test/integration/app-bootstrap.spec.ts`.

    Requiere autorización.


## 7. Hallazgo del log de acceso: resuelto (2026-11-23, Aprobación 6)

- **Corrección:** serializadores mínimos por lista permitida en pino-http. Detalle de la causa raíz, la política, las
  pruebas y el alcance en `docs/security/http-log-minimization.md`.
- **Fuera de esta garantía:** los logs de PostgreSQL y de infraestructura, pendientes de la revisión de despliegue
  (D-ARC-04).
