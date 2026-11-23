# Research: Platform Foundation (001)

**Fecha**: 2026-11-22 · **Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Versiones verificadas el 2026-11-22 contra los registros públicos (npm, pub.dev, nodejs.org, flutter releases,
GitHub releases). Las versiones exactas se fijan en lockfiles durante la implementación; aquí se fija la **línea mayor**.

| Herramienta | Versión verificada | Línea fijada |
|---|---|---|
| Node.js | v26.13.1 (Active LTS "Lithium"); v24.22.3 (Maintenance LTS) | **26 LTS** (`.nvmrc`, `engines`) |
| pnpm | 12.21.0 | **12.x** vía `corepack` (`packageManager`) |
| NestJS (`@nestjs/core`, CLI) | 12.6.0 / 12.0.15 | **12.x** |
| TypeScript | 7.0.2 (compilador nativo) | **7.0.x** solo typecheck (ver R-02) |
| Prisma | 7.10.1 (estable; `latest` apunta a 8.0.0-rc) | **7.10.x** + `@prisma/adapter-pg` 7.10.x |
| PostgreSQL | 18 (estable madura; 19 reciente) | **18** (imagen `postgres:18` fijada por digest) |
| Vitest | 5.1.1 | **5.x** |
| fast-check | 4.11.0 | 4.x |
| Testcontainers (`@testcontainers/postgresql`) | 12.2.2 | 12.x |
| decimal.js | 10.6.0 | 10.x |
| nestjs-cls / nestjs-pino / pino | 7.0.2 / 5.3.2 / 10.4.0 | mayores vigentes |
| dependency-cruiser | 18.8.0 | 18.x |
| @redocly/cli | 2.82.0 | 2.x |
| @stoplight/spectral-cli | 6.17.1 | 6.x |
| oasdiff | v1.39.0 | 1.39.x (binario/imagen fijada) |
| gitleaks | v8.30.1 | 8.30.x |
| Flutter / Dart | 3.50.1 stable / 3.14.0 (2026-11-20) | **3.50.1** vía FVM (`flutter/.fvmrc`) |
| FVM | 4.3.2 publicado; **3.2.1 instalado** | ≥ 3.2 (D-ENV-01 aprobada) |
| Melos | 8.10.1 (requiere Dart ^3.9) | **8.x** |
| riverpod / flutter_riverpod | 3.5.0 | 3.x |
| decimal (Dart) | 3.2.6 | 3.x |
| drift | 2.35.4 | (no se usa en 001; 011) |
| glados | 1.1.7 | 1.x (property-based Dart) |
| dio | 5.11.1 | 5.x (lo trae el cliente generado) |

---

## R-01 · Runtime de Node: 24 vs 26 LTS

- **Decision**: Node **26 LTS**.
- **Rationale**: Node 26 está en *Active LTS* y su soporte termina un año después que Node 24, que ya está en
  *Maintenance*. Para un proyecto nuevo con horizonte multianual reduce una migración de runtime. Instalarlo con
  `nvm install 26` es por usuario y no afecta Node 24 (se mantiene para otros proyectos).
- **Alternatives considered**: Node 24 (instalado hoy; menor runway). Se actualizaron ADR-0002, overview, README.
- **Implementación (G1, 2026-11-22)**: `.nvmrc` fija **26.13.1** (Latest LTS en nodejs.org). Node 26 **ya no incluye
  Corepack** (verificado: `corepack: command not found` tras `nvm install`); se instala `corepack@0.36.0`
  (`nodejs/corepack`, `engines` ≥ 26) con `npm i -g` **dentro del Node 26 de nvm**, sin tocar otras versiones. pnpm
  queda fijado en **12.21.0** (`latest` y `latest-12` en npm; 12.22/12.23 son `next`). El alias `default` de nvm se
  fijó en 24.18.0 para que la instalación de Node 26 no cambie el Node por defecto de otros proyectos.

## R-02 · TypeScript 7 (compilador nativo) con decoradores de NestJS

- **Decision**: TypeScript **7.0.x** para *typecheck* (`tsc --noEmit`) y **SWC** como compilador de emisión (Nest CLI
  `builder: "swc"`, `typeCheck: false`) y transformador en pruebas (`unplugin-swc` en Vitest), con
  `decoratorMetadata: true`.
- **Rationale**: La inyección de dependencias de NestJS requiere metadatos de decoradores; SWC los emite de forma
  estable y es significativamente más rápido. El typecheck queda desacoplado de la emisión.
- **Risk / fallback**: Si TS 7 presentara incompatibilidades de tipos con `@nestjs/*` 12, se fija la última 6.x en la
  tarea de scaffolding y se registra en este documento. Criterio de verificación: `pnpm typecheck` limpio sobre el
  esqueleto.
- **Resultado en T007 (2026-11-22): fallback aplicado, TypeScript 6.0.3.** TS 7.0.2 sí pasa el typecheck del esqueleto
  (`pnpm dlx --package=typescript@7.0.2 tsc --noEmit`, exit 0), pero la cadena de herramientas no lo admite:
  `typescript-eslint` 8.73.0 (el último) declara `typescript >=4.8.4 <6.1.0`, y lo necesita el lint con tipos de T009;
  `@nestjs/cli` 12.0.15 depende de `typescript ~6.0.2`. Se usa una sola versión (6.0.3) para typecheck, lint y CLI. SWC
  sigue siendo el emisor. **Revisión:** volver a TS 7 cuando `typescript-eslint` y `@nestjs/cli` lo admitan.
- **Alternatives considered**: `tsc` como emisor (más lento, misma salida); `esbuild` (no emite metadatos de decoradores).

## R-03 · Runner de pruebas TypeScript: Vitest vs Jest

- **Decision**: **Vitest 5** con `unplugin-swc`, cobertura `v8` y umbrales por glob.
- **Rationale**: Arranque y modo watch más rápidos, soporte nativo de ESM/TS, umbrales de cobertura por patrón
  (necesario para "dominio financiero ≥ 90 %, resto ≥ 80 %", Constitución X), compatible con fast-check y Testcontainers.
- **Alternatives considered**: Jest 30 (default histórico de NestJS; configuración ESM/TS más pesada, sin ventaja
  diferencial). `node:test` (ecosistema de cobertura/mocks insuficiente).

## R-04 · ORM y RLS — spike D-ARC-01 (Prisma)

- **Decision**: **Prisma 7.10.1 con `@prisma/adapter-pg`** (driver `pg` nativo). **Aceptado con condiciones en T015**
  (2026-11-22, D-ARC-01; ADR-0004 §Condiciones de la aceptación) tras superar S1–S6 en el spike T014.
  Patrón: `TenantPrismaService.withTenant(fn)` abre `$transaction` interactiva y ejecuta como primera sentencia
  `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)`; todo acceso a tablas de tenant pasa
  por `withTenant`. Una regla de lint prohíbe usar el cliente Prisma "crudo" fuera de `common/tenant-context`.
- **Rationale**: Prisma 7 con *driver adapter* usa un pool `pg` controlado por nosotros y elimina el motor Rust, lo que
  simplifica razonar sobre conexiones; `set_config(..., true)` es local a la transacción y desaparece al devolverse la
  conexión al pool (sin fugas). Migraciones declarativas + SQL crudo para políticas RLS, roles y triggers.
- **Anidamiento y propagación** (ADR-0002, C2-1): el cliente transaccional vive en CLS; `withTenant` anidado con el mismo
  tenant reutiliza la transacción, con otro tenant lanza error y revierte todo; sin *savepoints*. Implementación:
  `@nestjs-cls/transactional` 4.x + adaptador Prisma 2.x o equivalente propio; se decide con el criterio S5.
- **Criterios de aceptación del spike** (definición completa, configuración y regla de decisión en
  `docs/decisions/ADR-0004-database-orm.md` §Validación; resultado en T015):
  - S1 contexto ausente → 0 filas sin error, también en una conexión que ya ejecutó `withTenant`;
  - S2 ≥ 50 solicitudes de 2 tenants con pool de 2–5, 0 filas cruzadas y reutilización demostrada de `pg_backend_pid()`;
  - S3 privilegios de `kuota_app_login` (sin `UPDATE`/`DELETE` en `audit_events`, sin DDL, `WITH CHECK` en `INSERT`);
  - S4 ruta de error (rollback y conexión limpia);
  - S5 anidamiento (misma transacción; error con otro tenant);
  - S6 migraciones solo con `kuota_migrator`;
  - S7 SQL crudo (y TypedSQL si se adopta) respeta RLS;
  - S8 latencia registrada (referencia; umbral de reevaluación pendiente de aprobación).
- **Fallback**: si falla S1–S4 o S6, **Kysely** 0.29 (`kysely-codegen` para tipos, migraciones SQL versionadas) con
  ADR-0004 actualizado antes de continuar con US2; debe superar los mismos criterios. TypedSQL no se usa sin S7.
- **Alternatives considered**: Drizzle (viable; menor madurez en migraciones con SQL personalizado), Kysely (fallback),
  TypeORM (descartado).
- **Ejecución del spike (T014, 2026-11-22)**: Prisma **7.10.1** (último estable de la serie 7; la etiqueta `latest` del CLI
  apunta a `8.0.0-rc.34`) y `@prisma/adapter-pg` 7.10.1, en `devDependencies` hasta T015. `prisma` (preinstall) y
  `@prisma/engines` (postinstall, descarga `schema-engine` para `migrate`) quedan permitidos en `allowBuilds`; se
  retiran si T015 elige Kysely. Resultado: S1–S8 en PASS; `prisma migrate deploy` no es transaccional por migración
  (MIG-TX). Detalle, cifras y condiciones en `specs/001-platform-foundation/spike-t014-report.md`. La decisión es de T015.
- **Implementación (G7a: T038, T039, T043, 2026-11-22)**:
  - `TenantPrismaService.withTenant(fn)` (`src/common/tenant-context/tenant-prisma.service.ts`) sigue el patrón del
    spike con nestjs-cls en lugar de un `AsyncLocalStorage` propio (ADR-0002 admite "equivalente propio"; no se añade
    `@nestjs-cls/transactional`). El tenant sale de `TenantContext`, nunca de un argumento; sin contexto lanza antes de
    tocar la base. Primera sentencia: `set_config('app.tenant_id'|'app.actor_id'|'app.correlation_id', …, true)`. La
    transacción activa se guarda bajo un símbolo privado en un contexto CLS hijo (`ifNested: 'inherit'`), así que
    desaparece al terminar y nadie fuera del servicio puede sustituirla. Anidamiento C2-1: mismo tenant → misma
    transacción; otro → `TenantContextMismatchError` y rollback total.
  - **Control nuevo (no estaba en el spike):** antes del COMMIT se comprueba que `app.tenant_id` sigue siendo el del
    contexto; si un `set_config` crudo lo cambió (riesgo S5), se revierte todo. Límite: no deshace lecturas ya hechas.
  - `TenantTransaction` = cliente transaccional de Prisma sin `$queryRawUnsafe`, `$executeRawUnsafe` ni
    `$transaction` (Prisma deja `$transaction` en el cliente transaccional). El `PrismaClient` base es privado.
    `transaction()` da a los repositorios el cliente activo o lanza `TenantTransactionRequiredError`.
  - Pool `pg` propio con `DATABASE_URL_APP`; `maxWait` 5 s y `timeout` 15 s por defecto (constantes; no hay variables
    de entorno nuevas). Un error de conexión inactiva se registra y no termina el proceso.
  - **Prisma:** el cliente se genera en `src/generated/prisma` (antes `generated/prisma`): el build SWC solo compila
    `src/`, y el runtime ahora importa el cliente. `prisma:generate` se ejecuta en `dev`, `build`, `typecheck`, `lint` y
    `test`; el código generado sigue sin versionarse. `@prisma/client` y `@prisma/adapter-pg` pasan a dependencias de
    runtime (mismas versiones exactas 7.10.1; sin scripts de instalación nuevos, P8 sin cambios). No cambia ningún
    modelo ni la migración.
  - Controles estáticos nuevos: eslint prohíbe fuera de `tenant-context` escribir las claves CLS `tenantId`, `actorId`,
    `actorType` y `actorRole` e importar `establish-context`; dependency-cruiser restringe el cliente Prisma generado y
    `@prisma/*` a `tenant-context` y `establish-context` a `tenant-context`. Todas las reglas tienen pruebas que las
    disparan.
  - `db:check-rls` (`backend/scripts/check-rls.ts`, ejecutado con el soporte nativo de TypeScript de Node 26): además del
    criterio de T043 (RLS habilitado, forzado y con política, lista blanca vacía) verifica que cada política compare
    `tenant_id` con `app.tenant_id` y aplique a `kuota_app`, propietario `kuota_migrator`, sin privilegios de PUBLIC,
    sin `TRUNCATE`/`TRIGGER` para el runtime, y roles de runtime sin superusuario, BYPASSRLS, propiedad ni `CREATE`.
    La deriva del esquema respecto a las migraciones sigue siendo responsabilidad de las pruebas de P4.
  - **Estado de P2 (registro; ADR-0004 no se modifica en G7a):** controles estáticos ampliados y probados; `withTenant`
    definitivo con verificación en runtime antes del COMMIT. Sigue **parcial**: falta el gate de CI (G12) y la fuente
    confiable de identidad (002); el lint no detecta SQL concatenado ni funciones de base de datos.

## R-05 · Mecanismo técnico (no productivo) de contexto de tenant

- **Decision**: En 001 el contexto se obtiene de los encabezados `X-Kuota-Dev-Tenant` (UUID) y `X-Kuota-Dev-Actor`,
  aceptados **solo** si `KUOTA_DEV_TENANT_CONTEXT=enabled` **y** `KUOTA_ENV ∈ {local, testing}`. Si la variable está
  habilitada con `KUOTA_ENV ∈ {staging, production}`, el proceso **falla al arrancar**. El guard (`DevTenantGuard`) pone
  el contexto en `nestjs-cls` (AsyncLocalStorage) igual que lo hará el guard JWT de 002, de modo que el resto del código
  no cambia al reemplazarlo.
- **Rationale**: Permite probar FR-012..FR-017 sin adelantar identidad (002). El fallo al arrancar es un control
  verificable (prueba de configuración).
- **Alternatives considered**: JWT firmados con llave de desarrollo (adelanta decisiones de 002); fijar tenant por
  variable de entorno (no permite pruebas de acceso cruzado en el mismo proceso).
- **Implementación (G7a: T038, 2026-11-22)**: `DevTenantGuard` lee solo `X-Kuota-Dev-Tenant` (UUID; se normaliza a
  minúsculas; el UUID nulo, un valor repetido o malformado → 401 `tenant-context-required` sin reflejarlo) y
  `X-Kuota-Dev-Actor` (opcional; inválido → 400 `validation-error`). Con el mecanismo deshabilitado responde siempre 401.
  `actorType = 'DEV'` lo fija el servidor y `actorRole` es siempre `null` (lectura de T038 alineada con data-model:
  `actor_type = DEV` en 001; `actor_role` NULL). Sin actor, `actorId` es `null` y `app.actor_id` queda vacío: la regla
  de actor por defecto para la auditoría la decide US6. El contexto es inmutable dentro de la solicitud
  (`TenantContextConflictError`). Una ruta de datos sin guard falla cerrada (500 `internal-error`).

## R-06 · Idempotencia

- **Decision**: Tabla `idempotency_keys` con PK `(tenant_id, key)`, `request_hash` (SHA-256 de método + ruta + cuerpo
  canónico), `status` (`IN_PROGRESS`|`COMPLETED`), respuesta almacenada, `expires_at` (30 días). Flujo:
  en una sola transacción del tenant, `pg_try_advisory_xact_lock(hash(tenant_id, key))`; si el bloqueo no se obtiene
  → `409` problem `idempotency-request-in-progress` + `Retry-After: 1`; si se obtiene: fila vigente con hash distinto
  → `422` problem `idempotency-key-reused`; fila vigente `COMPLETED` → respuesta almacenada con encabezado
  `Idempotent-Replayed: true`; fila expirada → se elimina y se procesa como nueva; sin fila → `INSERT` `IN_PROGRESS`,
  comando, `COMPLETED` y commit. Interceptor NestJS
  `@Idempotent()` reutilizable. Purga por expiración: tarea manual/script en 001 (job programado se difiere).
- **Rationale**: Garantiza un único efecto con concurrencia (bloqueo consultivo + PK), aislado por tenant (RLS también
  aplica). Corrección del 2026-11-22 (U1): con `INSERT … ON CONFLICT` dentro de la misma transacción, los duplicados
  concurrentes esperaban el commit en vez de recibir 409, lo que contradecía el contrato; el bloqueo consultivo hace
  observable el estado "en proceso" sin dejar filas huérfanas. Política solo para 001 (FR-024): 007/011 la revisan.
- **Alternatives considered**: `INSERT … ON CONFLICT` en una transacción corta separada (deja filas `IN_PROGRESS`
  huérfanas tras una caída y requiere recuperación por tiempo); Redis `SET NX` (Redis no está justificado aún, Constitución: Redis solo con justificación).

## R-07 · Auditoría append-only

