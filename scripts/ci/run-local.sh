#!/usr/bin/env bash
# Ejecuta en local los MISMOS scripts que CI (T051; FR-037; R-17). Uso:
#   scripts/ci/run-local.sh general|backend|contracts|flutter     un job
#   scripts/ci/run-local.sh affected [base]                       los jobs afectados respecto a base (por defecto main)
# Salida: la del job (0 sin fallos, 1 con fallos). `flutter` sale con 3: su script (T050) no existe hasta US7, y un job
# no ejecutable nunca se presenta como aprobado.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
JOB="${1:-}"

run_job() {
  case "$1" in
    general | backend | contracts) "$KUOTA_ROOT/scripts/ci/$1.sh" ;;
    flutter)
      if [ -x "$KUOTA_ROOT/scripts/ci/flutter.sh" ] && [ -f "$KUOTA_ROOT/flutter/pubspec.yaml" ]; then
        "$KUOTA_ROOT/scripts/ci/flutter.sh"
      else
        printf '\nPENDIENTE flutter: no existen flutter/ ni scripts/ci/flutter.sh (T050 depende de US7: T080–T086).\n' >&2
        return 3
      fi
      ;;
    *) die "Job desconocido: $1" "Uso: scripts/ci/run-local.sh general|backend|contracts|flutter|affected [base]" ;;
  esac
}

case "$JOB" in
  affected)
    jobs=()
    while IFS= read -r job; do jobs+=("$job"); done < <("$KUOTA_ROOT/scripts/ci/affected.sh" "${2:-main}")
    step "Jobs afectados: ${jobs[*]}"
    failed=false
    pending=false
    for job in "${jobs[@]}"; do
      code=0
      run_job "$job" || code=$?
      case "$code" in
        0) ;;
        3) pending=true ;;
        *) failed=true ;;
      esac
    done
    $failed && exit 1
    $pending && exit 3
    exit 0
    ;;
  "") die "Uso: scripts/ci/run-local.sh general|backend|contracts|flutter|affected [base]" ;;
  *) run_job "$JOB" ;;
esac
