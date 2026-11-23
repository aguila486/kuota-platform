# Funciones y herramientas comunes de scripts/ci (G12/US3; research R-17). Se importa con `source`; no se ejecuta sola.
#
# Toda la lógica de CI vive en scripts/ci/*.sh: el workflow solo los invoca y `scripts/ci/run-local.sh` reproduce cada
# job en local (FR-037). Las herramientas sin dependencia en el lockfile corren en contenedores FIJADOS POR DIGEST
# (verificados el 2026-11-23 con `docker buildx imagetools inspect`), sin instalaciones globales. Las que no necesitan
# red se ejecutan con `--network none`.
# shellcheck disable=SC2034 # variables usadas por los scripts que importan este archivo
KUOTA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
ACTIONLINT_IMAGE="rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"
EDITORCONFIG_IMAGE="ghcr.io/editorconfig-checker/editorconfig-checker:4.0.2@sha256:2ba6232bfa0058f72f5f7d7816711590aa764afab1542af30b3ecb4553587918"
OSV_SCANNER_IMAGE="ghcr.io/google/osv-scanner:v2.7.1@sha256:a70ffffc2bfd33482953e5d6b64c6fcdb30239717a07b0f0d3ab2859ce3e4cde"

step() { printf '\n==> %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }
die() { printf '\n\342\234\227 %s\n' "$1" >&2; shift; for line in "$@"; do printf '  %s\n' "$line" >&2; done; exit 1; }

# Registro de resultados por verificación: PASS, FAIL, OMITIDO o PENDIENTE. Un OMITIDO o PENDIENTE nunca cuenta como
# PASS: se imprime aparte y, en GitHub Actions, como advertencia en el resumen del job.
CI_RESULTS=()
CI_FAILED=0
record() { # estado nombre [detalle]
  local status="$1" name="$2" detail="${3:-}"
  CI_RESULTS+=("$status|$name|$detail")
  [ "$status" = "FAIL" ] && CI_FAILED=$((CI_FAILED + 1))
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    case "$status" in
      FAIL) printf '::error title=%s::%s\n' "$name" "${detail:-falló}" ;;
      OMITIDO | PENDIENTE) printf '::warning title=%s (%s)::%s\n' "$name" "$status" "$detail" ;;
    esac
  fi
  return 0
}

# check "nombre" comando… → ejecuta y registra PASS/FAIL con el código de salida real (sin ocultarlo).
check() {
  local name="$1"
  shift
  step "$name"
  local start=$SECONDS
  if "$@"; then
    record PASS "$name" "$((SECONDS - start)) s"
  else
    record FAIL "$name" "salida $? tras $((SECONDS - start)) s"
  fi
}

# Resumen final; sale con 1 si alguna verificación falló.
finish() { # nombre-del-job
  local job="$1" line status name detail
  printf '\n==== Resumen del job %s ====\n' "$job"
  for line in "${CI_RESULTS[@]}"; do
    IFS='|' read -r status name detail <<<"$line"
    printf '  %-9s %s%s\n' "$status" "$name" "${detail:+ ($detail)}"
  done
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '### Job %s\n\n| Estado | Verificación | Detalle |\n|---|---|---|\n' "$job"
      for line in "${CI_RESULTS[@]}"; do
        IFS='|' read -r status name detail <<<"$line"
        printf '| %s | %s | %s |\n' "$status" "$name" "$detail"
      done
    } >>"$GITHUB_STEP_SUMMARY"
  fi
  if [ "$CI_FAILED" -gt 0 ]; then
    printf '\n\342\234\227 %s: %d verificación(es) fallaron\n' "$job" "$CI_FAILED" >&2
    exit 1
  fi
  printf '\n\342\234\223 %s: sin fallos (revisa OMITIDO/PENDIENTE: no son aprobaciones)\n' "$job"
}

require_docker() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 ||
    die "Se requiere Docker (herramientas fijadas por digest y PostgreSQL efímero)."
}

# Node y pnpm del proyecto (nvm en local si existe; en CI, actions/setup-node + corepack).
use_project_node() {
  if [ -z "${GITHUB_ACTIONS:-}" ] && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null
    pushd "$KUOTA_ROOT" >/dev/null && nvm use >/dev/null && popd >/dev/null
  fi
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
}

# Flutter/Dart EXACTOS de flutter/.fvmrc (D-ENV-01) al principio del PATH: `flutter`, `dart` y `dart run melos` usan
# ese SDK y nunca el global. Origen del SDK:
#   - KUOTA_FLUTTER_SDK (CI: lo prepara scripts/ci/setup-flutter.sh con el archivo oficial verificado por sha256);
#   - si no, FVM (local): el SDK de la caché de FVM para esa versión (`fvm install` si falta).
# Se verifica que `flutter --version` coincide con .fvmrc. Sin SDK válido, FALLA: los gates de Flutter nunca se omiten.
use_project_flutter() {
  local want sdk actual
  want="$(sed -nE 's/.*"flutter"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$KUOTA_ROOT/flutter/.fvmrc")"
  [ -n "$want" ] || die "flutter/.fvmrc no declara la versión de Flutter"
  sdk="${KUOTA_FLUTTER_SDK:-}"
  if [ -z "$sdk" ]; then
    command -v fvm >/dev/null 2>&1 ||
      die "Se requiere Flutter $want: instala FVM (local) o define KUOTA_FLUTTER_SDK (CI: scripts/ci/setup-flutter.sh)."
    sdk="${FVM_CACHE_PATH:-$HOME/fvm}/versions/$want"
    [ -x "$sdk/bin/flutter" ] || (cd "$KUOTA_ROOT/flutter" && fvm install "$want" >/dev/null) ||
      die "fvm install $want falló"
  fi
  [ -x "$sdk/bin/flutter" ] || die "No hay SDK de Flutter en $sdk"
  actual="$("$sdk/bin/flutter" --version --machine 2>/dev/null | sed -nE 's/.*"frameworkVersion"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  [ "$actual" = "$want" ] || die "Flutter en $sdk es '${actual:-desconocido}', se requiere $want (flutter/.fvmrc)"
  export PATH="$sdk/bin:$PATH" FLUTTER_ROOT="$sdk"
  export CI_FLUTTER_VERSION="$want"
}