- **Decision**: Tabla `audit_events` con RLS por tenant; `kuota_app` tiene solo `INSERT`/`SELECT`; además trigger
  `BEFORE UPDATE OR DELETE` que lanza excepción (defensa en profundidad, también contra `kuota_migrator` salvo
  desactivación explícita en migración revisada). Servicio `AuditService.record()` que escribe en la **misma
  transacción** del comando.
- **Rationale**: Constitución VII; misma transacción → no hay efecto sin auditoría ni auditoría sin efecto.
- **Alternatives considered**: Tabla particionada/hash encadenado (se evalúa en 006/015; no necesario en 001).

## R-08 · Primitiva monetaria y librerías decimales

- **Decision**:
  - **TypeScript**: `Money { amountMinor: bigint; currency: CurrencyCode }` inmutable; catálogo ISO 4217 mínimo con
    `minorUnits` (MXN=2 como ejemplo; sin asumir país). Operaciones: `add/subtract` (misma moneda),
    `multiply(factor: Decimal, rounding: RoundingMode)`, `allocate(n | ratios)` (método del mayor residuo, suma exacta),
    `parse/format` desde string. Intermedios con **decimal.js 10** en una instancia clonada
    (`Decimal.clone({ precision: 40 })`) — nunca la global — y modo de redondeo **obligatorio** por operación.
  - **Dart**: `Money` con `BigInt amountMinor` y paquete **`decimal` 3.x** (racional exacto) para factores; misma API y
    mismos modos (`HALF_UP`, `HALF_EVEN`, `DOWN`, `UP`, `FLOOR`, `CEILING`).
- **Rationale**: Constitución IV; enteros en unidades mínimas evitan errores binarios; `bigint` supera el rango seguro de
  `number` (escenario US4-4).
- **Representación aprobada** (D-FIN-01, ADR-0007): rango de `BIGINT` como invariante en ambos lados
  (`AMOUNT_OUT_OF_RANGE`); JSON `amount_minor` en forma canónica (`^(0|-?[1-9][0-9]{0,18})$`); catálogo de monedas en
  código con copia de referencia `contracts/fixtures/money/currencies.json` (`UNSUPPORTED_CURRENCY`); `allocate` por
  mayor residuo con empates por índice; `format` canónico sin localización. En Dart, `BigInt` también en web.
- **Alternatives considered**: dinero.js 2 (API orientada a formato; menos control explícito del redondeo); big.js
  (sin precisión configurable por instancia en la forma requerida).
- **Implementación (US4 backend: T056, T057, T061, T064; T062 parcial; 2026-11-22)**:
  - `backend/src/common/money/` (API pública en `index.ts`): `Money.of/zero/parse`, `add`, `subtract`,
    `multiply(factor: Decimal, rounding?)`, `allocate(n | ratios)`, `format`, `equals`, `toJSON`; `MoneyError` con los
    seis códigos de ADR-0007; `ROUNDING_MODES`; catálogo `CURRENCIES`; `moneyFromJson`/`moneyToJson`;
    `parseMoneyField(valor, campo)` para la frontera HTTP (400 `validation-error`, `errors[{field, message}]` con el
    código y sin reflejar el valor). `decimal.js` **10.6.0** (dependencia de runtime, exacta, sin dependencias ni
    scripts de instalación).
  - **Exactitud:** los montos nunca pasan por `number`. `multiply` toma el valor exacto del factor (`Decimal` en la
    instancia clonada `precision: 40`) como fracción y calcula el producto y el redondeo con `bigint`. Así un monto de
    19 dígitos por un factor largo no redondea ningún intermedio (`precision: 40` lo haría). Hay un fixture con un producto
    de 49 dígitos significativos.
  - **Catálogo:** solo las monedas que nombran los documentos aprobados (BHD 3, CLF 4, JPY 0, MXN 2, USD 2; R-08 pide un
    catálogo mínimo). Ampliarlo es D-LEG-01.
  - **Orden de validación** (en `of`, `parse` y `from_json`): moneda → forma → dominio.
  - **Interpretaciones a confirmar (no están fijadas en ADR-0007; Dart deberá replicarlas en T063):**
    - `parse` usa la gramática `-?(0|[1-9][0-9]*)(\.[0-9]+)?`: rechaza ceros a la izquierda, `.5`, `1.`, `+1`, y el
      cero negativo (`-0`, `-0.00`) con `INVALID_AMOUNT`, por coherencia con la regla de `amount_minor`. `1.500` en
      MXN → `TOO_MANY_DECIMALS` (lectura literal de "más decimales que la escala").
    - `allocate` con total negativo reparte el valor absoluto y aplica el signo (`-100/3 → [-34, -33, -33]`).
    - `HALF_UP` = mitad alejándose de cero (semántica de decimal.js y Java).
    - Argumentos inválidos de `allocate`/`multiply` (partes ≤ 0, factor no finito o exponente extremo) son errores de
      programación (`RangeError`), no códigos de Money.
    Estas interpretaciones solo están en pruebas de TypeScript, no en los fixtures compartidos.
  - **T062 parcial:** hecho `money.json.ts` (serialización, `from_json` y validación de frontera). **Falta** usarla en
    `dev_probe_items` y `backend/src/modules/dev-probe/interface/` (G7b, no autorizado): T062 sigue sin marcar.
- **Fixtures (T056, T057):** `contracts/fixtures/money/core.json` (104 casos), `currencies.json` y
  `fixture.schema.json` (copia idéntica del esquema aprobado). Los valores esperados se calcularon con un oráculo
  independiente (Python, enteros exactos y `decimal`), no con la implementación. El runner valida los archivos con
  **Ajv 8.20.0** (devDependency, prevista en el plan: "Ajv 2020"); `strictRequired` está desactivado porque el esquema
  usa `required` dentro de `oneOf` (válido en JSON Schema).
  - **Hueco del esquema aprobado:** `parse(text, currency)` necesita una moneda, pero `inputs` no tiene `currency` y no
    admite propiedades adicionales. Convención provisional, documentada en el propio archivo: la moneda viaja en
    `inputs.a.currency` con `amount_minor` `"0"`, que se ignora. Propuesta: añadir `inputs.currency` al esquema
    (requiere aprobación).

## R-09 · Fixtures numéricos compartidos

- **Decision**: `contracts/fixtures/money/*.json` (neutral al lenguaje), validados por un JSON Schema
  (`contracts/fixtures/money/fixture.schema.json`). Cada caso: `id`, `operation`, `inputs`, `rounding`, `expected`
  (montos como string en unidades mínimas). Backend y `financial_domain` ejecutan **todos** los casos; CI falla si un
  archivo de fixtures cambia y alguno de los dos lados no se ejecutó.
- **Rationale**: `contracts/` ya es el artefacto compartido backend↔apps; evita duplicar casos.
- **Alternatives considered**: duplicar fixtures en cada paquete (diverge); `docs/` (no es código ejecutable).

## R-10 · Regla anti punto flotante

- **Decision**:
  - **TS**: ESLint (`typescript-eslint`) con override para `src/**/domain/**`, `src/common/money/**`: prohíbe la anotación
    de tipo `number` en propiedades/parámetros nombrados `*amount*|*balance*|*rate*|*fee*|*money*`, y `parseFloat`,
    `Number(`, `toFixed`, `Math.round` en esas rutas (`no-restricted-syntax`). Prueba de la regla con un archivo de
    "fixture defectuoso" que debe fallar.
  - **Dart**: script `scripts/ci/check-no-float-dart.sh` que falla si aparece `double` o `num` como tipo en
    `flutter/packages/financial_domain/lib/**` (excepto en comentarios), más `analysis_options` estricto.
- **Rationale**: verificable, simple y de bajo costo; cubre SC-003.
- **Alternatives considered**: plugin `custom_lint` en Dart (más robusto pero más complejo; reevaluar en 004).
- **Implementación TS (T064, 2026-11-22)**: bloque de `eslint.config.mjs` para `src/common/money/**` y
  `src/**/domain/**` con los selectores de R-10, incluidos los parámetros de constructor y los tipos literales. Como
  ESLint reemplaza la lista de `no-restricted-syntax` entre bloques, el bloque repite las restricciones de seguridad (P2,
  T038). Probado con la configuración real (`anti-float-rule.spec.ts`). El archivo defectuoso de referencia (T060) y el
  script de CI (T065) quedan pendientes.

## R-11 · Reglas de dependencias (Clean Architecture y apps)

- **Decision**: **dependency-cruiser 18** en backend: `domain/` no puede importar `@nestjs/*`, `@prisma/*`, `pg`,
  `express`, ni `infrastructure/`/`interface/`; módulos no importan internals de otros módulos (solo su `index.ts`
  público). **Flutter**: script Dart `flutter/tool/check_deps.dart` que lee los `pubspec.yaml` y falla si una app depende
  de otra app, si un paquete depende de una app, o si `financial_domain`/`shared_core` dependen de `flutter`.
- **Alternatives considered**: ESLint `import/no-restricted-paths` (menos expresivo que dependency-cruiser).

## R-12 · Generador del cliente Dart

- **Decision**: **openapi-generator `dart-dio`** ejecutado desde su imagen Docker oficial fijada por versión/digest
  (evita instalar Java localmente), salida en `flutter/packages/api_client/lib/src/generated/` (marcada
  `linguist-generated`, ya declarado en `.gitattributes`). Script `scripts/contracts/generate-dart-client.sh`; CI regenera y falla si hay diff (FR-029).
  **Spike corto incluido**: verificar que el contrato OpenAPI 3.1 (tipos `["string","null"]`, `oneOf` de problem) genera
  código compilable; si no, fallback a **swagger_parser 2.x** (Dart puro) o bajar el contrato a 3.0.3.
- **Rationale**: generador más maduro y usado; `dio` soporta interceptores (correlation id, `X-App-Version`).
- **Alternatives considered**: swagger_parser (fallback), cliente escrito a mano (prohibido por Constitución XII).
- **Resultado del spike (T069, 2026-11-23): APROBADO, sin fallback.**
  - **Imagen:** `openapitools/openapi-generator-cli:v7.27.0@sha256:949efd0d5cf3c093ef169887b2ebe0879ee2e8074b6476264232ce4fd8ef46d0`
    (índice multiarquitectura), ejecutada sin red y con el usuario local.
  - **Entrada:** el bundle 3.1 completo. El generador avisa de que su soporte de 3.1 está "en beta", pero genera sin
    errores.
  - **Compilación:** con Flutter 3.50.1 / Dart 3.14.0 tras `build_runner` (built_value), con solo 5 avisos de imports
    sin usar en código generado.
  - **Tipado:**
    - `Money.amount_minor` → `String`: exacto, nunca `double`/`num`, tampoco en web;
    - `date-time` → `DateTime`;
    - `["boolean","null"]` → `bool?`;
    - problem+json → `Problem` con `code` y `correlation_id`;
    - `X-App-Version` y `X-Correlation-Id` → parámetros tipados.
  - **Único `num`:** en `api_util.dart`, para codificar parámetros de query; no es un monto.
- **Generación (T070):**
  - **Entrada:** el bundle de CLIENTE (API `client` de `redocly.yaml`, `pnpm contracts:bundle:client`), con
    `filter-out` de `x-kuota-non-production` y `remove-unused-components`. Rutas: `/health/live`, `/health/ready` y
    `/v1/meta/compatibility`; sin esquemas de dev-probe ni `devTenantContext`. Quedan solo menciones en texto (la
    descripción del contrato y una etiqueta sin operaciones).
  - **Posprocesado (parte del script, reproducible):** el código va a `lib/src/generated/`, los imports se reescriben a
    `package:api_client/src/generated/…` y la biblioteca generada pasa a llamarse `generated.dart`, porque
    `lib/api_client.dart` es la API pública escrita a mano.
  - **Comprobaciones del script:** el bundle no tiene operaciones técnicas y el resultado no contiene dev-probe.
  - **Determinismo:** tres generaciones idénticas byte a byte.
  - **Dependencias exactas del spike:** dio 5.11.1, built_value 8.13.0, built_collection 5.1.2 (no la 6.0.0, fuera
    del rango del generador), one_of y one_of_serializer 1.5.0, build_runner 2.16.2 y built_value_generator 8.13.0.
  - **Análisis:** `lib/src/generated/**` se excluye del análisis estricto (avisos propios del generador); se valida
    compilándolo y con pruebas.
  - **Money:** no está en el cliente distribuible porque ninguna operación pública lo usa todavía. Cuando una lo use, el
    generador lo emitirá como `String` (comprobado en el spike).
  - **Idempotencia:** ningún interceptor genera `Idempotency-Key`. La clave la aporta quien crea la operación y se
    conserva en los reintentos (probado). La correlación sí es por solicitud.
  - **URL por defecto del generador:** `servers` del contrato, `http://localhost:3000`. Nunca se usa: `KuotaApiClient`
    exige la URL de `AppConfig`.
- **Pendiente:**
  - T071: comprobación "regenerado == versionado" en CI. `contracts.sh` ya la ejecuta en local cuando existen el
    generador y el cliente (T049), pero en GitHub el job `contracts` no tiene Flutter ni FVM: queda para T071 y T050.
  - Aviso `Can't load Kernel binary` del lanzador global de FVM 3.2.1 (snapshot compilado con el Dart global 3.5.3).
    Es inofensivo y ajeno al proyecto.

## R-13 · Lint y compatibilidad del contrato

- **Decision**: Fuente en `contracts/openapi/kuota-core.v1.yaml` (multi-archivo con `$ref` en `paths/`, `schemas/`).
  **Redocly CLI 2** para `lint` + `bundle`; reglas propias (Spectral-compatibles vía Redocly `configurable rules`):
  `Idempotency-Key` requerido en operaciones `POST/PUT/PATCH` marcadas `x-kuota-financial: true`, respuestas de error
  `application/problem+json`, montos vía `$ref: Money`. **oasdiff** `breaking` contra el bundle de `main`.
- **Rationale**: Redocly cubre lint y bundle con una sola herramienta; Spectral queda como alternativa si se requieren
  reglas más complejas (se evita doble configuración).
- **Alternatives considered**: Spectral + otro bundler (dos herramientas para lo mismo).
- **Implementación (G5: T022–T024, 2026-11-22)**:
  - Fuente multiarchivo en `contracts/openapi/` (`paths/`, `schemas/`, `parameters/`, `responses/` y `headers/`, este
    último porque el borrador ya declaraba `components.headers`). Su bundle desreferenciado es idéntico al del borrador
    aprobado salvo `info.description`. Sin endpoints nuevos ni cambios al contrato financiero.
  - Redocly CLI **2.82.0** (devDependency raíz, versión exacta, sin scripts de instalación). Las `configurable rules`
    no pueden exigir un parámetro según una extensión de la operación, así que las reglas propias son un plugin local
    (`contracts/openapi/plugins/kuota-rules.mjs`): `kuota/idempotency-key-required`, `kuota/problem-json-errors` (exime
    las operaciones `health`, cuyo 503 es estado) y `kuota/money-via-ref`. Excepciones del preset acotadas por
    ubicación y justificadas en `contracts/openapi/.redocly.lint-ignore.yaml`.
  - **Discrepancia resuelta sin cambiar el contrato**: esta decisión nombraba `x-kuota-financial: true` y T023/el
    contrato usan `x-kuota-idempotent`. La regla exige `Idempotency-Key` en ambos casos (`x-kuota-idempotent` en
    cualquier método; `x-kuota-financial` en POST/PUT/PATCH). Unificar la nomenclatura queda para la gobernanza del
    contrato (antes de la primera operación financiera).
  - oasdiff **v1.39.0** vía imagen oficial `tufin/oasdiff:v1.39.0@sha256:004bef22058ace818b61f0eb2f05efb89fc6a3882f68bf4db0b6a86f40723fe0`
    (índice multiarquitectura: amd64 `sha256:d552b750…`, arm64 `sha256:26e46ff2…`), verificada con `docker buildx
    imagetools inspect` y `oasdiff --version`. Montajes de solo lectura y `--network none`; `--fail-on ERR`.
  - **Base**: `contracts:breaking [REF]` empaqueta el contrato de `REF` (por defecto `main`) con `git archive`. Si
    `REF` no contiene el contrato (caso actual: `main` aún no lo tiene) lo informa y sale con 0: no se inventa una base.
    La primera comparación real ocurrirá cuando el contrato llegue a `main`. La integración en CI es de G12.
  - Pruebas (`pnpm contracts:test`): fixtures que cada regla debe rechazar, y variantes del contrato real que oasdiff
    debe aceptar (sin cambios, cambio compatible) o rechazar (endpoint eliminado, tipo cambiado, propiedad de petición
    que pasa a requerida, propiedad de respuesta que deja de ser requerida, propiedad de respuesta que pasa a nullable).

## R-14 · Pruebas de contrato (respuestas reales vs contrato)

- **Decision**: Pruebas e2e (Vitest + `supertest`) validan cada respuesta contra el esquema del bundle con **Ajv 2020**
  (OpenAPI 3.1 usa JSON Schema 2020-12) mediante un helper `expectToMatchContract(res, operationId)`.
- **Alternatives considered**: Prism/Schemathesis (útiles más adelante para fuzzing; no necesarios en 001).

## R-15 · Logging y redacción de PII

