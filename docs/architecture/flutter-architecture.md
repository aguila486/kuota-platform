# Arquitectura Flutter

> Estado: ADR-0003 aceptado (2026-11-22). Decisiones cerradas: D-ENV-01 (FVM, Flutter 3.50.1 / Dart 3.14) y D-ARC-02
> (Riverpod). Abierta: D-ARC-03 (tecnología definitiva de `admin_web`; Flutter Web solo provisional para el shell de
> 001, criterios en ADR-0003).

## 1. Prerrequisito de entorno

Dart **pub workspaces** requiere Dart ≥ 3.6. La instalación global (3.24.3 / Dart 3.5.3) no se modifica: el proyecto
fija Flutter 3.50.1 / Dart 3.14 con FVM en `flutter/.fvmrc` (lo crea T080 de 001).

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
- **Melos 8.x** se usa solo para scripts (`analyze`, `test`, `format`, `generate`) y versionado/changelogs por
  paquete. No para `bootstrap`/linking (eso lo resuelve pub workspaces).

## 3. Qué va en cada paquete

| Paquete | Contiene | No contiene | Depende de |
|---|---|---|---|
| `shared_core` | `Result/Failure`, logging con redacción, `Clock`, utilidades de fechas/zonas, almacenamiento seguro (wrapper `flutter_secure_storage`), `DeviceKeyStore`, config de entornos | UI, DTOs, reglas financieras | — |
| `design_system` | Tema, tokens, tipografía, componentes (botones, tarjetas, tablas, montos formateados), recibo de alto contraste, estados de frescura/sync | Lógica de negocio, llamadas HTTP | `shared_core` |
| `api_client` | Código **generado** (DTOs + cliente HTTP, sin operaciones no productivas), interceptores (auth, `X-App-Version`, `X-Correlation-Id`), mapeo de problem+json | Modelos de dominio, lógica; **generación de `Idempotency-Key`** (la clave se crea con la operación y se reutiliza en reintentos, ADR-0003) | `shared_core` |
| `financial_domain` | Modelos de dominio (`Money` con `BigInt` según ADR-0007, `Rate`, `Loan`, `Installment`, `SavingsAccount`), **simuladores puros** (calendario de amortización, aplicación de pago, rendimiento proyectado) con los mismos casos golden que el backend | Persistencia, HTTP, UI, Flutter SDK (Dart puro) | `shared_core` |
| `offline_sync` | Esquema Drift de outbox/snapshot, `CommandOutbox`, `SyncEngine`, máquina de estados, cifrado de BD (SQLCipher) | Pantallas | `shared_core`, `api_client`, `financial_domain` |

Reglas:
- **DTO ≠ dominio**: los repositorios de cada app mapean `api_client` → `financial_domain`. Las pantallas no
  importan DTOs generados.
- Los simuladores producen **proyecciones**; la UI las etiqueta como tales. El saldo autoritativo es el del servidor.
- Duplicar código entre apps está prohibido (Constitución IX): si dos apps lo necesitan, va a un paquete.

## 4. Estructura de una app

```text
apps/collector_mobile/lib/
├── main.dart           # entorno por --dart-define-from-file=config/<entorno>.json
├── app/                # router, tema, providers raíz
└── features/
    └── payments/
        ├── data/       # repositorios (Drift + api_client), mapeadores
        ├── domain/     # casos de uso específicos de la app (si no son compartidos)
        └── presentation/  # widgets + providers (Riverpod)
```

## 5. Estado y navegación

- **Riverpod** (D-ARC-02, aprobada) con generación de código: providers para repositorios, `AsyncNotifier` para flujos.
  Los providers orquestan estado de UI; las reglas viven en `financial_domain` y el estado de sincronización en
  `offline_sync` (ADR-0003).
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

## 7. Entornos (FR-032 de 001)

| Entorno | API | Uso |
|---|---|---|
| `local` | Docker Compose local | desarrollo |
| `testing` | servicios efímeros de CI | pruebas automatizadas |
| `staging` | staging | QA y UAT |
| `production` | producción | tiendas |

Configuración por `--dart-define-from-file=config/<entorno>.json` (sin secretos: los móviles no guardan secretos de
servidor). Los identificadores de app por entorno se definen al distribuir (D-ARC-04).

## 8. Pruebas

- `financial_domain`: unitarias + golden numéricos compartidos con backend (fixtures JSON en `contracts/fixtures/`
  o similar, definido en plan) — misma entrada, misma salida.
- `offline_sync`: pruebas de máquina de estados, reintentos, duplicados, reloj desfasado.
- Apps: widget tests de flujos críticos; integración con API mockeada desde el contrato.
