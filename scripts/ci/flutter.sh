#!/usr/bin/env bash
# Job `flutter` de CI (T050; US3/US7; FR-031..FR-035; R-17, R-19). Lo invoca .github/workflows/ci.yml y lo reproduce
# `run-local.sh flutter`.
#   1. Flutter/Dart EXACTOS de flutter/.fvmrc (FVM en local; en CI, archivo oficial verificado por sha256,
#      scripts/ci/setup-flutter.sh). Sin SDK válido, el job falla.
#   2. `flutter pub get --enforce-lockfile`: resolución única del workspace sin cambiar flutter/pubspec.lock; un solo
#      pubspec.lock y todos los miembros con `resolution: workspace` (check-single-lockfile.sh y su autoprueba, T086).
#   3. `melos run analyze`, `melos run format` y `melos run test` (todo el workspace: paquetes, apps y tool/).
#   4. `tool/check_deps.dart` (US7-4, FR-033).
#   5. `check-no-float-dart.sh` sobre financial_domain/lib: PENDIENTE (nunca PASS) mientras no haya código (T063).
#   6. osv-scanner sobre flutter/pubspec.lock (`--all-packages`): cobertura exigida (cada paquete alojado escaneado,
#      tool/osv_coverage.dart) y severidad con el mismo gate que el backend (scripts/ci/osv-gate.mjs: falla en
#      alta/crítica o informe inválido).
#   7. Build de Android (apps con android/) y Web (apps con web/; `admin_web` es el shell provisional de D-ARC-03, no la
#      tecnología definitiva). iOS queda fuera de CI (Clarification 2026-11-22). Sin apps (T085), PENDIENTE.
# Salida: 0 sin fallos (revisa PENDIENTE: no son aprobaciones); 1 si alguna verificación falló. Requiere Docker y Node.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker
use_project_node
use_project_flutter
FLUTTER_DIR="$KUOTA_ROOT/flutter"
cd "$FLUTTER_DIR"
REPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$REPORT_DIR"' EXIT
note "Flutter $CI_FLUTTER_VERSION ($(dart --version 2>&1 | sed -nE 's/^Dart SDK version: ([^ ]+).*/Dart \1/p')) desde $FLUTTER_ROOT"

melos() { dart run melos run "$1" --no-select; }

anti_float_dart() {
  local status=0
  "$KUOTA_ROOT/scripts/ci/check-no-float-dart.sh" || status=$?
  case "$status" in
    0) record PASS "Anti-float Dart: sin double/num en financial_domain/lib" ;;
    3) record PENDIENTE "Anti-float Dart: sin double/num en financial_domain/lib" \
      "financial_domain aún no tiene código (Money llega en T063)" ;;
    *) record FAIL "Anti-float Dart: sin double/num en financial_domain/lib" "salida $status" ;;
  esac
}

dependency_scan() {
  docker run --rm -v "$FLUTTER_DIR/pubspec.lock:/src/pubspec.lock:ro" "$OSV_SCANNER_IMAGE" \
    scan source --lockfile=/src/pubspec.lock --all-packages --format json >"$REPORT_DIR/osv.json" 2>"$REPORT_DIR/osv.log"
  local status=$?
  if [ "$status" -gt 1 ]; then
    tail -5 "$REPORT_DIR/osv.log"
    return "$status"
  fi
  dart run tool/osv_coverage.dart pubspec.lock "$REPORT_DIR/osv.json" || return 1
  node "$KUOTA_ROOT/scripts/ci/osv-gate.mjs" "$REPORT_DIR/osv.json" "$status"
}

builds() {
  if [ ! -d apps ] || [ -z "$(find apps -mindepth 2 -maxdepth 2 -name pubspec.yaml)" ]; then
    record PENDIENTE "Build de Android y Web" "no existen apps en flutter/apps (T085)"
    return 0
  fi
  local app name
  for app in apps/*/; do
    name="$(basename "$app")"
    if [ -d "$app/android" ]; then
      check "Build Android (APK debug): $name" bash -c \
        "cd '$app' && flutter build apk --debug --dart-define-from-file=../../config/testing.json"
    fi
    if [ -d "$app/web" ]; then
      check "Build Web (release): $name" bash -c \
        "cd '$app' && flutter build web --release --dart-define-from-file=../../config/testing.json"
    fi
    if [ ! -d "$app/android" ] && [ ! -d "$app/web" ]; then
      record FAIL "Build: $name" "la app no tiene plataforma Android ni Web"
    fi
  done
}

check "Resolución del workspace (flutter pub get --enforce-lockfile)" flutter pub get --enforce-lockfile
check "Un solo pubspec.lock y miembros con resolution: workspace (T086, US7-1)" \
  "$KUOTA_ROOT/scripts/ci/check-single-lockfile.sh" "$FLUTTER_DIR"
check "Autoverificación del control de lockfile único (scripts/ci/tests/single-lockfile.test.sh)" \
  "$KUOTA_ROOT/scripts/ci/tests/single-lockfile.test.sh"
check "Análisis estático (melos run analyze, --fatal-infos)" melos analyze
check "Formato (melos run format)" melos format
check "Pruebas (melos run test: paquetes, apps y tool/)" melos test
check "Dependencias entre apps y paquetes (tool/check_deps.dart)" dart run tool/check_deps.dart
step "Anti-float Dart: sin double/num en financial_domain/lib"
anti_float_dart
check "Dependencias Dart: osv-scanner sobre pubspec.lock (cobertura completa; falla en alta/crítica)" dependency_scan
step "Build de Android y Web (iOS fuera de CI)"
builds
finish flutter