- **Decision**: `nestjs-pino`; `correlation_id` desde `X-Correlation-Id` (validado como UUID) o generado (UUIDv7);
  incluido en logs y en todo problem+json. Redacción con `redact.paths` (headers `authorization`, `cookie`,
  `x-kuota-dev-*` en no-dev, campos `*.phone`, `*.email`, `*.password`, `*.otp`, `*.token`, `*.tax_id`, `*.curp`) +
  serializador que enmascara patrones (teléfonos de 10+ dígitos, correos) en mensajes libres. Prueba que escribe datos
  sensibles conocidos y verifica que no aparecen en la salida (SC-009).
- **Alternatives considered**: Winston (más lento, redacción manual).
- **Implementación (G4: T016–T021, 2026-11-22)**:
  - Dependencias exactas: `nestjs-pino` 5.3.2, `pino` 10.4.0, `pino-http` 11.0.0 (dependencia par obligatoria) y
    `nestjs-cls` 7.0.2. Ninguna requiere scripts de instalación (`allowBuilds` sin cambios, condición P8).
  - UUIDv7 de correlación con `crypto.randomUUIDv7()` nativo de Node 26 (sin dependencia). Un `X-Correlation-Id`
    que no sea UUID nunca se refleja: se genera uno nuevo.
  - Validación de configuración propia (`src/common/config/load-config.ts`), sin librería: el plan no fija ninguna y
    las reglas son pocas. La API **no** carga `DATABASE_URL_MIGRATOR` y rechaza en `DATABASE_URL_APP` los usuarios
    `kuota_migrator` y `postgres` (FR-014).
  - Redacción: claves sensibles a cualquier profundidad (incluidas `authorization`, `cookie`, `rfc`, `pin`) y, en texto
    libre, correos, teléfonos de 10–15 dígitos, `clave=valor` de secretos y `Bearer …`; los UUID no se alteran.
  - Claves del CLS que lee el logging: `correlationId`, `tenantId`, `actorId`. **T038 debe usar estas mismas claves.**
  - Errores: un `HttpException` 4xx sin código propio en el contrato (p. ej. 403) conserva su estado con
    `validation-error`; definir códigos para 403/405 queda **pendiente para 002**. Los mensajes de `HttpException`
    nunca se exponen; solo los de validación, en `errors[]`.
  - Los componentes existen y están probados, pero **no están conectados al proceso real** hasta T025 (`AppModule`,
    filtro global, `app.useLogger`).
- **Implementación (G5: T025, 2026-11-22)**:
  - Conectados al proceso real: `AppModule.forRoot(config)` (configuración ya validada, `LoggingModule`, filtro global
    `APP_FILTER`), `createApp` en `src/bootstrap.ts` (`app.useLogger`, `bufferLogs`, prefijo `/v1` salvo `health/*`,
    sin `X-Powered-By`) y `main.ts`, que valida la configuración antes de crear Nest y, si es inválida, sale con 1 y una
    línea JSON que nombra variables y reglas, nunca valores.
  - Registro condicional (FR-040): `src/dev-modules.ts` (`DEV_ONLY_MODULES`, **vacío** hasta G7) solo se importa si
    `KUOTA_ENV ∈ {local, testing}` y `KUOTA_DEV_TENANT_CONTEXT=enabled`. Fuera de eso las rutas no existen (404).
  - **Corrige la regla de G4 sobre 403/405** (fase 6 de G5): el contrato no tiene códigos para 401/403/405/426 genéricos,
    y convertir un 403 en `validation-error` mezclaba autorización con validación. Ahora solo 400/413/415/422 →
    `validation-error` y 404 → `not-found`; 401 y 426 se producen únicamente con `KuotaProblemError`; cualquier otra
    `HttpException` (403, 405…) es un error de programación → 500 `internal-error` con log de error. Los códigos para
    403/405 siguen **pendientes para 002**.
- **Implementación (G6: T026–T033, 2026-11-22)**:
  - **Corrige un defecto de G5**: el middleware de CLS lo montaba Nest bajo el prefijo global `/v1`, así que en las rutas
    excluidas (`health/*`) los logs de Nest salían sin `correlation_id`. Ahora `createApp` lo monta con `app.use`
    (`requestContextMiddleware()`) para todas las rutas, con prueba de regresión.
  - Health (T028): `@nestjs/terminus` **12.2.0** (exacta; sin dependencias propias ni scripts de instalación; peers
    `@nestjs/common|core ^12` cumplidos). `/health/live` no consulta nada. `/health/ready` usa el indicador `database`
    sobre `DatabaseProbe` (`src/common/database/`): una conexión nueva por comprobación con `kuota_app_login`, solo
    `SELECT 1`, límite de 2 s (conexión, consulta y `statement_timeout`), sin contexto de tenant, sin leer tablas y sin
    encabezados de la petición. El resultado de terminus se reduce a `ReadinessStatus`; el motivo del fallo va solo al
    log (`warn`, con `correlation_id`). El 503 es un estado del contrato (`ReadinessStatus`), no un problem+json, así
    que no pasa por el filtro de errores: no hacía falta ningún código nuevo. La sonda no prueba RLS ni el esquema.
  - **Excepción acotada a P2/C4-2**: `pg` puede importarse solo en `src/common/database/pg-connectivity-probe.ts`
    (eslint; Prisma y las reglas de SQL de contexto siguen activas ahí) y solo el módulo health puede usar
    `src/common/database/` (dependency-cruiser, regla `sonda-bd-solo-health`). Ambas reglas tienen pruebas. `pg` 8.23.1
    pasa de devDependency a dependency de runtime (misma versión). Cuando exista el pool de T039 se revisará si la sonda
    lo reutiliza.
  - Compatibilidad (T029): `X-App-Version` inválido → 400 `validation-error` con `errors[{field:'X-App-Version'}]` y un
    mensaje fijo (nunca refleja el valor); sin el encabezado, `client_supported: null`. La comparación es numérica
    X.Y.Z e ignora el build.

## R-16 · Cola de jobs

- **Decision**: **No se introduce** en 001 (no hay trabajo asíncrono). Candidato futuro: `pg-boss` (PostgreSQL) cuando
  una feature lo requiera (purga de idempotencia programada, notificaciones). Redis sigue sin justificarse.

## R-17 · CI (GitHub Actions) y validación local

- **Decision**: Workflows en `.github/workflows/`: `ci.yml` con `dorny/paths-filter` → jobs `general` (siempre:
  gitleaks, editorconfig-checker, nombre de rama, actionlint), `backend`, `contracts`, `flutter` (análisis, pruebas,
  `check_deps`, build Android + Web; **iOS no en CI**, Clarification 2026-11-22). Toda lógica vive en
  `scripts/ci/*.sh` invocados por los jobs, de modo que `scripts/ci/run-local.sh <job>` reproduce CI localmente.
  `actionlint` valida los YAML. Escaneo de dependencias: `osv-scanner` sobre `pnpm-lock.yaml` y `pubspec.lock`
  (falla en severidad alta/crítica). Acciones de terceros fijadas por SHA.
- **Rationale**: FR-037 (validable localmente, no se publica sin aprobación); SC-004 (docs-only ≤ 3 min).
- **Alternatives considered**: `act` (emula runners; útil pero no instalado y no necesario si los jobs son scripts).

## R-18 · Docker Compose local

- **Decision**: `infra/docker/compose.yaml` con `postgres:18` (digest fijado), volumen nombrado, healthcheck
  `pg_isready`, script de init `infra/docker/postgres/init/01-roles.sql` que crea `kuota_migrator` (owner),
  `kuota_app` (NOLOGIN, NOBYPASSRLS) y `kuota_app_login` (LOGIN, miembro de `kuota_app`), y base `kuota_test` para
  pruebas. El backend corre en el host en desarrollo (`pnpm dev`) y opcionalmente en compose (perfil `app`).
  Comando único: `make up` (o `scripts/dev/up.sh`) → compose + migraciones + verificación de salud.
- **Alternatives considered**: backend siempre en contenedor (bucle de desarrollo más lento).
- **Implementación (G1, 2026-11-22)**: imagen `postgres:18@sha256:eb63372c…` (índice multiarquitectura; servidor 18.7),
  puerto publicado solo en `127.0.0.1`, por defecto **55432** (`KUOTA_PG_HOST_PORT`): en la máquina de desarrollo el 5432
  y el 5433 ya estaban ocupados por otro PostgreSQL. Las contraseñas de los roles no se versionan: `01-roles.sql` las lee
  del entorno con `\getenv` y falla si faltan o tienen menos de 12 caracteres. Testcontainers usa la misma imagen,
  leída de `compose.yaml`.
- **Cadena de suministro (pnpm 12, T007):** se respeta la edad mínima de publicación de pnpm: `dependency-cruiser` queda
  en **18.8.0** porque 18.9.0 se publicó el mismo día y pnpm pedía exceptuarla. Los scripts de instalación de
  `@swc/core`, `ssh2`, `cpu-features` y `protobufjs` quedan **denegados** en `allowBuilds` (`pnpm-workspace.yaml`): son
  opcionales y todo funciona sin ellos (typecheck, build, pruebas y Testcontainers verificados).
- **Implementación (G6: T030–T032, 2026-11-22)**:
  - `scripts/dev/up.sh`: doctor → puertos (mensaje accionable si la API o PostgreSQL chocan con otro proceso) →
    `compose up --wait` → `prisma migrate deploy` (si falla, no arranca el backend e indica el procedimiento de
    `data-architecture.md` §8) → `pnpm --filter backend dev` → espera de `/health/ready`. Nunca crea ni sobrescribe
    `.env`. La API arranca **sin** `DATABASE_URL_MIGRATOR` ni las contraseñas del contenedor (FR-014). Ctrl-C o SIGTERM
    detienen todo el árbol del backend. `KUOTA_ENV_FILE` y `KUOTA_COMPOSE_PROJECT` permiten un entorno aislado.
  - `scripts/dev/down.sh`: detiene el backend (pid en `.dev/`, ignorado por Git) y PostgreSQL con `compose stop`; el
    volumen se conserva. Repetible.
  - `scripts/dev/test-all.sh [componentes]` y `scripts/dev/test-affected.sh <base>`; los filtros por ruta están en
    `scripts/dev/path-filters.sh`, que transcribe `monorepo-strategy.md` §4 y `testing-strategy.md` (contrato,
    Constitución y CI disparan la suite completa). **El CI de G12 debe usar ese archivo** para no divergir.
  - Verificado en un proyecto compose aislado (`kuota-g6check`): arranque limpio, base detenida (503) y recuperación,
    segunda ejecución, puertos ocupados, migración fallida (sin tablas parciales), `down` repetido y Ctrl-C.

## Pendientes técnicos registrados (G5–G6)

| Pendiente | Cuándo debe resolverse |
|---|---|
| Unificar `x-kuota-idempotent` y `x-kuota-financial` (R-13) | Antes de la primera operación financiera que dependa de la convención |
| Códigos de contrato para 403/405 (R-15) | Antes de implementar la autorización de 002 |
| Unificar `index.ts` y `public-api.ts` como API pública de un módulo | Antes de crear módulos con interfaces públicas entre módulos (G7) |
| `contracts:breaking` omite la comparación (sale con 0) mientras `main` no contiene el contrato | Cuando exista el baseline en `main`, la comparación pasa a ser obligatoria y la ausencia de base debe fallar; se integra en CI en G12 |
| CI debe consumir `scripts/dev/path-filters.sh` | G12 |
| La sonda de readiness usa una conexión propia, no el pool de la aplicación | Revisado en T039: se mantiene (comprueba conexiones nuevas; no comparte la cola del pool de transacciones) |
| ~~ADR-0002 nombra `public-api.ts`; la decisión de G7a es `index.ts`~~ | **Resuelto**: enmienda 1 de ADR-0002 (2026-11-22) |
| T042 acepta `sample_amount` (Money) y su validación en la frontera es T062 (US4); `tasks.md` declara US2 independiente de US4 | Antes de autorizar G7b: reordenar o aprobar la dependencia |
| P2: gate de CI de las reglas de contexto y fuente de identidad real | G12 y 002 |
| P2 R3: el cliente transaccional compartido por código defectuoso lee como su tenant (`docs/security/p2-tenant-context-risk-assessment.md`) | **Resuelto 2026-11-22** (opción a aprobada): hardening de T039, §8 de la evaluación. P2 sigue parcial |
| ADR-0002 C2-1 dice que el cliente transaccional "se guarda en CLS"; tras R3 la transacción activa vive en un `AsyncLocalStorage` privado de `TenantPrismaService` (el contexto de tenant sigue en CLS) | **Resuelto 2026-11-22:** enmienda 2 de ADR-0002 |
| Esquema de fixtures de Money sin `inputs.currency` para `parse` | Aprobar la ampliación del esquema antes de T059 (Dart) |
| Interpretaciones de Money no fijadas en ADR-0007 (`parse` estricto, `allocate` negativo) | Confirmar antes de T063 (Dart) |
| T062: falta usar Money en dev-probe | **Resuelto 2026-11-22 (G7b)**: `sample_amount` con `parseMoneyField`/`moneyToJson`; T062 completa |
| Auditoría sin actor: sin `X-Kuota-Dev-Actor`, `app.actor_id` queda vacío y `audit_events.actor_id` es NOT NULL | **Resuelto 2026-11-22** (política aprobada en US6): operación auditada sin actor → 400 `validation-error` antes de escribir (`AuditActorGuard`), si el contrato lo admite |
| US6 — DELETE de dev-probe no se audita: la política exige 400 sin actor y `deleteDevProbeItem` no declara 400 | **Resuelto 2026-11-23:** 400 aprobado y añadido al contrato; DELETE auditado (`dev_probe.deleted`). Texto original: **Bloqueado (decisión contractual).** Propuesta: añadir `'400': $ref BadRequest` a `delete` en `contracts/openapi/paths/v1-dev-probe-items-by-id.yaml` (aditivo; revisar con `contracts:breaking`). Con la aprobación: `@Audited()` + `dev_probe.deleted` (`label`, `version`) en T078, y su prueba en T073 |
| US6 — purga masiva de `idempotency_keys` (T079): con FORCE RLS y la política `TO kuota_app`, ni `kuota_app_login` (solo su tenant) ni `kuota_migrator` (0 filas) pueden borrar entre tenants; la Constitución III exige un rol y un módulo separados para operaciones de plataforma | **Resuelto 2026-11-23:** rol `kuota_maintenance` + migración 0002 + `idempotency:purge` (notas de cierre abajo). Texto original: **Bloqueado (decisión de arquitectura y migración).** Propuesta: migración 0002 aditiva con un rol `kuota_maintenance` (NOLOGIN, sin BYPASSRLS) y una política `FOR DELETE TO kuota_maintenance USING (expires_at <= now())` en `idempotency_keys`, más un script que solo ejecuta ese DELETE. Mientras tanto, las claves vencidas se tratan como inexistentes y se eliminan al reutilizarlas |
| US6 — `audit_events.origin` = `ip-hash:<sha256(IP)>` sin sal: el espacio IPv4 es enumerable, así que el hash es reversible por fuerza bruta | **Pendiente de privacidad** antes de datos reales. Análisis y propuesta: `docs/security/audit-origin-privacy-assessment.md` (sin cambio de algoritmo). Recomendación (§4): minimizar (sin IP); HMAC versionado solo si 002 lo justifica |
| T072 dice que la expiración se fije "con kuota_migrator", pero el migrador no ve filas por FORCE RLS (decisión de 0001) | **Resuelto 2026-11-23** (Aprobación 4): T072 enmendada y cerrada. El fixture usa `withTenant` con `kuota_app_login`; la comprobación y la purga, la identidad de mantenimiento |
| Recuperación de una 0002 fallida: Prisma la registra como fallida y bloquea nuevos `deploy`; la gobernanza prohíbe `migrate resolve` sin aprobación | **Mitigado 2026-11-23:** `make up` ejecuta `scripts/migration-preflight.ts` (solo lectura) antes de migrar y se detiene si falta el rol o tiene atributos inválidos, o si hay una migración fallida registrada. Riesgo residual: un fallo de 0002 por otra causa (p. ej. que el rol cambie entre el preflight y el deploy, o un error de conexión a mitad) sigue dejándola registrada como fallida. Su recuperación requiere un procedimiento aprobado |
| ADR-0004 (C4-1) es la fuente única de roles y aún no lista `kuota_maintenance` ni `kuota_maintenance_login` | **Resuelto 2026-11-23:** ADR-0004, enmienda 1 (Aprobación 4) |

## R-19 · Estado y estructura Flutter

- **Decision**: Riverpod 3 (ADR-0003; **D-ARC-02 aprobada el 2026-11-22**) para los shells; `shared_core` expone
  `AppConfig` por entorno (`--dart-define-from-file=config/<env>.json`), `design_system` con tema claro/oscuro y
  variante `highContrastReceipt`; `api_client` generado; `financial_domain` con `Money` y fixtures. Melos 8 se configura en
  la sección `melos:` del `flutter/pubspec.yaml` raíz del workspace, solo para scripts.
- **Note**: los providers solo orquestan estado de UI; reglas en `financial_domain`, sincronización en `offline_sync`.
- **`admin_web` (D-ARC-03, pendiente)**: Flutter Web **provisional**, autorizado solo para el shell de 001 (scaffolding,
  entorno, arranque, build Web, integración en el monorepo). La tecnología definitiva se decide con los criterios de
  ADR-0003 antes de las pantallas administrativas complejas; el shell es descartable sin afectar a los paquetes.

