#!/usr/bin/env bash
# Job `general` de CI (T047; FR-034, FR-035; R-17). Siempre se ejecuta, en todo PR y push.
#   1. Nombre de rama: feature/NNN-<slug> con specs/NNN-* existente, o fix/, hotfix/, chore/, docs/ + slug; main.
#   2. Secretos (gitleaks 8.30, imagen fijada por digest, sin red): historial completo y cambios sin confirmar
#      (modificados y sin seguimiento). Los hallazgos se imprimen redactados.
#   3. editorconfig-checker sobre los archivos versionados (y los nuevos sin seguimiento).
#   4. actionlint sobre .github/workflows (incluye shellcheck de los bloques run).
#
# Variables: KUOTA_CI_REPO_DIR (repositorio a revisar; por defecto la raíz; solo para pruebas), KUOTA_CI_BRANCH (rama;
# por defecto GITHUB_HEAD_REF, GITHUB_REF_NAME o la rama actual).
# Salida: 0 sin fallos; 1 si alguna verificación falló.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
REPO="$(cd "${KUOTA_CI_REPO_DIR:-$KUOTA_ROOT}" && pwd)"
cd "$REPO"
require_docker

# docker run con el repositorio montado en solo lectura y git dispuesto a leerlo (propietario distinto en el contenedor).
in_tool() { # imagen args…
  local image="$1"
  shift
  docker run --rm --network none -v "$REPO:/repo:ro" -w /repo \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
    "$image" "$@"
}

branch_name() {
  local branch="${KUOTA_CI_BRANCH:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}}"
  [ -n "$branch" ] || branch="$(git rev-parse --abbrev-ref HEAD)"
  case "$branch" in
    main)
      note "main (push tras merge)"
      return 0
      ;;
    feature/[0-9][0-9][0-9]-*)
      local number="${branch#feature/}"
      number="${number%%-*}"
      [[ "$branch" =~ ^feature/[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*$ ]] ||
        { echo "    ✗ '$branch': el slug debe ser kebab-case [a-z0-9-]"; return 1; }
      compgen -G "specs/${number}-*/spec.md" >/dev/null ||
        { echo "    ✗ '$branch': no existe specs/${number}-*/spec.md (Spec-Kit: feature ↔ especificación)"; return 1; }
      note "$branch ↔ $(compgen -G "specs/${number}-*" | head -1)"
      ;;
    fix/* | hotfix/* | chore/* | docs/*)
      [[ "$branch" =~ ^(fix|hotfix|chore|docs)/[a-z0-9]+(-[a-z0-9]+)*$ ]] ||
        { echo "    ✗ '$branch': el slug debe ser kebab-case [a-z0-9-]"; return 1; }
      note "$branch"
      ;;
    *)
      echo "    ✗ '$branch' no sigue docs/process/git-workflow.md (feature/NNN-slug, fix/, hotfix/, chore/, docs/)"
      return 1
      ;;
  esac
}

secrets_history() {
  in_tool "$GITLEAKS_IMAGE" git --no-banner --redact --exit-code 1 /repo
}

secrets_uncommitted() {
  local files tmp status=0
  files="$( {
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard
  } | sort -u)"
  if [ -z "$files" ]; then
    note "sin cambios sin confirmar"
    return 0
  fi
  tmp="$(mktemp -d)"
  while IFS= read -r file; do
    [ -f "$file" ] || continue
    mkdir -p "$tmp/$(dirname "$file")" && cp "$file" "$tmp/$file"
  done <<<"$files"
  docker run --rm --network none -v "$tmp:/scan:ro" "$GITLEAKS_IMAGE" dir --no-banner --redact --exit-code 1 /scan ||
    status=$?
  rm -rf "$tmp"
  return "$status"
}

editorconfig() {
  local files=()
  while IFS= read -r file; do
    [ -f "$file" ] && files+=("$file")
  done < <({
    git ls-files
    git ls-files --others --exclude-standard
  } | sort -u)
  [ "${#files[@]}" -gt 0 ] || { note "sin archivos"; return 0; }
  in_tool "$EDITORCONFIG_IMAGE" editorconfig-checker "${files[@]}"
}

workflows() {
  if ! compgen -G ".github/workflows/*.y*ml" >/dev/null; then
    echo "    ✗ no hay workflows en .github/workflows"
    return 1
  fi
  in_tool "$ACTIONLINT_IMAGE" -color
}

check "Nombre de rama" branch_name
check "Secretos: historial (gitleaks)" secrets_history
check "Secretos: cambios sin confirmar (gitleaks)" secrets_uncommitted
check "EditorConfig (editorconfig-checker)" editorconfig
check "Workflows (actionlint)" workflows
finish general
