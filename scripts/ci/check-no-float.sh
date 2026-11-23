#!/usr/bin/env bash
# Gate anti punto flotante (T065; R-10; SC-003; Constitución IV; ADR-0007).
#   ts   1. ESLint (configuración real) DEBE rechazar cada infracción del archivo defectuoso de referencia
#           (backend/test/fixtures/float-violation.ts.txt, T060) en las rutas protegidas: backend/scripts/check-no-float.ts.
#        2. El lint real del backend DEBE pasar.
#   dart 3. scripts/ci/check-no-float-dart.sh sobre flutter/packages/financial_domain/lib. Mientras el paquete no exista
#           (T082, US7) se registra PENDIENTE, nunca PASS.
#   all  ts + dart (por defecto).
# El job `backend` ejecuta `ts`; el job `flutter` (T050, pendiente de US7) ejecutará `dart`.
# Variable (solo pruebas): KUOTA_FLOAT_FIXTURE, archivo defectuoso alternativo.
# Salida: 0 sin fallos (revisa PENDIENTE); 1 si alguna verificación falló; 2 uso incorrecto.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
MODE="${1:-all}"
case "$MODE" in ts | dart | all) ;; *)
  echo "uso: $0 [ts|dart|all]" >&2
  exit 2
  ;;
esac
cd "$KUOTA_ROOT"

reference_rejected() {
  (cd "$KUOTA_ROOT/backend" && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-no-float.ts ${KUOTA_FLOAT_FIXTURE:+"$KUOTA_FLOAT_FIXTURE"})
}

dart_rule() {
  local status=0
  "$KUOTA_ROOT/scripts/ci/check-no-float-dart.sh" || status=$?
  case "$status" in
    0) record PASS "Anti-float Dart: sin double/num en financial_domain/lib" ;;
    3) record PENDIENTE "Anti-float Dart: sin double/num en financial_domain/lib" \
      "flutter/packages/financial_domain no existe (T082, US7)" ;;
    *) record FAIL "Anti-float Dart: sin double/num en financial_domain/lib" "salida $status" ;;
  esac
}

if [ "$MODE" != dart ]; then
  use_project_node
  check "Anti-float TS: ESLint rechaza cada infracción del archivo defectuoso (T060)" reference_rejected
  check "Anti-float TS: el lint real del backend pasa" pnpm --filter backend run lint
fi
if [ "$MODE" != ts ]; then
  step "Anti-float Dart: sin double/num en financial_domain/lib"
  dart_rule
fi
finish check-no-float