## R-20 · CODEOWNERS con mantenedor único

- **Decision**: `.github/CODEOWNERS` con el handle del mantenedor como placeholder `<maintainer-handle>`
  (a reemplazar al crear el remoto) y secciones por área listas para agregar un segundo dueño. Reglas de protección de
  `main` documentadas en `docs/process/git-workflow.md` (FR-038) para aplicarse al publicar, con la excepción de
  mantenedor único (introducida en la Constitución v1.1.0, vigente en v1.2.0).

## R-21 · Métricas técnicas (FR-039) y su acceso (FR-040)

- **Decision**: OpenTelemetry Metrics, coherente con `docs/architecture/backend-architecture.md` y
  `deployment-architecture.md` (telemetría con OpenTelemetry; exportador definitivo con D-ARC-04):
  `@opentelemetry/api` 1.10, `@opentelemetry/sdk-metrics` 3.1 y `@opentelemetry/exporter-prometheus` 0.301 en modo
  *pull*. El exportador se crea con `preventServerStart: true` y su `getMetricsRequestHandler` se monta en un servidor
  HTTP propio de `common/metrics`, que aplica los controles de acceso. Instrumentos: histograma
  `http_server_request_duration_seconds{route,method,status}` (ruta como plantilla), contador
  `kuota_http_errors_total{code}`, gauges del pool de `adapter-pg` y métricas del proceso. Sin etiquetas de tenant
  (privacidad y cardinalidad). No se aprovisiona servidor Prometheus ni alertas (D-ARC-04); las alertas financieras se
  especifican en 006/013.
- **Por qué no está en el contrato OpenAPI público**: el contrato describe la API que consumen las apps y genera su
  cliente Dart (Constitución XII). Las métricas no las consume ninguna app, se sirven fuera del listener de la API, en
  formato de exposición de Prometheus (no JSON) y su forma la define la instrumentación, no un acuerdo con clientes.
  Incluirlas expondría su existencia en la documentación pública y generaría código de cliente innecesario. Su acceso
  se documenta en la tabla Endpoint Access de spec.md.
- **Controles de acceso** (Constitución §II; el puerto separado no cuenta como control):
  - `KUOTA_METRICS_HOST` (por defecto `127.0.0.1`) y `KUOTA_METRICS_PORT` (por defecto 9464): por defecto solo es
    alcanzable desde la propia máquina o el propio contenedor.
  - `KUOTA_METRICS_TOKEN`: token portador del recolector, comparado en tiempo constante; sin token o con token inválido
    → 401. Es un secreto: `.env.example` solo lleva un valor ficticio.
  - Guard de arranque: si `KUOTA_ENV ∈ {staging, production}` o el host no es de loopback, el arranque falla cuando
    el token falta o tiene menos de 32 caracteres.
  - La restricción de red del entorno desplegado (red interna, política de red) se decide con D-ARC-04.
- **Rationale**: Constitución XIII exige métricas técnicas básicas, y §II exige que sean internas y protegidas.
  OpenTelemetry evita una segunda librería de telemetría cuando se añadan trazas y permite cambiar a OTLP *push* sin
  tocar la instrumentación.
- **Alternatives considered**: `@prometheus-io/client` 0.16 (sucesor oficial de `prom-client`; elegido en una primera
  versión de esta decisión y descartado porque contradice la arquitectura documentada); `@willsoto/nestjs-prometheus`
  (wrapper sin valor en 001); exportador OTLP *push* (requiere un colector, que depende de D-ARC-04).
- **Verificado** (2026-11-22, `npm view`): `@opentelemetry/sdk-metrics` 3.1.1, `@opentelemetry/exporter-prometheus`
  0.301.2 (con `preventServerStart` y `getMetricsRequestHandler` en sus tipos publicados), `@opentelemetry/api` 1.10.0.

## Incógnitas restantes

Ninguna bloqueante para el plan. Dependencias de decisión en ejecución: **D-ARC-01** (resultado del spike R-04) y
validación de generador R-12; ambas tienen fallback definido.

### Notas de implementación de G7b (dev-probe, 2026-11-22)

Decisiones de detalle que el contrato y data-model.md no fijan. Se registran para revisión; ninguna cambia el contrato.

- **Id malformado en el path → 404** (no 400): `getDevProbeItem` y `deleteDevProbeItem` no declaran 400 en el
  contrato, y un recurso con ese id no puede existir. Se aplica igual en `updateDevProbeItem`. Un id en mayúsculas se
  normaliza.
- **Cursor opaco:** base64url de `v1:<id>` del último elemento, con keyset por `id` (UUIDv7, ordenado en el tiempo).
  Un cursor inválido → 400 `validation-error` (field `cursor`). Un cursor con el id de otro tenant solo acota el
  listado del propio tenant: no revela nada.
- **`version` > 2147483647 → 400:** queda fuera del tipo `integer` de PostgreSQL (data-model `dev_probe_items.version`).
- **`label`:** se cuenta en puntos de código, igual que `char_length` en PostgreSQL. No se recorta ni se normaliza.
- **Propiedades no permitidas** (incluido `tenant_id`) → 400 nombrando el campo, nunca su valor
  (`additionalProperties: false`; US2-3).
- **`updated_at` en PATCH:** hora del servidor de aplicación (`new Date()`). `created_at` usa `now()` de la base.
  Se eligió la API de modelo para no introducir SQL raw en un módulo de negocio (P2 R2).
- **Idempotencia:** `IdempotencyKeyPipe` (`backend/src/common/idempotency/`) solo valida presencia y formato. Las
  respuestas 409 y 422 de `createDevProbeItem` del contrato dependen de T076 (US6) y hoy no se producen. El contrato
  no exige `Idempotency-Key` en PATCH ni en DELETE.
- **Auditoría y actor:** dev-probe no escribe en `audit_events` en G7b, así que la falta de un actor por defecto no
  bloquea. T077 debe decidir qué ocurre con las escrituras auditadas sin `X-Kuota-Dev-Actor` antes de T078 (ver
  pendientes).
- **Prueba de mutación de la suite de aislamiento:** con RLS desactivado en el contenedor efímero, 6 de los 9 casos
  fallan (salida 1). No se versionó.

### Notas de implementación de US6 (idempotencia y auditoría, 2026-11-22)

- **Alcance confirmado por el responsable:** T072–T079 completo, según tasks.md (idempotencia y auditoría). T095 queda
  fuera porque depende de T066 (US5).
- **Una transacción:** `@Idempotent()` ejecuta el handler dentro del `withTenant` del repositorio de idempotencia. Nest 12
  crea el ámbito asíncrono del handler al invocar `next.handle()`, así que el caso de uso y `AuditService` reutilizan esa
  transacción. Lo demuestra el mismo `xmin` en la clave, la fila de negocio y el evento (`audit.spec.ts`).
- **Solo se almacenan respuestas 2xx:** es un subconjunto de lo que data-model.md permite (2xx/4xx deterministas).
  Guardar un 4xx exigiría confirmar la transacción de un comando fallido. Un 400 de validación no registra la clave y
  el reintento corregido con la misma clave produce el efecto.
- **Reproducción:** se devuelve el cuerpo almacenado con `Idempotent-Replayed: true`. El estado HTTP sale de
  `@HttpCode` o del método (POST → 201). Hoy la única operación idempotente es create, siempre 201.
- **Fila de la clave por `INSERT` parametrizado:** así `created_at` y `expires_at` salen del mismo `now()` de la
  transacción (expires_at = created_at + 30 días exacto). Prisma rellena `@default(now())` con el reloj de la
  aplicación. Por la misma razón, `audit_events.occurred_at` usa la hora del servidor de aplicación vía Prisma.
- **SQL raw nuevo** (todo con plantilla parametrizada, sin `app.*`, en `common/idempotency`):
  - `pg_try_advisory_xact_lock`;
  - borrado de la clave vencida con `now()`;
  - `INSERT` de la clave.
- **T072:** la expiración se prepara con el superusuario del contenedor efímero. `kuota_migrator` no ve filas por
  FORCE RLS (decisión de 0001).
- **Política de actor:** `@Audited()` (`AuditActorGuard`) corre después del guard de contexto y antes de la
  idempotencia y del handler. Sin actor → 400 `validation-error` (field `X-Kuota-Dev-Actor`). `AuditService` vuelve a
  comprobarlo antes de PostgreSQL (defensa en profundidad), y PostgreSQL rechaza con `23502` como última barrera. Las
  lecturas no exigen actor. En producción no existe esta fuente: la identidad llega con 002.
- **`changes` usa una lista permitida por entidad** (`AUDIT_ENTITIES`). En dev_probe: `label`, `sample_amount` y
  `version`. Nunca el cuerpo completo ni los encabezados.
- **`test:idempotency`:** 100 repeticiones del escenario de 10 envíos (5 en paralelo); `pnpm test` ejecuta 10.

### Cierre de US6 (2026-11-23): DELETE auditado y mantenimiento de idempotencia

- **Contrato:** se añadió `'400': BadRequest` a `deleteDevProbeItem`, con la descripción de la política de actor.
  - oasdiff contra el commit previo del contrato (`47a2ca9`): sin cambios incompatibles.
  - Contra `main` la comparación sigue omitida: no hay baseline, así que no es una prueba de compatibilidad.
  - Efecto para los consumidores: un DELETE sin actor (antes 204/404) ahora responde 400.
- **DELETE auditado:** el repositorio comprueba la existencia y borra con `delete` (DELETE … RETURNING) en la misma
  transacción; el evento registra el `label` y la `version` borrados. Un P2025 por borrado concurrente se trata como
  404. Sin `@Idempotent()`, porque el contrato no define `Idempotency-Key` para DELETE.
- **Diseño de mantenimiento elegido: políticas explícitas y privilegios por columna.** Verificado en PostgreSQL 18:
  - `SELECT` por columnas no da acceso a `ctid`, `*` ni columnas sensibles;
  - `FOR UPDATE` exigiría `UPDATE`, que no se concede;
  - con FORCE RLS, sin política propia el rol no vería nada.
- **`SECURITY DEFINER`, descartado:**
  - el propietario natural (`kuota_migrator`) está sujeto a FORCE RLS y vería 0 filas;
  - hacer propietario a `kuota_maintenance` exigiría que el migrador fuera miembro de ese rol y diera `CREATE` en el
    esquema;
  - y concentraría privilegios en una función, que es una superficie de escalamiento.
  - Una función `SECURITY INVOKER` no añadiría seguridad.
- **Aprovisionamiento (fuera de Prisma):** `infra/docker/postgres/init/02-maintenance-roles.sql`.
  - Es re-ejecutable.
  - El login solo se crea si existe `KUOTA_MAINTENANCE_LOGIN_PASSWORD` (≥ 12 caracteres); es opcional en compose y en
    `.env.example`.
  - Los volúmenes ya inicializados no ejecutan `initdb`: antes de aplicar 0002 allí hay que ejecutarlo a mano con
    revisión.
- **0002:** transaccional (P1). Verifica que el rol existe, no tiene atributos elevados y no es miembro de
  `kuota_app`/`kuota_migrator`; si falla, aborta sin cambios. Prisma muestra «current transaction is aborted» en vez
  del mensaje: el mensaje se ve ejecutando el SQL o en el registro de PostgreSQL.
- **`db:check-rls`:** acepta solo las dos políticas de mantenimiento con su definición exacta, exige que siga
  existiendo la política de tenant y verifica atributos, pertenencias y privilegios efectivos (incluidos los heredados
  de PUBLIC) del rol de mantenimiento y su login.
- **Purga (`idempotency:purge`):**
  - verifica la identidad antes de nada;
  - borra por lotes en transacciones independientes, con `lock_timeout` y `statement_timeout`;
  - tiene modo de inspección (`--dry-run`) y sale solo con conteos.
  - Las pruebas usan la credencial real del login de mantenimiento.

### US5a (T066, T067, T095; 2026-11-23)

- **`expectToMatchContract`:** se usa `fetch` sobre la aplicación real, igual que el resto de pruebas HTTP, y no
  `supertest`. R-14 lo mencionaba, pero no es dependencia del proyecto y no se añadió.
- **Bundle:** se genera en el momento con Redocly desde `contracts/openapi`, sin definición paralela.
- **Formatos:** `uuid`, `date-time` y `uri-reference` se registran en el matcher; no se añadió `ajv-formats`. Un
  formato nuevo en el contrato hace fallar la carga.
- **Ajv con `strict: false`:** solo porque el documento OpenAPI contiene palabras clave que no son JSON Schema.
- **Encabezados por `$ref`:** se resuelven (hallazgo al escribir las pruebas negativas: sin esto `Idempotent-Replayed`
  y `X-Correlation-Id` no se validaban).
- **Resultado:** todas las respuestas reales probadas cumplen el contrato; no se cambió el contrato ni ninguna
  respuesta.
- **500:** ninguna operación lo declara, así que el matcher rechaza un 500 como "código no declarado". T067 cubre los
  códigos declarados.

### G12 / US3: CI (2026-11-23)

- **Herramientas** sin dependencia en el lockfile, en contenedores fijados por digest (`scripts/ci/lib.sh`; verificado
  con `docker buildx imagetools inspect`): gitleaks 8.30.1, actionlint 1.7.12 (incluye shellcheck),
  editorconfig-checker 4.0.2 y osv-scanner 2.7.1. No hay instalaciones globales salvo `corepack@0.36.0` en CI, igual
  que pide `doctor` para Node 26.
- **Acciones fijadas por SHA:**
  - `actions/checkout` v7.0.1 (`3d3c42e…`);
  - `actions/setup-node` v7.1.0 (`949feb2…`);
  - `dorny/paths-filter` v4.0.3 (`ceb8a2b…`).
- **Selección de jobs:** `dorny/paths-filter` solo aporta la lista de archivos. La decisión la toma
  `scripts/ci/affected.sh` sobre `scripts/dev/path-filters.sh`, la fuente única (R-17, G6). Los filtros se ampliaron:
  `infra/docker/`, `pnpm-workspace.yaml` y `package.json` disparan `backend`; `scripts/contracts/` y `package.json`
  disparan `contracts`; CODEOWNERS dispara la suite completa.
- **Check requerido único:** `CI: resultado` (`scripts/ci/ci-result.sh`). GitHub da por satisfecho un job requerido
  que se salta, así que el agregador falla si un componente afectado no ejecutó su job. Flutter ausente se informa
  como PENDIENTE.
- **editorconfig-checker:**
  - Se desactiva solo `IndentSize`: 377 falsos positivos en Markdown (listas con 3 espacios); en TypeScript la
    sangría la controla Prettier.
  - Se excluyen los archivos gestionados por Spec-Kit y Claude (`.claude/`, `.specify/` salvo `memory/`) y el
    lockfile.
  - Las demás reglas siguen activas: se corrigieron dos espacios finales reales en `schema.prisma`.
- **OMITIDO y PENDIENTE nunca son PASS:**
  - oasdiff contra `main` queda OMITIDO: no hay baseline. Se desbloquea al fusionar el contrato en `main`.
  - El cliente Dart regenerado queda PENDIENTE (T069/T070).
  - El job `flutter` (T050) espera a US7.
  - `run-local.sh flutter` sale con 3.
- **Hallazgo bloqueante de osv-scanner:** `effect@3.20.0` (transitiva de `prisma` → `@prisma/config`, CLI y carga de
  configuración, fuera del camino de las peticiones) tiene GHSA-7589-6fvf-x4pw, ReDoS con CVSS 8.7; está corregida en
  3.22.1. La Constitución II prohíbe fusionar dependencias con vulnerabilidades altas o críticas, y el gate falla
  correctamente. Las moderadas (`glob@10.5.0` 6.3, `minimatch@9.0.9` 6.9) se informan sin bloquear. **Decisión
  pendiente:** un override de pnpm a `effect@3.22.1` (verificando compatibilidad con Prisma 7.10.1) o una aceptación de
  riesgo con plazo. No se cambió ninguna dependencia.
- **Observación del contrato** (pruebas negativas): `DevProbeItem` y los demás esquemas de respuesta de dev-probe no
  declaran `additionalProperties: false`. Una propiedad extra en una respuesta real cumple el contrato y no se
  detecta. Endurecerlo es una decisión contractual pendiente.
- **Pruebas negativas** (worktree temporal, sin cambios permanentes; el probador versionado es T087): se detectaron
  TypeScript roto, contrato inválido, respuesta con tipo fuera de contrato, dependencia arquitectónica prohibida,
  prueba unitaria fallida, política RLS ausente (migración que la borra, vía el gate de PostgreSQL), migración sin
  prerrequisitos, cobertura bajo el umbral, suite obligatoria omitida o con `skip`, y job afectado saltado.

### Hotfix de seguridad G12: effect GHSA-7589-6fvf-x4pw (2026-11-23)

- **Hallazgo:** `effect@3.20.0`, ALTA (CVSS 8,7, CVE-2026-121707), llega solo por `prisma@7.10.1` →
  `@prisma/config@7.10.1`, que la fija de forma exacta. Prisma no tiene una 7.x estable posterior: `7.11.0-dev.2` ya
  usa 3.22.1, pero es prerelease.
