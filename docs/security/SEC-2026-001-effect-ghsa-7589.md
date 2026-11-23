# SEC-2026-001 — effect: ReDoS en Schema.TemplateLiteral (GHSA-7589-6fvf-x4pw)

| Campo | Valor |
|---|---|
| Estado | **Remediado** mediante override acotado de pnpm (pendiente de retirar, ver §7) |
| Fecha de revisión | 2026-11-23 |
| Advisory | [GHSA-7589-6fvf-x4pw](https://github.com/Effect-TS/effect/security/advisories/GHSA-7589-6fvf-x4pw) · [OSV](https://osv.dev/vulnerability/GHSA-7589-6fvf-x4pw) |
| CVE | CVE-2026-121707 |
| Severidad (OSV) | ALTA, CVSS 8.7 |
| Rango afectado | `effect` `>=0 <3.22.1` (SEMVER, según OSV) |
| Versión afectada instalada | `effect@3.20.0` |
| Versión corregida | `effect@3.22.1` |
| Detectado por | Gate `osv-scanner` del job `backend` (G12, T048) |
| Feature | 001-platform-foundation |
| Autorización | Decisión arquitectónica del responsable de 2026-11-23: remediar; sin aceptación temporal del riesgo, sin allowlist, sin rebajar el gate |

## 1. Dependencia causante

```
backend (workspace)
├── prisma@7.10.1 (devDependency, CLI)
│   └── @prisma/config@7.10.1   ← declara "effect": "3.20.0" (versión exacta)
│       └── effect@3.20.0
└── @prisma/client@7.10.1 (dependency; prisma como peer opcional)
    └── prisma@7.10.1 → @prisma/config → effect
```

- Una sola versión de `effect` en el árbol, y un solo consumidor directo, `@prisma/config` (`pnpm why effect -r`). La
  aplicación no importa `effect` ni `@prisma/config`.
- Uso de `effect` en `@prisma/config` (lector de `prisma.config.ts`): `Schema.Struct`, `String`, `optional`,
  `Boolean`, `Array`, `NullOr`, `NonEmptyString`, `Any` y `decodeUnknownEither`. **No construye ningún esquema
  `TemplateLiteral`**.

## 2. Evaluación de explotabilidad

| Aspecto | Resultado |
|---|---|
| Vulnerabilidad en la versión instalada | **Confirmada** (3.20.0 está en el rango afectado) |
| Código vulnerable | Validación de `Schema.TemplateLiteral` mediante una expresión regular compilada (`ParseResult`, caso `TemplateLiteral`). 3.22.1 sustituye la regex por una comparación lineal cuando todos los segmentos son `string` |
| Uso de `TemplateLiteral` por Prisma | Ninguno: `@prisma/config` no lo usa y, en el bundle de la CLI, solo aparece en el código de la propia librería y en sus exportaciones, sin llamadas desde Prisma |
| Runtime de la aplicación | `effect` **no se carga**: el grafo de AppModule, el cliente generado, `@prisma/adapter-pg` y `@nestjs/terminus` carga 0 módulos de `effect` o `@prisma/config` (verificado con `require.cache`) |
| Alcanzable desde HTTP | **No demostrado.** Ninguna ruta HTTP llega a `effect`, y la entrada que procesa `@prisma/config` es `prisma.config.ts`, que es código versionado y no entrada externa |
| Entorno de compilación/CI | Superficie limitada a `prisma generate/validate/migrate` sobre configuración versionada |
| Conclusión | Explotabilidad **no demostrada**; riesgo de runtime **bajo**; riesgo de compilación **bajo**. El gate ALTA se mantiene por Constitución II, sin excepción por explotabilidad |

## 3. Alternativas evaluadas

| Alternativa | Resultado |
|---|---|
| A. Actualizar Prisma 7 | **No viable.** 7.10.1 es la última 7.x estable (`dist-tags.prev`). `7.11.0-dev.2` ya fija `effect@3.22.1`, pero es una prerelease. `latest` es 8.0.0-rc (mayor, excluido) |
| B. Override de pnpm a 3.22.1 | **Elegida.** Acotado al consumidor (`@prisma/config>effect`), con la misma versión que el propio Prisma adopta en 7.11 |
| Aceptación temporal del riesgo, allowlist o rebajar el gate | **No autorizadas** |

## 4. Cambio aplicado

`pnpm-workspace.yaml` (pnpm 12 lee aquí `overrides`):

```yaml
overrides:
  '@prisma/config>effect': 3.22.1
```

Efecto en `pnpm-lock.yaml`:
- se añade la sección `overrides`;
- `effect@3.20.0` pasa a `effect@3.22.1`, con integridad
  `sha512-TNoXushmPOBAjJlthF5d2QwnX2xBPEtcNJr5XKNKbRLbDvBcOYkXlYDfvGfSA0zriwLFuCll5MDtNMAdZL17PQ==`, idéntica a la
  del registro;
- las dependencias de `effect` no cambian (`@standard-schema/spec` 1.1.0 y `fast-check` 3.23.2);
- no cambia ningún otro paquete y no hay advertencias de peers.

## 5. Pruebas de compatibilidad (2026-11-23)

- **CLI:**
  - `prisma --version` (7.10.1, Node 26.13.1);
  - `prisma validate`;
  - `prisma generate`;
  - carga de `prisma.config.ts` sin errores, con `effect@3.22.1` como único módulo cargado.
- **PostgreSQL 18 efímero:**
  - `migrate status` antes de migrar (exit 1, pendientes) → `migrate deploy` → `migrate status` ("Database schema is up to date");
  - `db-gate`: aprovisionamiento → preflight → deploy → `db:check-rls` con credencial de runtime, más sus dos autoverificaciones.
- **Cliente:**
  - `PrismaClient` + `@prisma/adapter-pg` con `kuota_app_login`;
  - consulta parametrizada;
  - transacción interactiva con `set_config` transaccional, sin fuga fuera de la transacción;
  - rollback propagado;
  - `$disconnect`.
- **Regresión completa** (`scripts/ci/run-local.sh backend`): 11/11 PASS, 610/610 pruebas en 42 archivos, 0 omitidas.
  - Cobertura sin cambios: 98,3 / 96,67 / 97,52 / 99,58.
  - Suites obligatorias, incluidas: tenancy, RLS, `withTenant`, R3, auditoría, idempotencia, purga, Money, contrato y salud.
  - `test:idempotency` 10/10.

## 6. Verificación del gate

- `osv-scanner` sobre el lockfile final: GHSA-7589-6fvf-x4pw ya no aparece. Quedan 2 moderadas informativas:
  - `glob@10.5.0` GHSA-3g3m-2fjr-6pw4 (6,3);
  - `minimatch@9.0.9` GHSA-g3hv-75wg-m249 (6,9).
- **Pruebas negativas** (copias temporales del lockfile, scanner real):

  | Caso | Resultado del gate |
  |---|---|
  | Lockfile previo (`effect@3.20.0`) | FAIL |
  | Lockfile corregido | PASS |
  | Lockfile corregido + `lodash@4.17.20` (otras dos ALTAS) | FAIL |
  | Error de la herramienta (exit > 1) | FAIL en `backend.sh` |

- **Endurecimiento del gate (fail-closed):** la prueba negativa mostró que `osv-gate.mjs` aprobaba en tres casos:
  - un JSON válido sin estructura (`{}`);
  - `results` que no es una lista;
  - vulnerabilidades sin `groups`.

  Ahora:
  - un informe inválido sale con 2;
  - una vulnerabilidad sin grupo bloquea;
  - se exige coherencia con el código de salida del scanner.

  Lo cubre `scripts/ci/tests/osv-gate.test.sh` (19 casos), que se ejecuta como autoverificación en el job `backend`.

## 7. Riesgo residual y condiciones de retirada

- **Copia empaquetada:** `prisma/build/cli.js` (7.10.1) incluye una copia empaquetada del código de `effect` 3.20.0.
  - El override no la cambia y osv-scanner no la ve, porque no figura en el lockfile.
  - No tiene llamadas a `TemplateLiteral`, y la CLI solo procesa configuración y esquemas versionados.
  - Se resuelve únicamente con un Prisma 7.x estable reconstruido con `effect >= 3.22.1`.
- **Retirada del override** cuando haya un Prisma 7.x estable (≥ 7.11.0) cuyo `@prisma/config` declare `effect >= 3.22.1`:
  1. actualizar `prisma`, `@prisma/client` y `@prisma/adapter-pg` juntos;
  2. eliminar `overrides` de `pnpm-workspace.yaml`;
  3. `pnpm install`;
  4. verificar con `pnpm why effect -r` que no queda ninguna versión `< 3.22.1`;
  5. ejecutar `scripts/ci/run-local.sh backend` en verde;
  6. cerrar esta decisión.
- **Si una versión de Prisma requiere otra versión de `effect`:** no se fuerza; se reevalúa esta decisión.
- **Sin efecto en otras decisiones:** no modifica ADR-0002, ADR-0004 ni la Constitución. P2 sigue PARCIAL.
