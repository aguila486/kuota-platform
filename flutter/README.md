# Workspace Flutter de Kuota

Tres apps y cuatro paquetes en un único workspace de Dart (ADR-0003, US7). Hoy las apps son **shells**: muestran
nombre, entorno, versión y la compatibilidad con Kuota Core (`GET /v1/meta/compatibility`). No tienen funcionalidad de
negocio ni están listas para usuarios.

| Miembro | Tipo | Plataformas |
|---|---|---|
| `apps/admin_web` | Kuota Admin (shell **provisional**, D-ARC-03) | Web |
| `apps/collector_mobile` | Kuota Collector | Android, iOS |
| `apps/client_mobile` | Kuota Client | Android, iOS |
| `packages/api_client` | Cliente generado del contrato (`client`) + envoltura | Dart puro |
| `packages/shared_core` | `AppConfig`, `Result`, logger sin PII | Dart puro |
| `packages/financial_domain` | Dominio financiero (Money llega con T063) | Dart puro |
| `packages/design_system` | Tema y pantalla de inicio común | Flutter |

Los identificadores `app.kuota.*` (Android `applicationId`, iOS `PRODUCT_BUNDLE_IDENTIFIER`) son **provisionales**:
hay que confirmarlos antes de publicar en tiendas.

## Requisitos

- [FVM](https://fvm.app) con la versión de `.fvmrc` (Flutter 3.50.1 / Dart 3.14.0): `cd flutter && fvm install`.
- Android: Android SDK y un emulador (o dispositivo) con Android 14 o superior.
- iOS (solo local, fuera de CI): Xcode 26.3 **con la plataforma iOS 26.2 instalada**
  (`xcodebuild -downloadPlatform iOS -buildVersion 26.2 -architectureVariant arm64`, unos 7,8 GiB). Sin ella, Xcode no
  ofrece destinos ("iOS 26.2 is not installed") y no compila ni para simulador ni para dispositivo.
- Web: Google Chrome.
- Kuota Core en marcha para ver la compatibilidad (`scripts/dev/up.sh`, ver `quickstart.md` §1).

Todos los comandos se ejecutan desde `flutter/` salvo que se indique otra carpeta.

## Resolución única del workspace (US7-1)

```bash
fvm flutter pub get                         # un solo flutter/pubspec.lock para todos los miembros
../scripts/ci/check-single-lockfile.sh      # falla si aparece otro pubspec.lock o un miembro sin resolution: workspace
fvm dart run tool/check_deps.dart           # apps no dependen de apps; paquetes no dependen de apps (US7-4)
```

Ningún miembro tiene `pubspec.lock` propio: todos declaran `resolution: workspace` y se resuelven con el de la raíz.

## Análisis, formato y pruebas (Melos)

```bash
fvm dart run melos run analyze --no-select   # dart analyze --fatal-infos de todo el workspace
fvm dart run melos run format --no-select    # dart format --set-exit-if-changed (ancho 120), sin reescribir
fvm dart run melos run test --no-select      # dart test (Dart puro), flutter test (Flutter) y tool/test
../scripts/ci/run-local.sh flutter           # el job de CI completo, incluidos osv-scanner y los builds
```

Los paquetes Dart puro (`shared_core`, `api_client`, `financial_domain`) se prueban con `dart test`, no con
`flutter test`: una prueba de `shared_core` lanza `dart run` como subproceso y bajo `flutter test` el ejecutable no es
`dart`.

## Configuración por entorno

Cada app lee `KUOTA_ENV` y `KUOTA_API_BASE_URL` en compilación desde `config/<entorno>.json`
(`--dart-define-from-file`). `--dart-define=KUOTA_API_BASE_URL=…` después del archivo la sustituye.

| Archivo | `KUOTA_API_BASE_URL` |
|---|---|
| `config/local.json` | `http://localhost:3000` |
| `config/testing.json` | `http://127.0.0.1:3000` |
| `config/staging.json` | vacío: la app muestra "Configuración del entorno inválida" hasta que exista el despliegue (D-ARC-04) |
| `config/production.json` | vacío, por el mismo motivo |

## Apps móviles: Collector y Client

Los ejemplos usan `collector_mobile`; para Kuota Client sustituye la carpeta por `apps/client_mobile`.

### Android

El emulador no ve el `localhost` del equipo: usa `10.0.2.2`. El HTTP sin TLS solo se permite en debug
(`android/app/src/debug/AndroidManifest.xml`).

```bash
fvm flutter emulators                         # lista; arranca uno con: fvm flutter emulators --launch <id>
fvm flutter devices                           # p. ej. emulator-5554
cd apps/collector_mobile
fvm flutter run -d emulator-5554 \
  --dart-define-from-file=../../config/local.json \
  --dart-define=KUOTA_API_BASE_URL=http://10.0.2.2:3000
fvm flutter build apk --debug --dart-define-from-file=../../config/testing.json   # lo que compila CI
```

### iOS (solo local)

El simulador comparte la red del equipo, así que `config/local.json` (`http://localhost:3000`) funciona tal cual;
`NSAllowsLocalNetworking` permite HTTP solo hacia la red local.

```bash
open -a Simulator                             # o: xcrun simctl boot "<dispositivo>"
fvm flutter devices                           # anota el id del simulador
cd apps/collector_mobile
fvm flutter run -d <id-del-simulador> --dart-define-from-file=../../config/local.json
fvm flutter build ios --simulator --debug --dart-define-from-file=../../config/local.json
```

iOS no se compila en CI (Clarification 2026-11-22). **La validación local de iOS está DIFERIDA** por decisión
arquitectónica (Aprobación 9 en `specs/001-platform-foundation/approvals.md`, falta de espacio en disco): mientras siga
vigente, no se descargan runtimes ni se ejecutan los comandos de arriba. Estos comandos **no se han probado** en la
máquina de referencia y SC-008 sigue pendiente de validación en iOS.

### Qué debe verse

- Backend en marcha: "Compatible con Kuota Core" y la versión de la API.
- Versión por debajo de `MIN_SUPPORTED_*` del backend: "Versión no soportada: actualiza la app" con la versión mínima.
- Backend apagado: "Kuota Core no disponible" y el botón "Reintentar".

## Kuota Admin en Chrome

El navegador exige CORS: Kuota Core solo responde a los orígenes exactos de `KUOTA_CORS_ALLOWED_ORIGINS`. En local, el
valor de `.env.example` es `http://localhost:8080`, por eso se fija el puerto web:

```bash
cd apps/admin_web
fvm flutter run -d chrome --web-port 8080 --dart-define-from-file=../../config/local.json
fvm flutter build web --release --dart-define-from-file=../../config/testing.json   # lo que compila CI
```

Con otro puerto u otro host, el navegador bloquea la respuesta y la app muestra "Kuota Core no disponible".