- **Decisión:** override de pnpm acotado al consumidor, `'@prisma/config>effect': 3.22.1`, en `pnpm-workspace.yaml`.
  No añade dependencias nuevas: es la misma, en su versión corregida.
- **Endurecimiento de `osv-gate.mjs`:** ahora falla en cerrado ante informes inválidos o incoherentes, y lo cubre la
  prueba `scripts/ci/tests/osv-gate.test.sh`.
- **Riesgo residual:** la copia de `effect` empaquetada en la CLI de Prisma sigue siendo 3.20.0 (sin uso de `TemplateLiteral`).
- **Detalle:** el registro completo (explotabilidad, compatibilidad, pruebas negativas y condiciones para retirar el
  override) está en `docs/security/SEC-2026-001-effect-ghsa-7589.md`.

### Minimización de `audit_events.origin` (2026-11-23, Aprobación 5)

- **Cambio:**
  - `origin` pasa a ser un origen lógico de una lista cerrada (`AUDIT_ORIGINS`, hoy solo `http`);
  - `AuditActorGuard` ya no lee la solicitud ni calcula `ip-hash`;
  - `AuditService` rechaza cualquier otro valor;
  - sin cambio de esquema, y los eventos históricos no se tocan.
- **Detalle:** data-model.md (`audit_events.origin`) y `docs/security/audit-origin-privacy-assessment.md` §6.
- **Hallazgo pendiente:** el log de acceso de pino-http registra `remoteAddress`, `remotePort` y los encabezados de red.
  No se corrigió, porque está fuera del alcance.
- **Arnés de pruebas:** en `audit.spec.ts`, las llamadas HTTP posteriores a los bloques que crean y cierran un segundo
  módulo de Nest con `ClsModule.forRoot` responden 500. Por eso las pruebas HTTP de minimización van antes de esos
  bloques. Es un efecto de tener dos aplicaciones en el mismo proceso, no del runtime (que tiene una sola).

### Hotfix de privacidad de logs HTTP (2026-11-23, Aprobación 6)

- **Causa raíz:** los serializadores por defecto de pino-http registraban la URL con query, `query`, `params`, todos
  los encabezados, `remoteAddress` y `remotePort`. Lo hacían en el log de acceso y, mediante el logger hijo
  `{ req }`, en cada log de la aplicación dentro de una solicitud. El enmascarado de `formatters.log` no se aplica a
  esos bindings.
- **Cambio:**
  - serializadores por lista permitida: `req: { method }`, `res: { statusCode }`;
  - `route` como plantilla (`unmatched` si no hay coincidencia), `responseTime`, `correlation_id` y la categoría del
    error;
  - omisión de objetos HTTP crudos bajo otras claves;
  - `redact` como defensa adicional;
  - sin dependencias nuevas.
- **Pruebas:** capturan el JSON real (`http-logging-privacy.spec.ts`), corren en un archivo con aplicación y base
  propias, y pasan en orden aleatorio.
- **Arnés de `audit.spec.ts`:** las llamadas HTTP posteriores a cerrar un segundo módulo de Nest devuelven 500. No
  afecta a estas pruebas, que viven en otro archivo (Vitest aísla cada archivo). La causa no se ha determinado y queda
  para un bloque aparte.
- **Pendiente:** el log de acceso registra `request errored` con nivel `info` (comportamiento previo, sin cambiar).
- **Alcance:** los logs de PostgreSQL e infraestructura (C, D) no se han revisado.
- **Detalle:** `docs/security/http-log-minimization.md`.

### US4 TypeScript: T058, T060 y T065 (2026-11-23)

- **T058:**
  - **Dependencia:** fast-check **4.11.0**, exacta, como devDependency de `backend`. Es la versión aprobada en la tabla
    de versiones y en plan.md ("fast-check 4"). Añade solo `pure-rand` 8.4.2. La copia 3.23.2 que llega por
    `effect` (Prisma) no se usa.
  - **Archivo:** `backend/test/property/money.property.spec.ts`, con 14 propiedades. Las tres literales de T058
    (`allocate` conserva la suma, `add`/`subtract` son inversas, `multiply` por 1 es identidad) y otras que ya son
    reglas de ADR-0007 o de la API de T061: identidad y asociatividad dentro del dominio, ida y vuelta JSON y de
    presentación, separación de monedas, dominio simétrico sin truncar ni saturar, JSON no canónico, catálogo cerrado,
    `TOO_MANY_DECIMALS` y reparto simétrico de negativos. No fija ningún redondeo de negocio (D-FIN-02).
  - **Reproducibilidad:** semilla fija 20261123 y 1000 ejecuciones por propiedad, más ejemplos con los bordes del
    dominio y valores > 2^53. `KUOTA_FC_SEED`, `KUOTA_FC_PATH` y `KUOTA_FC_RUNS` permiten reproducir y ampliar.
  - **Mutaciones** (worktree temporal): 4 de 5 detectadas con contraejemplo. Fueron: `allocate` sin repartir el residuo,
    `subtract` inexacto para montos grandes, JSON vía `number` y dominio saturado. La quinta (`multiply` ignora el
    exponente del factor) es equivalente para T058: `MoneyDecimal` normaliza el 1 a `"1"`. La rama la cubre
    `money.spec.ts`.
- **T060:** `backend/test/fixtures/float-violation.ts.txt`. La extensión `.ts.txt` lo excluye de tsc, ESLint, Vitest y
  Prettier. Cada infracción (`amount: number`, `parseFloat`, `toFixed`) va marcada con `ANTI-FLOAT`.
- **T065:**
  - **`scripts/ci/check-no-float.sh [ts|dart|all]`:**
    - `ts` exige que la configuración real de ESLint rechace cada línea marcada en `src/common/money/` y en
      `src/**/domain/` (`backend/scripts/check-no-float.ts`, sin análisis de tipos para ese archivo virtual), y que el
      lint real pase;
    - `dart` delega en `scripts/ci/check-no-float-dart.sh`: análisis léxico que ignora comentarios y literales (raw
      incluidos) y prohíbe `double`, `num` y `toDouble()`. Si el paquete no existe, sale con 3 (PENDIENTE).
  - **Integración en el job `backend`:** `check-no-float.sh ts` y su autoverificación `tests/check-no-float.test.sh`
    (21 casos).
  - **Pendiente de T082 y T050:** la parte Dart se integrará en el job `flutter`. Por eso **T065 queda sin marcar**.
- **Alcance de la regla TS:** las rutas de R-10 (`common/money`, `**/domain`).
  - Las capas `interface/`, `application/` e `infrastructure/` no las cubre. Hoy no contienen punto flotante: los
    `Number(…)` que hay son de configuración, paginación y versiones de app.
  - El dinero cruza como `bigint`, con `BigInt` en Prisma y `string` en JSON.
  - Ampliar las rutas es una decisión para 004, cuando existan módulos financieros.
- **Arnés de `audit.spec.ts` (causa determinada):**
  - **Qué pasa:** nestjs-cls 7 usa una instancia única de `ClsPluginsHooksHost` por proceso. Al cerrar el
    `TestingModule` de los bloques "a nivel de servicio", que tiene su propio `ClsModule.forRoot`, el host queda sin
    inicializar. Desde entonces el `ClsMiddleware` de la app HTTP de la prueba responde 500 en toda ruta, incluida
    `/health/live`.
  - **Es determinista y depende del orden.**
  - **Producción:** sin riesgo, porque hay una sola aplicación por proceso.
  - **Corrección propuesta (bloque aparte):** mover esos bloques a su propio archivo o no cerrar módulos CLS mientras
    otra app sigue activa.

### Corrección del arnés de `audit.spec.ts` (2026-11-23)

- **Causa (verificada en nestjs-cls 7.0.2, `cls-plugin-hooks-host.js`):**
  - `ClsPluginsHooksHost._instance` es estático y cada constructor lo sustituye por la instancia más reciente;
  - `onApplicationShutdown()` lo libera si sigue apuntando a sí mismo;
  - el `TestingModule` de los bloques de servicio (posterior a la app HTTP) pasaba a ser la instancia vigente y, al
    cerrarse, dejaba `_instance` sin definir, así que el `ClsMiddleware` de la app viva fallaba con 500 en toda ruta.
- **Corrección:** solo de pruebas. Los bloques "AuditService a nivel de servicio (T077)" y "DELETE a nivel de servicio
  (T078, R3)" pasan, idénticos byte a byte, a `test/integration/audit-service.spec.ts`, con su propia base efímera.
  Vitest aísla cada archivo. La configuración CLS de producción no cambia.
- **Guarda:** al final de `audit.spec.ts`, la app HTTP debe seguir respondiendo (`/health/live` 200 y un `create` 201).
  Falla con la estructura anterior y pasa con la nueva.
- **Evidencia:**
  - 39 títulos de prueba idénticos antes y después, más la guarda;
  - `audit.spec.ts` (32) y `audit-service.spec.ts` (8): 3 ejecuciones en orden aleatorio cada uno, 5 repeticiones de
    `audit.spec.ts` y ambos juntos en orden aleatorio, todo en verde;
  - `audit-service.spec.ts` se añade a las suites obligatorias.
- **Nota previa superada:** las pruebas de minimización de `origin` siguen en `audit.spec.ts`. Su ubicación ya no
  depende del orden.

### US7a: workspace Flutter (T080–T084, 2026-11-23)

- **SDK:** Flutter 3.50.1 / Dart 3.14.0 vía FVM (`flutter/.fvmrc`, D-ENV-01), instalado con `fvm install 3.50.1`. La
  instalación global (3.24.3 / Dart 3.5.3) no se tocó.
  - `fvm dart run melos …` antepone el SDK de FVM al `PATH`, así que `dart`/`flutter` dentro de los scripts de Melos
    son los fijados (verificado).
  - `.fvm/` está en `.gitignore`.
- **Dependencias (versiones exactas; resolución única en `flutter/pubspec.lock`):**

  | Paquete | Versión | Justificación |
  |---|---|---|
  | `decimal` | 3.2.6 | La aprobada en la tabla de versiones; existe 3.2.7 y no se actualizó |
  | `melos` | 8.10.1 | La aprobada; dependencia de desarrollo de la raíz, sin instalación global |
  | `lints` | 6.1.0 | Base de `analysis_options.yaml` (ADR-0003: lints compartidos estrictos) |
  | `test` | **1.32.0** | La 1.33.0 exige `test_api` 0.7.15, y `flutter_test` de Flutter 3.50.1 fija 0.7.14 |
  | `yaml` | 3.1.4 | `check_deps` y la prueba de estructura leen pubspecs |
  | `path` | 1.9.1 | Rutas en `check_deps` |
  | `material_ui` | 1.11.1 | `flutter.dev`. `package:flutter/material.dart` está deprecado desde Flutter 3.47, y con `--fatal-infos` el aviso hace fallar el análisis. Se adopta el reemplazo oficial en vez de silenciar la deprecación o rebajar la severidad. ADR-0003 no fija ningún paquete de Material |
- **Estructura creada:**
  - `flutter/.fvmrc`, `flutter/pubspec.yaml` (`name: kuota_workspace`, `workspace:`, `sdk: ^3.14.0`, sección `melos:`
    con `analyze`, `format`, `test`, `test:financial` y `generate`), `flutter/analysis_options.yaml` (estricto,
    `page_width: 120`);
  - `packages/shared_core` (T081), `packages/financial_domain` (T082) y `packages/design_system` (T083);
  - `tool/check_deps.dart` y su prueba con el pubspec defectuoso de referencia (T084).
- **T080 queda ABIERTA (bloqueo de dependencia):**
  - Su criterio literal pide `workspace:` "con 3 apps y 4 paquetes", pero las apps son T085 y `api_client` es
    T069/T070, y pub rechaza un workspace con miembros inexistentes.
  - `workspace:` contiene hoy los 3 paquetes que existen; T085 y T069/T070 añaden los suyos al crearlos.
  - Propuesta de enmienda en approvals.md.
- **Melos:**
  - Los scripts no invocan `melos` (no hay binario global): usan `exec:` con `packageFilters` y `steps`. `test` =
    `test:dart` + `test:flutter` + `test:tool`.
  - `generate` sale con su mensaje PENDIENTE mientras no exista `scripts/contracts/generate-dart-client.sh` (T069);
    Melos lo marca como FAILED, nunca como éxito.
- **`check_deps`:** además de los pubspecs (`dependencies`, `dev_dependencies` y `dependency_overrides`, por nombre o
  por `path`), revisa los imports. En un pub workspace la resolución es compartida y una app podría importar
  `package:<otra_app>/…` sin declararlo. También revisa miembros que falten en `workspace:`. Un YAML inválido termina
  con salida 2, no con una excepción.
- **Anti-float Dart (parte Dart de T065):**
  - **Sobre `financial_domain/lib` real:** PASS **trivial**. Son 2 archivos sin código ejecutable, porque Money es
    T063, pero sus comentarios mencionan `double`, `num` y `toDouble()` y la regla no da falsos positivos.
  - **Sobre una copia con `final double amount`:** FAIL en la línea exacta.
  - **Directorio sin archivos `.dart`:** ahora es PENDIENTE (3), no PASS.
  - Su integración en el job `flutter` depende de T050, así que **T065 sigue abierta**.
- **CI:**
  - Con `flutter/pubspec.yaml` presente, el job `flutter` del workflow se ejecutaría al cambiar `flutter/` o el
    contrato y llamaría a `scripts/ci/flutter.sh`, que no existe (T050). Fallaría y `CI: resultado` quedaría en rojo:
    es el comportamiento cerrado esperado hasta T050.
  - `run-local.sh flutter` sigue en PENDIENTE (3) y lista los controles locales disponibles.
- **Arranque desde una instalación limpia:**

  ```bash
  fvm install          # en flutter/: instala la versión de .fvmrc (3.50.1)
  cd flutter && fvm flutter pub get                   # resolución única (flutter/pubspec.lock)
  fvm dart run melos run analyze && fvm dart run melos run format && fvm dart run melos run test
  fvm dart run tool/check_deps.dart && ../scripts/ci/check-no-float.sh dart
  ```

  El `flutter/README.md` con los comandos móviles es parte de T086.

### Enmienda de T080 en dos etapas (2026-11-23, Aprobación 7)

- **Ciclo:** T070 → T080 → (`api_client` de T070 y apps de T085) → T070. Pub no admite miembros inexistentes.
- **Resolución:**
  - T080 tiene una etapa **A** (inicialización, cumplida en `b9cffcf`) y una etapa **B** (3 apps y 4 paquetes en
    `workspace:`), ambas obligatorias para marcarla;
  - T059, T063 y T070 dependen de A;
  - T070 añade `api_client` y T085 añade las apps, con lo que cierra B.
- **Estado:** T080 sigue **sin marcar**. La propuesta anterior (que la etapa B "dejara de exigirse") se descarta: no se
  debilita el criterio final.

### T071, T050 y T085: CI de Flutter y las tres apps (2026-11-23)

- **SDK exacto en CI sin acciones de terceros:**
  - `scripts/ci/setup-flutter.sh` descarga el archivo oficial `flutter_linux_3.50.1-stable.tar.xz` y verifica su
    sha256 fijado (`4ad17fc8…2678`, de `releases_linux.json`).
  - `lib.sh` (`use_project_flutter`) antepone ese SDK, o el de FVM en local, al `PATH` y comprueba que la versión
    coincide con `.fvmrc`. Sin SDK válido, falla.
  - Equivale al `fvm flutter …` de T050 (misma versión y origen oficial). FVM solo se usa en local.
- **T071:**
  - `contracts.sh` regenera el cliente y exige `git status` limpio en `api_client`, lo que también detecta archivos
    nuevos o eliminados. Se niega a ejecutarse con cambios previos sin confirmar y nunca se omite. El job `contracts`
    prepara el SDK.
  - `backend`: script `test:contract` (30 pruebas).
  - Negativas en un worktree temporal: contrato cambiado sin regenerar, generado editado a mano, cambios previos y
    falta de SDK fallan.
- **T050 (`scripts/ci/flutter.sh`):**
  - **Controles:** `pub get --enforce-lockfile`, `melos analyze`, `format` y `test`, `check_deps`, anti-float Dart,
    osv-scanner y builds de Android (APK debug) y Web (release).
  - **Escaneo Dart:** osv-scanner (Pub) lee `flutter/pubspec.lock` con `--all-packages`. `tool/osv_coverage.dart`
    exige que cada paquete alojado esté en el informe (102/102; los 4 del SDK no están en OSV) y `osv-gate.mjs`
    evalúa la severidad. `dio` 4.0.0 (GHSA-9324-jv53-9cc8, 7,5) queda bloqueado.
  - **Anti-float Dart:** PENDIENTE (nunca PASS) mientras `financial_domain/lib` no tenga código; solo comentarios o
    `library;` no cuentan.
  - **Negativas:** `shared_core` con Flutter, lockfile desalineado, `double` en `financial_domain` y código sin formato
    hacen fallar el job.
  - **iOS:** fuera de CI (Clarification 2026-11-22).
