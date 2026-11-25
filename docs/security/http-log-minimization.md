# Minimización de logs HTTP de Kuota Core

- **Fecha:** 2026-11-23 (hotfix de privacidad, feature 001; Aprobación 6).
- **Estado:** implementado para los logs HTTP de la aplicación NestJS (alcance A y la parte de B que configura el
  proyecto, ver §4). Los logs de PostgreSQL y de infraestructura (C, D) siguen **pendientes de revisión de despliegue**.
- **Relacionado:**
  - FR-009 y FR-010 (logs estructurados con redacción);
  - `docs/security/audit-origin-privacy-assessment.md` §6 (hallazgo original);
  - `backend/src/common/logging/`.

## 1. Causa raíz

| Configuración | Efecto |
|---|---|
| Serializadores por defecto de pino-http (`pino-std-serializers`) | `req` copiaba `id`, `method`, la `url` con query string, `query`, `params`, **todos** los encabezados, `remoteAddress` y `remotePort`. `res` copiaba todos los encabezados de respuesta |
| Logger por solicitud `logger.child({ req })` | El `req` completo aparecía en el log de acceso **y en cada log de la aplicación** emitido durante la solicitud (por ejemplo, "Error de cliente" de `ProblemDetailsFilter`) |
| Denylist `redact` | Solo cubría `authorization`, `cookie`, `set-cookie` y los encabezados técnicos fuera de local/testing. `x-api-key`, `X-Forwarded-For`, `X-Real-IP` y cualquier encabezado nuevo quedaban expuestos |
| `formatters.log` (enmascarado de correos y secretos) | No se aplica a los *bindings* del logger hijo, por lo que un correo en la query llegaba **sin enmascarar** |

Reproducido el 2026-11-23 con valores ficticios. Antes del cambio, las 9 pruebas de
`test/integration/http-logging-privacy.spec.ts` fallan; después, pasan.

## 2. Política: lista permitida

**Líneas de acceso** (`request completed` / `request errored`):

| Campo | Contenido |
|---|---|
| `level`, `time`, `msg` | Nivel textual, hora ISO y mensaje fijo de pino-http |
| `service`, `env` | Constantes del proceso |
| `correlation_id` | UUID de la solicitud: el propagado si es un UUID válido o uno generado |
| `req` | `{ method }`. Los métodos fuera de la lista estándar se registran como `OTHER` |
| `res` | `{ statusCode }` |
| `route` | Plantilla registrada en el router (p. ej. `/v1/dev/probe-items/:id`), nunca la URL. Sin ruta coincidente (404) o sin plantilla válida: `unmatched` |
| `responseTime` | Milisegundos |
| `err` | Solo en errores: `{ type }`, la categoría. El detalle saneado lo registra `ProblemDetailsFilter` con la misma correlación |
| `tenant_id`, `actor_id` | Solo si el servidor los fijó en el CLS (comportamiento previo de FR-009). Nunca proceden de un valor no validado |

**Logs de la aplicación dentro de una solicitud:** sus propios campos (`module`, `code`, `status` y `err` saneado), más
`req: { method }` y `correlation_id`.

**Prohibido** en todas las líneas:
- **red:** direcciones IPv4/IPv6 y puertos remotos; `X-Forwarded-For`, `X-Real-IP` y `Forwarded`;
- **credenciales:** encabezados de solicitud o respuesta (`Authorization`, `Cookie`, `Set-Cookie`, API keys,
  encabezados desconocidos);
- **contenido de la solicitud:** URL cruda, query string, `params` y cuerpos de solicitud o respuesta;
- **objetos crudos:** `IncomingMessage`, `ServerResponse` o `Socket` completos.

## 3. Implementación

- **`http-log.ts`:** serializadores `req`/`res` que construyen el objeto desde cero, con `wrapSerializers: false`.
  `customSuccessObject` y `customErrorObject` añaden `route` y `correlation_id` y sustituyen el error de pino-http por
  su categoría.
- **`redaction.ts`:**
  - `sanitizeLogObject` (en `formatters.log`) sustituye por `[OMITTED:http-object]` cualquier solicitud, respuesta o
    socket que se pase por error a un log, bajo cualquier clave salvo `req`/`res`, que tienen su serializador;
  - las rutas `redact` (`req.headers`, `req.remoteAddress`, `req.remotePort`, `req.url`, `req.query`, `req.params`,
    `req.body`, `res.headers`) quedan como defensa adicional, no como mecanismo principal.
- **Coste:** constante por solicitud y menor que el anterior, porque ya no se copian los encabezados ni se analiza la
  query.
- **Pruebas:**
  - `test/unit/logging/http-log.spec.ts` (7 pruebas);
  - `test/integration/http-logging-privacy.spec.ts` (9 pruebas). Captura el JSON real de la aplicación completa sobre
    PostgreSQL 18 efímero y cubre 200, 400, 401, 404, 500, un error en una operación auditada, una operación auditada
    correcta, 30 solicitudes concurrentes y un barrido global;
  - ambas, más `redaction.spec.ts`, son suites obligatorias del job `backend`.

## 4. Alcance de la garantía

| Ámbito | Estado |
|---|---|
| **A.** Logs HTTP de la aplicación NestJS (pino-http, `ProblemDetailsFilter`, logs de módulos dentro de una solicitud) | **Minimizado y probado** |
| **B.** Dependencias y middleware configurados por el proyecto (nestjs-pino, pino-http, logger de Nest vía `useLogger`) | **Minimizado**: pasan por la misma instancia de pino y sus serializadores. Una dependencia que escriba directamente en stdout/stderr sin pasar por pino no está cubierta; no se ha identificado ninguna |
| **C.** Logs de PostgreSQL | **No revisado.** Según la configuración del servidor (`log_connections`, `log_line_prefix` con `%h`, `log_statement`), PostgreSQL puede registrar la IP del cliente y sentencias con valores. Pendiente de la revisión de despliegue (D-ARC-04) |
| **D.** Proxy inverso, balanceador, contenedores e infraestructura | **No revisado.** Normalmente registran la IP del cliente y la URL completa. Pendiente de D-ARC-04, con retención propia |

Este cambio **no** garantiza que Kuota no almacene direcciones IP en ningún sitio: C y D siguen sin auditar.

## 5. Pendientes

- **Nivel del log de acceso:** pino-http registra `request errored` con nivel `info`, porque el proyecto no define
  `customLogLevel`. Es un comportamiento previo, no modificado: el error se registra con nivel `error` en la línea de
  `ProblemDetailsFilter`. Ajustar los niveles (4xx → `warn`, 5xx → `error`) es una decisión de observabilidad aparte.
- **Retención de logs:** no definida (D-ARC-04). La retención de `audit_events` sigue siendo PENDIENTE-LEGAL.
