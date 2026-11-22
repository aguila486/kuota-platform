# Arquitectura Flutter

> Estado: Propuesto (2026-11-22). ADR-0003. Decisiones abiertas: D-ENV-01 (versión Flutter/FVM),
> D-ARC-02 (Riverpod), D-ARC-03 (admin en Flutter Web).

## 1. Prerrequisito de entorno

Dart **pub workspaces** requiere Dart ≥ 3.6. El entorno diagnosticado tiene Flutter 3.24.3 / Dart 3.5.3
(incompatible). Antes de crear `flutter/` se resuelve D-ENV-01 (recomendado: FVM con versión fijada en `.fvmrc`).

## 2. Workspace

```text
flutter/
├── pubspec.yaml              # raíz del workspace: `workspace: [...]` + config de Melos
├── analysis_options.yaml     # lints compartidos (estrictos)
├── apps/
│   ├── admin_web/            # Flutter Web
│   ├── collector_mobile/     # Android/iOS, offline-first
│   └── client_mobile/        # Android/iOS
└── packages/
    ├── shared_core/
    ├── design_system/
    ├── api_client/           # generado desde contracts/openapi
    ├── financial_domain/
    └── offline_sync/         # propuesto (outbox + motor de sync)
```

- Cada paquete/app declara `resolution: workspace`; una sola resolución de dependencias y un `pubspec.lock`.
- **Melos 7.x** se usa solo para scripts (`analyze`, `test`, `format`, `generate`) y versionado/changelogs por
  paquete. No para `bootstrap`/linking (eso lo resuelve pub workspaces).

## 3. Qué va en cada paquete

| Paquete | Contiene | No contiene | Depende de |
|---|---|---|---|
| `shared_core` | `Result/Failure`, logging con redacción, `Clock`, utilidades de fechas/zonas, almacenamiento seguro (wrapper `flutter_secure_storage`), `DeviceKeyStore`, config de entornos | UI, DTOs, reglas financieras | — |
| `design_system` | Tema, tokens, tipografía, componentes (botones, tarjetas, tablas, montos formateados), recibo de alto contraste, estados de frescura/sync | Lógica de negocio, llamadas HTTP | `shared_core` |
| `api_client` | Código **generado** (DTOs + cliente HTTP), interceptores (auth, `Idempotency-Key`, `X-App-Version`, `X-Request-Id`), mapeo de problem+json | Modelos de dominio, lógica | `shared_core` |
| `financial_domain` | Modelos de dominio (`Money` con `Decimal`/enteros, `Rate`, `Loan`, `Installment`, `SavingsAccount`), **simuladores puros** (calendario de amortización, aplicación de pago, rendimiento proyectado) con los mismos casos golden que el backend | Persistencia, HTTP, UI, Flutter SDK (Dart puro) | `shared_core` |
| `offline_sync` | Esquema Drift de outbox/snapshot, `CommandOutbox`, `SyncEngine`, máquina de estados, cifrado de BD (SQLCipher) | Pantallas | `shared_core`, `api_client`, `financial_domain` |

Reglas:
- **DTO ≠ dominio**: los repositorios de cada app mapean `api_client` → `financial_domain`. Las pantallas no
  importan DTOs generados.
- Los simuladores producen **proyecciones**; la UI las etiqueta como tales. El saldo autoritativo es el del servidor.
- Duplicar código entre apps está prohibido (Constitución IX): si dos apps lo necesitan, va a un paquete.

## 4. Estructura de una app

```text
apps/collector_mobile/lib/
├── main_dev.dart  main_staging.dart  main_prod.dart   # flavors
├── app/                # router, tema, providers raíz
└── features/
    └── payments/
        ├── data/       # repositorios (Drift + api_client), mapeadores
        ├── domain/     # casos de uso específicos de la app (si no son compartidos)
        └── presentation/  # widgets + providers (Riverpod)
```

## 5. Estado y navegación

- **Riverpod** (D-ARC-02) con generación de código: providers para repositorios, `AsyncNotifier` para flujos.
  Motivo: inyección de dependencias + estado reactivo en un solo modelo, fácil de sobrescribir en pruebas.
- Navegación con `go_router`; guards de sesión y de bloqueo (PIN, sin sync > 72 h).

## 6. Persistencia local y seguridad

| Dato | Dónde | Protección |
|---|---|---|
| Tokens (access/refresh) | `flutter_secure_storage` (Keychain/Keystore) | nunca en SQLite ni SharedPreferences |
| Llave privada del dispositivo | Keychain/Keystore (hardware-backed cuando exista) | no exportable |
| Cartera y outbox (collector) | Drift + SQLCipher | llave de BD en almacén seguro |
| Caché de consulta (client) | Drift o memoria | sin datos de terceros; se borra al cerrar sesión |
| PIN | hash con sal en almacén seguro, intentos limitados | bloqueo y borrado tras N intentos |

admin_web no persiste datos de negocio; usa memoria y refresh vía cookie `HttpOnly` (ver `docs/security/authentication.md`).

## 7. Entornos (flavors)

| Flavor | API | Uso |
|---|---|---|
| `dev` | Docker Compose local | desarrollo |
| `staging` | staging | QA y UAT |
| `prod` | producción | tiendas |

Configuración por `--dart-define-from-file=config/<flavor>.json` (sin secretos: los móviles no guardan secretos de servidor).
Identificadores de app distintos por flavor para instalar en paralelo.

## 8. Pruebas

- `financial_domain`: unitarias + golden numéricos compartidos con backend (fixtures JSON en `contracts/fixtures/`
  o similar, definido en plan) — misma entrada, misma salida.
- `offline_sync`: pruebas de máquina de estados, reintentos, duplicados, reloj desfasado.
- Apps: widget tests de flujos críticos; integración con API mockeada desde el contrato.