- **T085:**
  - **Apps:** `admin_web` (Web, shell provisional de D-ARC-03), `collector_mobile` y `client_mobile` (Android e iOS),
    con un `ProviderScope` de Riverpod 3.5.0 (R-19).
  - **Pantalla común:** `design_system.KuotaStartupScreen`, alimentada por `api_client.classifyCompatibility`.
    "Compatible" solo con `client_supported: true` del servidor; `app-version-unsupported` → incompatible; red o
    502/503/504 sin problem+json → no disponible.
  - **Configuraciones:** `flutter/config/{local,testing,staging,production}.json`. Staging y production dejan la URL
    vacía hasta D-ARC-04: la app muestra "configuración inválida", sin URL inventada.
  - **Identificadores de app:** `app.kuota.*` son **PROVISIONALES**, porque ningún documento los fija. Hay que
    confirmarlos antes de publicar en tiendas.
  - **Plataformas:** permiso `INTERNET` en el manifiesto principal de Android, HTTP sin TLS solo en debug (emulador:
    `--dart-define=KUOTA_API_BASE_URL=http://10.0.2.2:3000`) y `NSAllowsLocalNetworking` en iOS.
  - **`.editorconfig`:** deja la indentación de los archivos de Xcode a Xcode.
- **Evidencia real (2026-11-23):**
  - **Emulador Android 14 (Pixel 3a):** `collector_mobile` y `client_mobile` muestran "Compatible con Kuota Core / API
    1.0.0" contra el backend local, y "Kuota Core no disponible / network-error" con el backend apagado.
  - **`api_client` desde la VM:** Compatible, Incompatible (`MIN_SUPPORTED_COLLECTOR=0.2.0`) y ApiUnavailable;
    `/health/live` 200 y `/health/ready` 503 sin base de datos.
- **BLOQUEOS y huecos:**
  - **CORS (hueco de especificación):** el backend no define CORS. En Chrome, `admin_web` envía el preflight `OPTIONS`
    (404) y nunca llega el `GET`, así que muestra "no disponible". La política de CORS (orígenes por entorno) es una
    decisión pendiente; no se cambió el backend.
  - **iOS local:** BLOQUEADO. Xcode 26.3 trae el SDK del simulador iOS 26.2, pero solo está instalado el runtime iOS
    18.6 ("Found no destinations"). Falta instalar la plataforma iOS 26.2, un cambio del sistema no autorizado. Lo
    verifica el checkpoint de T086 (SC-008).
- **No marcadas:** T052 (workflow nunca ejecutado en GitHub) y T049 (oasdiff contra `main` sigue OMITIDO sin baseline).
- **Intermitencia de infraestructura observada:** `test/contract/kuota-core.contract.spec.ts` falló dos veces en esta
  sesión por Docker bajo carga, nunca por una aserción:
  - un timeout de 30 s al publicar el puerto del contenedor;
  - un "409 cannot remove container… is running" en el desmontaje, justo después de los builds Android.

  El job `backend` lo marcó como FAIL, como debe, y al repetirlo pasó 13/13 (648/648). Pendiente: revisar el
  arranque y desmontaje de Testcontainers de ese archivo, o los recursos de Docker del runner, antes de depender de
  CI remoto.

### Cierre de conectividad Web, iOS y Testcontainers (2026-11-23, Aprobación 8)

#### CORS para Kuota Admin (T097)

- **Decisión:** `KUOTA_CORS_ALLOWED_ORIGINS`, lista separada por comas de orígenes **exactos y canónicos**
  (`esquema://host[:puerto]`, tal como los envía el navegador en `Origin`), validada al arrancar (`loadConfig`).
  - Se rechazan `*` y cualquier comodín, `null`, esquemas distintos de http/https, rutas, barras finales,
    credenciales, mayúsculas en el host y puertos por defecto explícitos.
  - Fuera de local/testing: solo `https` y nunca loopback.
  - Vacía o ausente: **sin CORS** (no se registra el middleware; el navegador bloquea toda lectura de otro origen).
  - Local (`.env.example`): `http://localhost:8080`, el puerto fijo de `flutter run -d chrome --web-port 8080`.
- **Mecanismo:** `app.enableCors` de NestJS (paquete `cors` 2.8.6, ya dependencia de `@nestjs/platform-express`; no se
  añadió ninguna dependencia) con `origin` como lista de cadenas: comparación exacta, nunca se refleja un origen ajeno.
  - Métodos: `GET` (lo único que usa hoy el contrato `client`).
  - Encabezados permitidos: `X-Correlation-Id`, `X-App-Version`. Expuesto: `X-Correlation-Id`.
  - `credentials: false` (sin `Access-Control-Allow-Credentials`; no hay requisito aprobado), `Max-Age` 600 s.
- **Comportamiento:**
  - origen permitido → `Access-Control-Allow-Origin` con ese origen y `Vary: Origin`, también en errores problem+json;
  - origen no permitido → nunca `Access-Control-Allow-Origin`: el navegador no supera el preflight ni deja leer la
    respuesta. El preflight responde 204 sin permiso (comportamiento estándar de `cors`), no 403;
  - método o encabezado fuera de la lista → el preflight solo anuncia los permitidos y el navegador rechaza;
  - sin `Origin` (apps móviles, servidores) → sin cabeceras CORS, respuesta normal.
- **Límites:** CORS es una protección del navegador, no un control de acceso: un cliente que no es navegador ignora
  estas cabeceras. La autenticación y autorización siguen siendo responsabilidad de 002. Los preflight los atiende el
  middleware `cors` antes del logging HTTP de Nest, así que no aparecen en los logs de solicitudes.
- **Cuando lleguen operaciones `client` con otros métodos o encabezados** (p. ej. `POST` con `Idempotency-Key`), la
  lista de `backend/src/common/http/cors.ts` se amplía junto con el contrato.
- **Evidencia:** pruebas unitarias de configuración (orígenes válidos e inválidos por entorno) y `cors.spec.ts` sobre
  la app real (origen permitido y no permitido, preflight válido y no permitido, encabezados personalizados, error 404
  problem+json, sin `Origin`, sin lista). En Chrome real (headless, `admin_web` release servido en
  `http://localhost:8080`, backend local con la lista):
  - "Compatible con Kuota Core / API 1.0.0", versión 0.1.0+1, y el `GET /v1/meta/compatibility` registrado en el log
    del backend con el `X-Correlation-Id` generado por la app;
  - con `MIN_SUPPORTED_ADMIN=0.2.0`: "Versión no soportada: actualiza la app / Versión mínima soportada: 0.2.0";
  - la misma app servida desde `http://localhost:8081` (no permitido): "Kuota Core no disponible / network-error", y
    ningún `GET` llega al backend.

#### iOS: BLOQUEADO por espacio en disco

- **Verificado:** Xcode 26.3 (17C529) activo; SDK iOS 26.2 y simulador iOS 26.2 presentes; único runtime instalado iOS
  18.6 (8,2 GB); macOS 26.1 en arm64; Flutter 3.50.1.
- **Bloqueo demostrado:** `xcodebuild -showdestinations` del `Runner` no ofrece ningún destino: "iOS 26.2 is not
  installed. Please download and install the platform from Xcode > Settings > Components" (también para "Any iOS
  Device"). Xcode 26.3 no usa los simuladores iOS 18.6 sin la plataforma 26.2. `flutter doctor`: "iOS 26.2 Simulator
  not installed".
- **Disponibilidad y tamaño** (índice oficial de Apple `index2.dvtdownloadableindex`): iOS 26.2 (23C54), variante
  arm64, **8 388 683 973 bytes (7,81 GiB)**; universal, 9,75 GiB.
- **Espacio:** 10,30 GiB libres de 460 GiB (98 % usado). La instalación dejaría unos 2,5 GiB, o menos si la
  importación copia la imagen; con Docker y los builds de Android en el mismo volumen, el riesgo de agotar el disco a
  mitad de la instalación es alto. **No se instaló.**
- **Para desbloquear (decisión del responsable):** liberar al menos unos 20 GiB (por ejemplo, eliminar el runtime iOS
  18.6 si no se usa, o la caché de builds de Docker) y ejecutar
  `xcodebuild -downloadPlatform iOS -buildVersion 26.2 -architectureVariant arm64`. Después: `flutter doctor`, destinos,
  build y arranque de `collector_mobile` y `client_mobile` en el simulador (comandos en `flutter/README.md`).

#### Testcontainers: 409 "container is running" en el desmontaje

- **Causa (logs de Docker Desktop, `dockerd.log`, contenedor `3be932d8b85c` del fallo de las 11:50):**
  - 17:50:26.8 Z `docker stop -t 0`: "Container failed to exit within 0s of signal 2 - using the force" (SIGKILL);
  - 17:50:36.9 Z "Container failed to exit within 10s of kill - trying direct SIGKILL";
  - 17:50:50.3 Z el shim se desconecta: el proceso terminó unos **23 s** después del stop;
  - en la misma ventana, la VM no podía crear procesos ("unable to create new parent process") y los health checks
    caducaban: la VM de Docker estaba saturada justo después de los builds de Android.
  - `container.stop()` de testcontainers 12.2.2 envía `stop` con `t=0` y, en cuanto Docker responde, `rm` **sin
    force**. Docker respondió al `stop` antes de que el proceso terminara (sus esperas internas tras el SIGKILL están
    acotadas) y el `rm` llegó con el contenedor aún en marcha: 409.
- **No es** concurrencia entre suites (cada archivo tiene su propio contenedor y un único `stop`), ni Ryuk (actúa al
  terminar el proceso), ni un timeout de Vitest.
- **Corrección** (`backend/test/support/postgres.ts`): `stop` sin `remove` → `wait --condition not-running` (límite 120
  s; si se agota, error explícito con el estado) → `rm` con volúmenes. Sin `force`, sin reintentos y sin silenciar
  errores. `TestDatabase.stop()` sigue siendo idempotente, y si fallan a la vez el arranque y el desmontaje se lanza un
  `AggregateError` que conserva el error original.
- **Pruebas:** `test/unit/support/container-teardown.spec.ts` fija el orden con dobles que responden 409 si el `rm`
  llega antes de la salida (salida tardía, salida que no llega y fallo del stop).
- **Reproducción bajo carga controlada:** 6 Postgres en paralelo, 1,5 M filas en cada uno, los 8 núcleos del equipo
  saturados y `stop` concurrente: 24 de 24 desmontajes correctos con el código anterior. La carga de CPU sola no basta;
  hace falta la falta de memoria de la VM que provocan los builds de Android. No se forzó para no arriesgar los
  contenedores y volúmenes persistentes del equipo. La regresión de este bloque repite la secuencia real (job
  `flutter` con builds y, a continuación, `backend`).
- **Otro síntoma ya observado** (timeout de 30 s al publicar el puerto en el arranque): misma saturación, pero en el
  arranque; no se cambió.

#### Conteo de pruebas Flutter

- Según el runner (reporter JSON de `dart test`/`flutter test`, como los ejecuta `melos run test`): `financial_domain`
  4, `shared_core` 16, `api_client` 25 (con `dart test`); `design_system` 5, `admin_web` 7, `collector_mobile` 7,
  `client_mobile` 7 (con `flutter test`); `tool/` 15 (`dart test tool/test`). **Total: 86**, 0 omitidas, 0 duplicadas.
  Cada miembro se ejecuta en un único paso de Melos y ningún otro job ejecuta pruebas Flutter (`contracts` solo
  regenera el cliente). El "81" del informe anterior era un error de suma.
- `shared_core` bajo `flutter test` (no es como lo ejecuta CI) da 15 + 1 error: su prueba de `--define` lanza
  `Platform.resolvedExecutable run …`, que bajo `flutter test` no es `dart`. Documentado en `flutter/README.md`.

#### T086

- `scripts/ci/check-single-lockfile.sh`, en el job `flutter` con su autoprueba: un solo `flutter/pubspec.lock`
  versionado, todos los miembros con `resolution: workspace` y ningún `pubspec.yaml` de apps/packages fuera de
  `workspace:`. Las copias defectuosas de referencia (lock en un paquete o en una app, sin lock en la raíz, miembro sin
  `resolution`, app fuera de `workspace:`, miembro inexistente) fallan.
- `flutter/README.md` documenta los comandos de Android, iOS y Web. Los de iOS están **sin verificar** localmente.
- **Checkpoint de US7 NO cumplido:** SC-008 exige iOS verificado localmente.

#### Regresión local del bloque (2026-11-23)

- Secuencia real del fallo original (`general` → `contracts` → `flutter` con builds → `backend`):
  - `general`: 5/5 PASS.
  - `contracts`: 5 PASS + oasdiff contra `main` **OMITIDO** (sin baseline; T049 abierta).
  - `flutter`: 11 PASS + anti-float Dart **PENDIENTE** (sin código en `financial_domain`). Incluye lockfile único y
    su autoprueba, 86 pruebas, osv-scanner, Web release de `admin_web` y APK debug de las dos apps móviles.
  - `backend`: 18/18 PASS; 49/49 archivos, 675/675 pruebas (648 + 27 nuevas de CORS y desmontaje); cobertura 98,53 /
    97,28 / 98,12 / 99,6; idempotencia 100 repeticiones; osv-scanner sobre `pnpm-lock.yaml`. **Sin el 409.**
- Android 14 (emulador) con el backend con CORS activo: `collector_mobile` y `client_mobile` muestran "Compatible con
  Kuota Core / API 1.0.0" (las apps nativas no envían `Origin`; CORS no les afecta).
- Volúmenes `kuota_kuota-pgdata` y `kuota-g6check_kuota-pgdata` intactos; ningún contenedor de Testcontainers residual.
- iOS: BLOQUEADO (ver arriba). T052 sigue abierta: GitHub Actions no se ha ejecutado.

### US4 Dart: T063, T059 y T065 (2026-11-23, Aprobación 9)

- **Validación local de iOS DIFERIDA** por decisión arquitectónica (Aprobación 9: falta de espacio en disco). No se
  descargó, instaló ni ejecutó ningún componente de iOS. SC-008 y el checkpoint de US7 siguen **PENDIENTES DE
  VALIDACIÓN iOS**; Android, Web y Dart VM no los sustituyen.
- **T063 (`flutter/packages/financial_domain/lib/src/money/`):**
  - Misma API, semántica y códigos que `backend/src/common/money/`: `Money.of/zero/parse/fromJson`, `add`,
    `subtract`, `multiply(Decimal, [RoundingMode?])`, `format`, `toJson`, igualdad por valor; `RoundingMode` con los
    seis modos y sus nombres compartidos (`HALF_UP`…); `MoneyError` con `MoneyErrorCode` (`code` idéntico al de TS);
    catálogo cerrado `moneyCurrencies`; `divideRounded`.
  - **Diferencia de forma, no de semántica:** Dart no tiene uniones, así que `allocate(n | ratios)` de TS se expone
    como `allocate(int parts)` y `allocateRatios(List<int> ratios)`. Las partes y proporciones son pesos, no montos.
  - **Exactitud:** montos siempre `BigInt` (nunca `int`, `double` ni `num`, tampoco en web); `multiply` usa la
    fracción exacta del factor (`Decimal.toRational()`) y redondea con `BigInt`, sin intermedios redondeados.
  - **Sin reglas nuevas:** replica las "interpretaciones a confirmar" de R-08 que ya aplica TS (`parse` estricto,
    reparto simétrico de negativos, `HALF_UP` alejándose de cero, argumentos inválidos como `RangeError`/
    `ArgumentError`). Siguen pendientes de confirmación formal; D-FIN-02 (qué modo usa cada operación de negocio) sigue
    pendiente y no se fija.
- **T059 (`test/money_fixtures_test.dart`, `dart_test.yaml` con `platforms: [vm, chrome]`):** los 104 casos de
  `contracts/fixtures/money/core.json`, el catálogo contra `currencies.json`, la ida y vuelta Money → JSON → Money de
  todo monto válido y el rechazo de los `from_json` inválidos. Los archivos se leen en un isolate híbrido de la VM
  (`spawnHybridCode`), porque en el navegador no hay `dart:io`; la misma suite corre en la VM y en Chrome (dart2js).
  - **Paridad:** TypeScript, Dart VM y Flutter Web (dart2js) producen exactamente los valores esperados de los mismos
    fixtures: 104/104 en cada plataforma. Los esperados vienen del oráculo independiente de T056, no de ninguna
    implementación.
  - **No vacía:** 7 mutaciones de Money Dart (HALF_UP, HALF_EVEN, desempate de `allocate`, dominio asimétrico,
    `from_json` con ceros a la izquierda, `parse` sin `TOO_MANY_DECIMALS` y catálogo alterado) fallan en VM y en Chrome.
  - `test/money_test.dart` (14 pruebas, VM y Chrome) cubre lo que los fixtures no cubren, como en `money.spec.ts`.
- **T065 (parte Dart):**
  - `financial_domain/test/fixtures/float-violation.dart.txt`: archivo defectuoso de referencia (5 líneas marcadas
    `ANTI-FLOAT`: `double` en un monto, `num` y `List<num>`, `double.parse`, `toDouble()`, `num.tryParse`) y trampas
    de falsos positivos (comentarios, literales e identificadores como `doubled`).
  - `scripts/ci/check-no-float-dart-reference.sh`: exige que la regla real marque exactamente esas líneas y ninguna
    trampa.
  - El job `flutter` ejecuta la referencia, la autoprueba Dart (`tests/check-no-float.test.sh dart`, 18 casos) y la
    regla sobre el código real de `financial_domain/lib` (5 archivos con código): **PASS**, ya no PENDIENTE.
  - Un `toDouble()` inyectado en `money.dart` hace fallar la regla.
  - Los gates de TypeScript no cambiaron.
