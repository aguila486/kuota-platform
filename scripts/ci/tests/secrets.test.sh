#!/usr/bin/env bash
# T046 (US3-4): un archivo con un secreto ficticio de patrón conocido hace fallar scripts/ci/general.sh.
# Se usa un repositorio Git temporal (nunca el real). El token ficticio se construye en tiempo de ejecución con el
# formato de un token personal de GitHub, así que este archivo no contiene ningún literal que gitleaks detecte.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FAILED=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fake_token() { local prefix="gh"; prefix+="p_"; printf '%s%s' "$prefix" "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"; }
new_repo() { # dir
  mkdir -p "$1" && git -C "$1" init -q -b chore/secrets-test &&
    git -C "$1" -c user.name=ci -c user.email=ci@example.invalid commit -q --allow-empty -m init
}
run_general() { # repo → salida del resumen
  KUOTA_CI_REPO_DIR="$1" KUOTA_CI_BRANCH=chore/secrets-test "$ROOT/scripts/ci/general.sh" 2>&1
}
expect_line() { # descripción salida patrón
  if grep -qE "$3" <<<"$2"; then echo "  ✓ $1"; else echo "  ✗ $1 (no se encontró: $3)"; FAILED=$((FAILED + 1)); fi
}

echo "Gate de secretos (gitleaks en scripts/ci/general.sh)"

new_repo "$WORK/limpio"
printf 'nada secreto aquí\n' >"$WORK/limpio/README.md"
git -C "$WORK/limpio" add README.md && git -C "$WORK/limpio" -c user.name=ci -c user.email=ci@example.invalid commit -qm docs
out="$(run_general "$WORK/limpio")"
expect_line "control: repositorio limpio → historial PASS" "$out" '^  PASS +Secretos: historial'
expect_line "control: sin cambios → sin confirmar PASS" "$out" '^  PASS +Secretos: cambios sin confirmar'

new_repo "$WORK/historial"
printf 'GITHUB_TOKEN=%s\n' "$(fake_token)" >"$WORK/historial/config.env"
git -C "$WORK/historial" add config.env && git -C "$WORK/historial" -c user.name=ci -c user.email=ci@example.invalid commit -qm cfg
out="$(run_general "$WORK/historial")"
status=$?
expect_line "secreto confirmado → historial FAIL" "$out" '^  FAIL +Secretos: historial'
[ "$status" -ne 0 ] && echo "  ✓ general.sh sale con $status" || { echo "  ✗ general.sh debía fallar"; FAILED=$((FAILED + 1)); }
grep -q 'ghp_[A-Za-z0-9]\{36\}' <<<"$out" && { echo "  ✗ el secreto aparece sin redactar"; FAILED=$((FAILED + 1)); } ||
  echo "  ✓ el hallazgo se imprime redactado"

new_repo "$WORK/sin-confirmar"
printf 'token: %s\n' "$(fake_token)" >"$WORK/sin-confirmar/nuevo.yaml"
out="$(run_general "$WORK/sin-confirmar")"
expect_line "secreto sin confirmar (archivo nuevo) → FAIL" "$out" '^  FAIL +Secretos: cambios sin confirmar'
expect_line "…y el historial sigue limpio" "$out" '^  PASS +Secretos: historial'

[ "$FAILED" -eq 0 ] && echo "Resultado: el gate de secretos detecta todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
