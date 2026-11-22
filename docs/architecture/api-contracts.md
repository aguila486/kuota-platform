# Contratos de API (backend ↔ Flutter)

> Estado: Propuesto (2026-11-22). Constitución XII (Contract-First) y XIV (Evolución compatible).

## 1. Principio

Backend (TypeScript) y apps (Dart) **no comparten clases**. Comparten un **contrato OpenAPI 3.1** versionado en el
repositorio, que se modifica **antes** que el código. El backend se prueba contra el contrato; el cliente Dart se
genera desde él. El backend es la autoridad de las operaciones financieras: el contrato expone resultados
confirmados, nunca acepta saldos calculados por el cliente como verdad.

## 2. Estructura

```text
contracts/
└── openapi/
    ├── kuota-core.v1.yaml        # documento raíz (bundle)
    ├── paths/                    # un archivo por recurso
    ├── components/
    │   ├── schemas/              # Money, Rate, Problem, Cursor…
    │   ├── parameters/           # IdempotencyKey, AppVersion…
    │   └── responses/
    └── redocly.yaml              # lint (reglas propias) y bundles; research R-13 de 001
```

## 3. Convenciones

| Tema | Convención |
|---|---|
| Versionado | Prefijo de ruta `/v1`. Cambios compatibles dentro de v1; incompatibles → `/v2` con convivencia (ventana D-ARC-05) |
| Nombres | Rutas en plural kebab-case; propiedades JSON `snake_case`; enums `UPPER_SNAKE_CASE` |
| IDs | UUID string |
| Fechas | `date` (`YYYY-MM-DD`, fecha de negocio en zona del tenant) y `date-time` (RFC 3339 UTC) |
| Dinero | Objeto `Money` (ver §4) |
| Idempotencia | Header `Idempotency-Key` (8–128 caracteres `[A-Za-z0-9_-]`, recomendado UUIDv7) **obligatorio** en toda escritura financiera; lo genera el cliente al crear la operación y lo reutiliza en cada reintento (ADR-0003). Comandos offline usan `operation_id` en el body. Clave reutilizada con otro contenido → `422`; en proceso → `409` + `Retry-After` |
| Errores | RFC 9457 `application/problem+json` con `type`, `title`, `status`, `detail`, `code`, `correlation_id`, `errors[]` (validación) |
| Paginación | Por cursor: `?limit=50&cursor=<opaco>` → `{ "data": [...], "next_cursor": "..." }`. Sin offset |
| Correlación | `X-Correlation-Id` (UUID del cliente o generado), devuelto en la respuesta, en logs y en `correlation_id` de problem+json |
| Versión de app | Header `X-App-Version` (`collector/1.4.2+120`). Si es menor que la mínima soportada → `426 Upgrade Required` con problem `app-version-unsupported` |
| Concurrencia | `ETag`/`If-Match` en configuraciones editables (productos, planes) |
| Tenant | Implícito en el token. Nunca como parámetro de ruta en la API de tenants |
| Seguridad | Esquema `bearerAuth` (JWT, desde 002); cada operación declara `security` explícitamente y su permiso con `x-kuota-permission`. No hay `security` global; `security: []` solo en excepciones públicas registradas en *Endpoint Access* (Constitución §II) |

## 4. Representación del dinero

```json
{ "amount_minor": "150000", "currency": "MXN" }
```

- `amount_minor`: **string** en forma canónica (`^(0|-?[1-9][0-9]{0,18})$`, dentro del rango de `BIGINT`) en unidades
  mínimas de la moneda. Se usa string porque JavaScript/Flutter Web pierden precisión en enteros > 2^53 y para impedir
  que cualquier capa lo trate como float. Reglas completas: ADR-0007.
- `currency`: ISO 4217. El número de decimales de la moneda se obtiene de la tabla ISO, no del payload.
- Tasas: `{ "value": "0.0900000000", "basis": "TOTAL" }` con `value` string decimal y `basis` de D-FIN-03.
- Prohibido en el contrato: `type: number` para montos o tasas (regla de Redocly, research R-13 de 001).

## 5. Generación del cliente Dart

**Decisión propuesta:** `openapi-generator` con generador **`dart-dio`** (serialización `json_serializable`),
fijado por versión en un contenedor/herramienta reproducible, salida en `flutter/packages/api_client/lib/src/generated/`
(marcado como generado en `.gitattributes`).

| Alternativa | Pros | Contras |
|---|---|---|
| openapi-generator `dart-dio` | Maduro, soporta OpenAPI 3.x, interceptores Dio para auth/idempotencia | Requiere JVM o Docker en generación; código verboso |
| `swagger_parser` (Dart) | Puro Dart, salida limpia | Menor cobertura de casos de OpenAPI 3.1 |
| Escribir a mano | Control total | Viola Contract-First; deriva |

Se valida en el spike de 001; si `dart-dio` no maneja bien 3.1, se emite el contrato en 3.0.3 o se evalúa
`swagger_parser` (decisión registrada en `research.md` de 001).

`Money` se mapea a un tipo propio de `financial_domain` mediante mapeadores en las apps, no en el código generado.

## 6. Validación y compatibilidad en CI

| Verificación | Herramienta | Bloquea PR |
|---|---|---|
| Lint y reglas de estilo | Redocly CLI 2 (`contracts/openapi/redocly.yaml`, research R-13) | Sí |
| Cambios incompatibles vs `main` | `oasdiff breaking` | Sí (salvo nueva versión mayor aprobada) |
| Backend cumple el contrato | Pruebas de contrato (validación de requests/responses con ajv contra el bundle) | Sí |
| Cliente Dart actualizado | Regenerar y `git diff --exit-code` | Sí |
| Ejemplos válidos | Validación de `examples` contra esquemas | Sí |

## 7. Ciclo de un cambio de contrato

1. Spec de la feature define el comportamiento → `plan.md` define cambios de contrato en `specs/NNN/contracts/`.
2. Se actualiza `contracts/openapi/` en el mismo PR (o PR previo) que el backend.
3. CI valida compatibilidad, regenera cliente, corre pruebas de contrato.
4. Las apps consumen el cliente regenerado; apps antiguas siguen funcionando hasta la versión mínima soportada.