- **Quickstart §5:** `pnpm --filter backend test:money` no existía; se sustituyó por el comando real.
- **CI remoto (T052):** `dart test` en Chrome necesita Chrome en el runner de GitHub (las imágenes `ubuntu-latest` lo
  incluyen). No se ha verificado en GitHub.
- **Regresión local:**
  - `general`: 5/5 PASS.
  - `contracts`: 5 PASS + oasdiff **OMITIDO**.
  - `flutter`: 14/14 PASS; 124 pruebas (`financial_domain` 42 = 23 VM + 19 Chrome; el resto, como antes), Web release
    y 2 APK.
  - `backend`: 18/18 PASS; 675/675 pruebas en 49 archivos; cobertura 98,53 / 97,28 / 98,12 / 99,6.
  - Volúmenes intactos.
- **US4: todas sus tareas (T056–T065) están completas** y SC-005 se cumple en backend, Dart VM y Flutter Web.

### Cierre técnico de 001: métricas (T093, T094) y fase 10 (T087–T091) (2026-11-23)

#### Métricas (T094 implementada, pendiente de ratificar el mecanismo; T093 completa)

- **Dependencias** (versiones exactas aprobadas en R-21, sin otras): `@opentelemetry/api` 1.10.0,
  `@opentelemetry/sdk-metrics` 3.1.1 y `@opentelemetry/exporter-prometheus` 0.301.2. Arrastran `@opentelemetry/core`,
  `resources` 3.1.1 y `semantic-conventions`. El escaneo de dependencias Node del job `backend` pasa.
- **`backend/src/common/metrics/`:**
  - `MeterProvider` por aplicación (sin proveedor global) con `PrometheusExporter` (`preventServerStart: true`,
    `withoutTargetInfo`, `withoutScopeInfo`: no se publican versiones, SDK ni datos del host).
  - `http_server_request_duration_seconds{route,method,status}` (histograma, 5 ms–10 s);
    `kuota_http_errors_total{code}`, alimentado por `ProblemDetailsFilter` (T021);
    `kuota_db_pool_connections{state=idle|in_use}` y `kuota_db_pool_waiting_requests`, leídos con
    `TenantPrismaService.poolStats()` (solo contadores; el pool sigue privado y `withTenant` no cambia); proceso:
    `kuota_process_resident_memory_bytes`, `kuota_process_heap_used_bytes`, `kuota_process_cpu_seconds_total` y
    `kuota_process_uptime_seconds` (sin dependencias adicionales).
  - **Escucha propia** en `KUOTA_METRICS_HOST:KUOTA_METRICS_PORT` (por defecto `127.0.0.1:9464`): solo `GET /metrics`
    (otra ruta 404, otro método 405). Con token configurado exige `Authorization: Bearer` comparado con
    `crypto.timingSafeEqual` sobre resúmenes SHA-256, **antes** de delegar en `getMetricsRequestHandler`; si no, 401 con
    `WWW-Authenticate: Bearer` y sin cuerpo. Sin token solo es posible en local/testing con escucha de loopback (guard
    de T016); la tabla Endpoint Access hace opcional la credencial en ese caso.
  - La escucha la abre `main.ts`, no `createApp`, para que las pruebas que crean aplicaciones no compitan por el
    puerto. Si no puede abrirse (p. ej. `EADDRINUSE`), el proceso termina con código 1 y un log `fatal` sin el token.
- **Desviación de mecanismo (requiere ratificación):** T094 dice "interceptor HTTP". Un `NestInterceptor` no ve las
  rutas inexistentes (404 del router) ni los rechazos de guards, y T093 exige medir una ruta inexistente. Por eso la
  medición se hace en un middleware de nivel HTTP (`http-metrics.ts`, montado con `app.use` igual que el contexto de
  solicitud) que registra al terminar la respuesta con la misma normalización del log de acceso (`routeTemplate`:
  plantilla registrada o `unmatched`; método de una lista cerrada u `OTHER`). La etiqueta por plantilla, objetivo de
  T094, se cumple. **T094 queda sin marcar** hasta que el responsable ratifique el cambio de mecanismo.
- **Etiquetas:** solo `route`, `method`, `status`, `code` y `state`, todas acotadas. Nunca tenant, actor, correlación,
  IP, encabezados, URL concreta, query, cuerpos ni montos. Auditoría, logging y CLS no cambian; las métricas no leen
  datos de auditoría.
- **Pruebas (T093, `test/integration/metrics.spec.ts`, 11 pruebas, PostgreSQL 18 real):**
  - acceso: 200 con token; 401 sin token, con token inválido, con otro esquema o vacío; 404/405; el puerto de la API no
    sirve `/metrics`; escucha 127.0.0.1 por defecto; modo local sin token;
  - contenido tras 200, 201, 400, 401, 404 (por id y ruta inexistente), 409, 500 controlado y 20 solicitudes
    concurrentes: series exactas por plantilla (`/v1/dev/probe-items/:id`, `unmatched`), errores por código, pool real
    y proceso;
  - privacidad: ningún UUID, tenant, valor de encabezado, query, IP, correo, token ni versión en la salida;
  - cardinalidad: 30 rutas desconocidas con métodos raros no crean series nuevas;
  - sin efectos: consultar las métricas no cambia `dev_probe_items` ni `audit_events` y no se mide a sí mismo.
  - `main-process.spec.ts`: el proceso real abre la escucha protegida (401/200; 404 en el puerto de la API) y termina
    con código 1 si el puerto está ocupado.
  - **Mutaciones detectadas (5/5):** sin control de token, cabecera sin esquema `Bearer`, URL concreta como ruta, filtro
    sin contador de errores y `target_info`/scope activados.
- **Discrepancia previa encontrada (no corregida, fuera de alcance):** en el puerto de la API, las rutas fuera de `/v1`
  y de `/health` (p. ej. `GET /metrics` o `/foo`) responden el 404 HTML por defecto de Express, no
  `application/problem+json`, y no pasan por el filtro (no suman a `kuota_http_errors_total`, aunque sí se miden como
  `unmatched`). Existe desde T025 (prefijo global con exclusiones). No se cambió el tratamiento de errores.
- **Regresión del backend:** la primera ejecución completa falló al **arrancar** un contenedor de
  `foundation-schema.spec.ts` ("Timed out after 30000ms while waiting for container ports to be bound"; 4 pruebas
  omitidas por ese fallo). Los logs de Docker muestran otra vez la VM sin recursos ("unable to create new parent
  process") con unos 7 contenedores PostgreSQL arrancando en paralelo, sin builds de Android esta vez. La segunda
  ejecución, sola, pasó: 50/50 archivos, 687/687 pruebas, cobertura 98,54 / 96,9 / 98,32 / 99,64 (`common/metrics`
  98,63 / 87,5 / 100 / 100). Riesgo vigente: la concurrencia de Testcontainers contra la memoria de Docker Desktop; no
  se añadieron reintentos ni se cambió la concurrencia (fuera del alcance autorizado).

#### Fase 10

- **T087** `scripts/ci/prove-gates.sh`: worktree temporal sin rama. Para cada defecto, control positivo (el gate real
  pasa con HEAD limpio), defecto aplicado y fallo **con firma** (fallar por otra causa no cuenta). 6/6 probados:
  - secreto (token `ghp_` generado en tiempo de ejecución) → `general.sh`, "Secretos: cambios sin confirmar";
  - `amount: number` en `common/money` → `check-no-float.sh ts`, lint real;
  - tabla con `tenant_id` sin FORCE (migración solo en el worktree, PostgreSQL efímero) → `db-gate.sh`, violación
    exacta de `db:check-rls`;
  - `api_version` deja de ser requerido → `contracts.sh` con `KUOTA_CI_BREAKING_BASE=HEAD`, porque `main` no tiene
    baseline (T049);
  - `@nestjs/common` en `dev-probe/domain/` → lint, `domain-sin-framework`;
  - código de Money sin pruebas → `vitest --coverage` de las suites de Money con los umbrales de `vitest.config.ts` sin
    cambios (alcance limitado a `src/common/money/**`, sin Testcontainers).
  - Meta-prueba: con un defecto inocuo el gate "no bloqueó" y `prove-gates` falla (1); defecto desconocido → 2; sin
    Docker, pnpm o Flutter → 2.
- **T088:** solo documentación → solo `general`, 4 s en local (`quickstart.md` §8). En GitHub, sin medir (T052).
- **T089:** `CLAUDE.md` con los comandos reales y las carpetas existentes.
- **T090:** verificación posterior a la implementación en ADR-0002, 0003 y 0004, sin reaprobarlos ni cambiar estados.
- **T091: ABIERTA.** `validation-report.md`: en un clon limpio, FR-005 se cumple; `doctor`, `install` y `general`
  pasan. `make up` y los tiempos de SC-001 no se ejecutaron (tocarían o crearían volúmenes persistentes) y falta la
  validación del mantenedor. US3-8 registrada como pendiente.

#### T092: análisis de consistencia y convergencia (2026-11-23) — ABIERTA

Ejecutado en modo de solo lectura: `/speckit-converge` añadiría tareas a `tasks.md`, y eso requiere aprobación. Resultado
sobre spec, plan, tasks, ADR, contrato, código, pruebas y CI: 49/49 requisitos (40 FR + 9 SC) con tarea; 32/40 FR
implementados y probados; SC: 4/9 cumplidos, 2 solo en local.

- **CRITICAL (verificados):**
  - **C1 (Constitución X, FR-035):** no hay gate de cobertura bloqueante para Dart (`financial_domain` ≥ 90 %,
    paquetes compartidos ≥ 80 %). `flutter.sh` y los scripts de Melos ejecutan las pruebas sin `--coverage`;
    `plan.md:79` lo da por cumplido. T050 no lo pedía: hueco en la redacción de las tareas.
  - **C2 (Constitución IX):** `lib/src/providers.dart`, `lib/src/app.dart` y `lib/main.dart` son idénticos en las tres
    apps; la Constitución prohíbe duplicar código entre apps. Corregirlo exige decidir el paquete destino (`plan.md`
    fija 4 paquetes).
- **HIGH:**
  - **H1:** `approvals.md` no registra las autorizaciones de G4–G12, US4-TS, US7a, T050/T071/T085, T087–T090 ni
    T093/T094. Se dieron por mensaje en la sesión, pero no constan.
  - **H2:** `contracts.sh` registra OMITIDO si falta la referencia base; cuando exista el baseline debería ser FAIL.
  - **H3:** 404 HTML fuera de `/v1` y `/health` (FR-011), ya registrado arriba.
- **MEDIUM y LOW:** 13 y 9, listados en el informe de cierre. Incluyen: eventos de log de Observability Signals sin
  implementar, SC-009 sin escaneo de los logs de la suite completa, CORS sin FR en spec, migración 0002 sin tarea,
  textos de estado de ADR-0004 y del spec desactualizados, total de tareas 96 → 97.
- **Decisión:** no se corrigió ningún hallazgo CRITICAL, porque todos requieren tareas o decisiones de gobernanza
  nuevas. T092 sigue abierta y **bloquea abrir el PR**.

### Corrección local de los hallazgos de T092 (2026-11-23, Aprobación 10)

#### C1: cobertura Dart (RESUELTO)

- **Texto literal (Constitución X):** "Cobertura mínima en dominio financiero: **90 % de líneas y ramas**; resto del
  backend y paquetes compartidos: 80 %". "Paquetes compartidos" = `flutter/packages/*`; las apps no tienen mínimo.
  Para los paquetes que no son el dominio financiero se exige 80 % de líneas y 80 % de ramas, como el backend aplica 80
  a todas sus métricas.
- **Exclusión única:** `lib/src/generated/**` (cliente OpenAPI de `api_client`, verificado por regeneración en T071),
  con la misma regla que el backend (`vitest.config.ts`: `exclude: ['src/generated/**']`). Su cobertura se informa
  aparte en cada ejecución. La Constitución no menciona el código generado: **se aplica la regla ya establecida en el
  proyecto, pendiente de ratificación expresa.** Ningún archivo escrito a mano se excluye.
- **Implementación:**
  - `flutter/tool/coverage_gate.dart` (7 pruebas): lee el lcov, cuenta líneas (`DA`) y ramas (`BRDA`) sin duplicados
    y falla si un archivo de `lib/` con código no aparece en el informe (ninguna prueba lo carga). Rutas reales: en
    macOS `/var` es enlace de `/private/var`.
  - `scripts/ci/check-dart-coverage.sh`: `dart test -p vm --coverage-path --branch-coverage` (Dart puro) o
    `flutter test --coverage --branch-coverage` por paquete; pruebas fallidas o paquete sin `test/` → FAIL.
  - Paso del job `flutter`.
- **Cobertura medida** (líneas / ramas; "antes" = primera medición de este bloque; "después" = tras C2, que añadió
  código y pruebas en `shared_core` y `api_client`). No hizo falta añadir pruebas solo para alcanzar los umbrales:

  | Paquete | Antes | Después | Mínimo |
  |---|---|---|---|
  | `financial_domain` | 116/118 (98,3 %) / 63/65 (96,9 %) | igual | 90 / 90 |
  | `shared_core` | 91/98 (92,9 %) / 57/61 (93,4 %) | 96/103 (93,2 %) / 61/65 (93,8 %) | 80 / 80 |
  | `api_client` (propio) | 74/77 (96,1 %) / 44/47 (93,6 %) | 75/78 (96,2 %) / 45/48 (93,8 %) | 80 / 80 |
  | `api_client` (generado, informativo) | 210/865 (24,3 %) / 84/418 (20,1 %) | igual | — |
  | `design_system` | 78/78 (100 %) / 31/32 (96,9 %) | igual | 80 / 80 |
- **Pruebas negativas (`prove-gates.sh`, worktree real):** código de Money sin pruebas en `money.dart` →
  "financial_domain: líneas por debajo de 90"; archivo nuevo en `shared_core/lib` que ninguna prueba carga → "tiene
  código y ninguna prueba lo carga". Ambos fallan por el motivo esperado; el código limpio pasa.

#### C2: duplicidad entre apps (PARCIAL: requiere decisión de gobernanza)

- **Responsabilidades de los archivos duplicados:**

  | Pieza | Responsabilidad | Ubicación correcta según `flutter-architecture.md` §3 |
  |---|---|---|
  | Carga de `AppConfig` como `Result` | Configuración de entornos | `shared_core` → **movida**: `AppConfig.tryFromEnvironment/tryFromValues` |
  | Consulta + clasificación de compatibilidad | Cliente HTTP y mapeo de errores | `api_client` → **movida**: `KuotaApiClient.checkCompatibility()` |
  | Providers de Riverpod (config, cliente, compatibilidad) | Composición de la app (estado) | Ningún paquete actual: `shared_core` y `api_client` no dependen de Flutter; `design_system` "no contiene llamadas HTTP" y solo depende de `shared_core` |
  | `CompatibilityStatus` → `StartupStatus` | Traducción de un resultado del cliente a estado visual | Necesita `api_client` + `design_system`; ningún paquete actual puede depender de ambos |
  | `KuotaShellApp` y `StartupPage` | Shell (tema + página de inicio con Riverpod) | Igual que la fila anterior |
  | `main.dart`, `app_info.dart` | Punto de entrada e identidad | **En cada app** (no son idénticos: nombre, `KuotaApp`, comentario) |
- **Siguen idénticos** `lib/src/providers.dart` (≈ 45 líneas) y `lib/src/app.dart` (41 líneas) en las tres apps. El
  hallazgo CRITICAL **no está cerrado**.
- **Alternativas** (no se implementó ninguna: cambian la estructura aprobada):
  1. **Recomendada:** paquete nuevo `flutter/packages/app_shell` (Flutter; depende de `shared_core`, `api_client`,
     `design_system`, `flutter_riverpod`, `material_ui`), con los providers parametrizados por la identidad de la app
     (`AppVersion`, nombre) mediante un override de Riverpod, `startupStatusFor`, `KuotaShellApp` y `StartupPage`. Cada
     app conserva `main.dart` (`ProviderScope` con el override) y `app_info.dart`. Requiere enmendar `plan.md` (4 → 5
     paquetes), `flutter-architecture.md` §3 y una tarea nueva; `check_deps.dart` ya impide que dependa de una app.
  2. Ampliar `design_system` para depender de `api_client` y `flutter_riverpod`: contradice `flutter-architecture.md`
     §3 ("No contiene: lógica de negocio, llamadas HTTP"). No recomendada.
  3. Excepción documentada: no es posible sin enmendar la Constitución (IX dice "NO DEBE duplicarse"). No recomendada.

#### T094 (CERRADA) y H1, H3

- **T094:** ratificada por la Aprobación 10 tras verificar la condición. Desviación registrada en `approvals.md`.
- **H1:** registro de autorizaciones verificadas en `approvals.md`, con citas literales y hora UTC de la transcripción
  local de la sesión. Queda pendiente de confirmación el desglose de G4 (T016–T021), deducido del mensaje de G5.
- **H3 (RESUELTO):** causa: con el prefijo global, `ExpressAdapter.setNotFoundHandler` monta el 404 de Nest solo bajo
  `/v1` y en las rutas excluidas (`/health/{*path}`). Corrección: tras `app.init()`, `createApp` monta un último
  recurso que responde con `ProblemDetailsFilter.respond` (extraído de `catch`, mismo comportamiento). Pruebas
  (`not-found.spec.ts`, 12): 404 problem+json en `/`, `/foo`, `/metrics`, `/v2/...`, `/v1/...` y `/health/...` con
  cualquier método; sin reflejar ruta, query ni encabezados; `X-Correlation-Id` respetado; sin `x-powered-by`; CORS y
  preflight sin regresión; `kuota_http_errors_total{code="not-found"}` +1 y ruta `unmatched`. Contrato sin cambios.
- **H2 (sin cambios, no autorizado en este bloque):** `contracts.sh` registra OMITIDO si falta la referencia base;
  debería ser FAIL cuando exista el baseline de `main` (T049).

#### Regresión y nueva verificación de T092 (2026-11-23)

- **Regresión local**, secuencial y en verde a la primera:
  - `general`: 5/5 PASS.
  - `contracts`: 5 PASS + oasdiff contra `main` **OMITIDO** (T049, sin baseline).
  - `flutter`: 15/15 PASS, incluido el nuevo gate de cobertura. 135 pruebas: `shared_core` 19, `api_client` 26,
    `financial_domain` 42 (VM + Chrome), `design_system` 5, tres apps × 7, `tool` 22. Web release y 2 APK.
  - `backend`: 18/18 PASS; 698/698 pruebas en 51 archivos; cobertura 98,55 / 96,9 / 98,34 / 99,64.
  - `prove-gates.sh`: 8/8 gates probados (los 6 de T087 más 2 de cobertura Dart).
  - iOS no se ejecutó.
- **Estado de los hallazgos** (verificado con evidencia; no se volvió a lanzar el análisis completo):

  | Hallazgo | Estado | Evidencia |
  |---|---|---|
  | C1 | **Resuelto** | Gate en el job `flutter` + 2 defectos de referencia en `prove-gates.sh` |
  | C2 | **Abierto (CRITICAL)** | `providers.dart` y `app.dart` siguen idénticos en las 3 apps (md5); requiere aprobar la alternativa 1 (`app_shell`) |
  | H1 | **Registrado** | Registro verificado en `approvals.md`; queda pendiente de confirmar el desglose de G4 |
  | H2 | Abierto | No autorizado en este bloque; depende de T049 |
  | H3 | **Resuelto** | `not-found.spec.ts` |
  | T094 | **Cerrada** | Aprobación 10 |
- **T092 sigue ABIERTA** (C2). **T091 sigue ABIERTA** (validación del mantenedor; `make up` no se ejecutó contra los
  volúmenes existentes). **T049 y T052 siguen PENDIENTES** (sin GitHub remoto, Aprobación 10).

### C2 resuelto con `app_shell` (T098, Aprobación 11; 2026-11-23)

- **Grafo de dependencias internas** (pubspec, sin las externas):

  | Miembro | Antes | Después |
  |---|---|---|
  | `admin_web`, `collector_mobile`, `client_mobile` | `api_client`, `design_system`, `shared_core` (+ `flutter_riverpod`, `material_ui`) | **`app_shell`** (dev: `api_client`, `shared_core`, `dio` solo para la prueba) |
  | `app_shell` | — | `shared_core`, `api_client`, `design_system` (+ `flutter_riverpod`, `material_ui`) |
  | `api_client` | `shared_core` | igual |
  | `design_system` | `shared_core` (declarado en la arquitectura; hoy sin dependencia efectiva) | igual |
  | `financial_domain` | `decimal` (`shared_core` permitido) | igual |
  | `shared_core` | — | igual |
- **Eliminación de la duplicidad:** desaparecen `lib/src/providers.dart`, `lib/src/app.dart` y `test/startup_test.dart`
  de las tres apps. En cada app quedan dos archivos (42 líneas en total en las tres apps):
  - `main.dart`: `void main() => runKuotaApp(AppInfo.identity);`
  - `app_info.dart`: un `AppIdentity` constante con su nombre, `KuotaApp`, versión y build.

  Sin comentarios, los dos archivos son una línea de declaración por app. La única diferencia son los valores de
  identidad, que son precisamente lo que cada app debe aportar. Los 6 estados de arranque se prueban una sola vez en
  `app_shell` (`startup_test.dart`, `app_shell_test.dart`: 14 pruebas). Cada app conserva 2 pruebas propias: identidad
  contra `pubspec.yaml` y arranque con su nombre y su `X-App-Version`.
- **`check_deps.dart`** (27 pruebas en `tool/`), con reglas nuevas y sus pruebas negativas:
  - grafo de `flutter-architecture.md` §3 (por `pubspec`, `path` e `import`; un paquete sin reglas también falla);
  - `dio`/`http` solo en `api_client` (`dependencies` e imports de `lib/`);
  - con `app_shell` presente, toda app debe depender de él.
- **Cobertura de `app_shell`:** 51/52 líneas (98,1 %) y 31/32 ramas (96,9 %), mínimo 80/80, sin exclusiones. Con 40
  ramas sin pruebas añadidas de forma temporal en el árbol de trabajo, el gate cae a 54,8 % / 42,5 % y falla (exit 1).
- **Lockfile:** `flutter/pubspec.lock` sin cambios (8 miembros, uno solo).
- **Validación funcional:**
  - regresión local en verde a la primera: `general` 5/5; `contracts` 5 + OMITIDO (incluye la regeneración
    determinista de `api_client`); `flutter` 15/15 con 139 pruebas, Web release y 2 APK; `backend` 18/18 con
    698/698; `prove-gates` 8/8;
  - en vivo contra Kuota Core local (CORS activo): `admin_web` en Chrome headless y `collector_mobile` y
    `client_mobile` en el emulador Android 14 muestran su nombre, entorno `local`, versión 0.1.0+1 y "Compatible con
    Kuota Core / API 1.0.0" (3 consultas en el log del backend);
  - con el backend detenido, Collector muestra "Kuota Core no disponible / network-error" y "Reintentar".
  - iOS: DIFERIDO POR DECISIÓN ARQUITECTÓNICA — NO PROBADO.

### T092 tras C2 y comportamiento requerido de H2 (2026-11-23)

- **Verificación dirigida** (no se repitió el análisis completo):
  - **C1 resuelto** (gate de cobertura Dart);
  - **C2 resuelto** (sin archivos de composición duplicados; `check_deps` exige `app_shell`);
  - **H3 resuelto** (problem+json en todo 404);
  - **H1 registrado** (sigue pendiente de confirmar el desglose de G4, deducido y no confirmado);
  - **H2 abierto**;
  - MEDIUM y LOW sin cambios.
- **T092 sigue ABIERTA:** su criterio literal exige ejecutar `/speckit-converge`, que añade tareas a `tasks.md`. Eso
  requiere aprobación (no es silencioso) y no se ejecutó; solo se hizo su equivalente de solo lectura.
- **H2: comportamiento requerido cuando exista el baseline** (no implementado; no se inventa ningún baseline):
  - mientras `main` no contenga `contracts/openapi/kuota-core.v1.yaml` (antes de la primera fusión), OMITIDO con el
    motivo, como hoy;
  - en cuanto `main` contenga el contrato, el baseline pasa a ser **obligatorio**: la ausencia de la referencia base en
    el checkout (p. ej. clon superficial) debe ser **FAIL**, no OMITIDO, y un `main` que haya perdido el contrato
    también;
  - propuesta: una variable versionada (p. ej. `KUOTA_CONTRACT_BASELINE_REQUIRED=true` en el workflow, activada en el
    mismo cambio que fusione el contrato) con una prueba en `breaking.test.sh` de "referencia ausente → FAIL". Requiere
    autorización y depende de T049.

### T092: convergencia local de 001 (2026-11-23)

- **Procedimiento:**
  - Análisis de solo lectura del estado actual (HEAD `1831bde`) con las reglas de `/speckit-analyze` y
    `/speckit-converge`.
  - Verificación de cada hallazgo en el código.
  - Aplicación de `/speckit-converge` según su contrato: sin hooks registrados (`.specify/extensions.yml` no tiene
    `before_converge` ni `after_converge`), sin ramas, y su única escritura es **añadir** `## Phase 11: Convergence` al
    final de `tasks.md`. Se comprobó que el contenido anterior quedó idéntico byte a byte.
  - Autorizado por el responsable para esta convergencia local; no se tocaron spec, plan, Constitución, contratos ni
    ADR.
- **Hallazgos de convergencia → tareas T099–T108:**

  | Tarea | Hallazgo | Tipo | Severidad |
  |---|---|---|---|
  | T099 | Purga cross-tenant sin auditoría duradera (Constitución III) | contradicts | **CRITICAL** |
  | T100 | Regla de dominio sin red de Node, persistencia ni `common/money` (FR-008) | partial | HIGH |
  | T101 | Eventos de arranque y apagado, transición de readiness y conflictos en `debug` (Observability Signals) | partial | MEDIUM |
  | T102 | SC-009 sin escaneo de logs de toda la suite | partial | MEDIUM |
  | T103 | FR-028: eliminación de una propiedad opcional de respuesta sin prueba | partial | MEDIUM |
  | T104 | Regla anti-float por nombres más estrecha que FR-021 (requiere decisión) | partial | MEDIUM |
  | T105 | 0002, roles de mantenimiento y preflight sin tarea (aprobados en A3/A4) | unrequested | LOW |
  | T106 | Gate de regeneración del cliente sin defecto de referencia (FR-029) | partial | LOW |
  | T107 | `doctor.sh` sin prueba automática (US1/AC4) | partial | LOW |
  | T108 | Suites de excepciones de acceso, H3 y CORS fuera de `required-suites.txt` | partial | LOW |
- **Inconsistencias del análisis, sin tarea:**
  - **Corregidas** (documentación ajena a spec, plan y texto de tareas): descripciones de `flutter/pubspec.yaml` (5
    paquetes, Money y generador existentes); `quickstart.md` (S1–S8; `contracts:breaking main` sin base sale con 0; 8
    defectos de referencia); comentario de `prove-gates.sh`.
  - **Requieren aprobación** (cambian spec, plan o el texto de tareas):
    - `spec.md` "Status: Draft";
    - ADR-0004 descrito como propuesto en spec, plan y T090;
    - "Total: 96 tareas" (hay 108);
    - "4 paquetes" en el objetivo de la fase 9 y en la escala de `plan.md`;
    - estructura de `plan.md` sin los archivos nuevos;
    - CORS sin FR ni entrada en Endpoint Access;
    - interpretaciones de Money "a confirmar" y convención `inputs.a.currency` de los fixtures;
    - forma `allocate`/`allocateRatios` de Dart (T063);
    - aplazamiento de las métricas de negocio sin registrar en Complexity Tracking (Constitución XIII).
- **Siguen abiertas por gobernanza** (no se convierten en tareas): T049, T052, T091, SC-008 y el checkpoint de US7,
  H2, US3/AC8 (CODEOWNERS con marcador) y SC-004 en remoto.
- **Resultado:** `tasks_appended` (10 tareas). **T092 sigue ABIERTA**: su criterio exige resolver todo hallazgo
  CRITICAL y T099 lo es; resolverlo exige decidir dónde vive la auditoría de plataforma (estructura nueva y migración
  aditiva, no autorizadas en este bloque).

### T099 y T100 resueltos; cierre de T092 (2026-11-23)

#### T099: auditoría de plataforma (CRITICAL → resuelto)

- **Causa raíz:** la purga de idempotencia (T079) es una operación cross-tenant de plataforma (Constitución III), pero
  solo escribía un recuento en stdout. `audit_events` exige `tenant_id NOT NULL` (lo toma de `app.tenant_id`), así que
  no podía registrarla sin un tenant ficticio. Es la **única** operación de mantenimiento que modifica datos entre
  tenants. `migration-preflight`, `db:check-rls` y `db-gate` solo leen el catálogo; `spike:rls` es local.
- **Compatibilidad verificada antes de implementar:**
  - Constitución III: no es dato de negocio, así que no lleva `tenant_id`; cumple "operaciones de plataforma
    auditadas".
  - Constitución VII: append-only y no editable.
  - ADR-0002 C2-2: tabla de `common`, como exige D-ARC-07 mientras siga pendiente.
  - ADR-0004 P1 (`BEGIN`/`COMMIT`), P3 y P4.
- **Solución:** migración aditiva `0003_platform_audit` con `kuota.platform_audit_events`, documentada en
  `data-model.md`.
  - Permisos y RLS: solo `INSERT` de `kuota_maintenance`; nada para `kuota_app` ni PUBLIC; RLS forzada con una única
    política de INSERT.
  - Integridad: `executed_by` y `occurred_at` los fija el servidor; append-only también para el propietario y el
    superusuario; códigos de resultado acotados; a lo sumo un `started` y un resultado por `run_id`.
  - **Flujo de la purga:** identidad → `started` confirmado antes de borrar (sin auditoría no hay purga) → bloqueo
    consultivo que serializa las ejecuciones → lotes → `succeeded` o `failed` con recuentos y código. Si el resultado
    no puede escribirse, la ejecución falla y el `started` sin final la delata.
  - **CLI:** `run_id` en la salida; correlación opcional (`KUOTA_CORRELATION_ID`, UUID).
- **`db:check-rls`:** ampliado de forma **exacta**. El mantenimiento solo puede hacer `INSERT` en la tabla nueva;
  además se verifican RLS forzada, propietario, ausencia de PUBLIC y de runtime, la política exacta y los 3 triggers.
- **Pruebas:**
  - `platform-audit.spec.ts`, 13 pruebas, añadida a `required-suites.txt`. Cubre los 12 criterios: éxito, sin
    candidatos e inspección, fallo de la operación, fallo al escribir el inicio y el resultado, ejecución repetida,
    concurrencia, ausencia de tenant y de datos sensibles, acceso denegado, integridad, retención, códigos acotados y
    `db:check-rls` con 5 desviaciones.
  - `tenant-transaction-ownership.spec.ts`: una transacción de tenant recibe `42501` al leer o escribir la auditoría.
  - **Mutaciones detectadas 4/4:** fallo sin auditar, sin bloqueo, inicio no bloqueante y sin sello del servidor.
- **Riesgo residual (MEDIUM, sin tarea):** `schema.prisma` debe incluir el modelo (P4: `migrate diff` vacío), así que
  el cliente protegido de `withTenant` expone `tx.platform_audit_events`. La base lo deniega (probado), pero lo
  correcto es excluir los modelos de plataforma del cliente de tenant. Eso cambia `common/tenant-context` (protegido):
  **propuesta de tarea pendiente de autorización**.
- **Bases:** la migración se aplicó solo a bases efímeras (Testcontainers y `db-gate`). La base persistente
  `kuota_kuota-pgdata` (contenedor `kuota-postgres-1`) no tiene historial de migraciones ni la tabla nueva
  (comprobado en solo lectura). `kuota-g6check_kuota-pgdata` no está montado en ningún contenedor.

#### T100: dominio puro con listas de permitidos (HIGH → resuelto)

- **Reglas nuevas en `.dependency-cruiser.cjs`** (las anteriores no cambian):
  - paquetes: solo `decimal.js`;
  - imports no resueltos (alias o paquetes inexistentes): prohibidos;
  - módulos de Node de red, procesos y sistema de archivos: prohibidos;
  - código propio: el dominio solo usa su dominio y `common/money`; `common/money` solo se usa a sí mismo y
    `common/errors/problem.ts`;
  - `problem.ts` no puede tener dependencias.
- **Cobertura de formas de importar:** imports de tipo, reexportaciones e `import()` dinámico.
- **Pruebas:** `dependency-rules.spec.ts` pasa de 7 a 23 casos (16 violaciones y 4 archivos permitidos).
- **Mutaciones sobre el código real:** 10/10 fallan con la regla esperada (`dev-probe/domain` y `common/money`).

#### T092 (CERRADA)

- Criterio literal: ejecutar `/speckit-analyze` y `/speckit-converge` sobre el estado implementado y resolver todo
  hallazgo CRITICAL.
  - Ambos se ejecutaron sobre el estado implementado (HEAD `1831bde`); `/speckit-converge` añadió T099–T108.
  - El único CRITICAL (T099, igual que A1 del análisis) quedó resuelto.
  - La nueva revisión dirigida de los cambios de este bloque contra la Constitución (II, III, VII y VIII) no encontró
    hallazgos CRITICAL nuevos; solo el riesgo MEDIUM anterior.
- **Siguen pendientes, sin marcar:** T101–T108 (MEDIUM y LOW), T091, T049, T052 y SC-008. Las inconsistencias del
  análisis que cambian spec, plan o el texto de tareas siguen pendientes de aprobación.
- **Regresión:** `general` 5/5; `contracts` 5 + OMITIDO; `backend` 18/18 con 729/729 pruebas en 52 archivos
  (cobertura 98,55 / 96,9 / 98,34 / 99,64; `db-gate` con 0003 conforme); `prove-gates` 8/8. `flutter` no se repitió
  porque el workspace no cambió (última ejecución: 15/15).
