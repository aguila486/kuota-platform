#!/usr/bin/env bash
# Prueba de que los gates bloquean de verdad (T087; SC-003; US3-5..7). En un `git worktree` temporal (separado, sin
# rama; se elimina al terminar) y para cada uno de los 6 cambios defectuosos de referencia:
#   1. control positivo: el gate REAL pasa sobre el código limpio de HEAD (si no, no prueba nada → FAIL);
#   2. se aplica el cambio defectuoso;
#   3. el gate REAL debe fallar (salida ≠ 0) Y por el motivo esperado (firma en su salida). Fallar por otra causa
#      (herramienta ausente, error de entorno) cuenta como FAIL: nunca se da por probado.
#
# | Defecto                                   | Gate (comando real de CI)                                        |
# |-------------------------------------------|------------------------------------------------------------------|
# | secreto en un archivo                     | general.sh → "Secretos: cambios sin confirmar" (gitleaks)        |
# | float monetario (`amount: number`)        | check-no-float.sh ts → lint real del backend                     |
# | tabla con tenant_id sin FORCE RLS         | db-gate.sh → db:check-rls con la credencial de runtime           |
# | contrato incompatible                     | contracts.sh → oasdiff breaking (base: HEAD del worktree, ver ↓) |
# | import de framework en domain/            | lint del backend → dependency-cruiser `domain-sin-framework`     |
# | cobertura bajo umbral (money ≥ 90 %)      | vitest --coverage con los umbrales de vitest.config.ts (ver ↓)   |
# | cobertura Dart bajo umbral (C1)           | check-dart-coverage.sh: financial_domain ≥ 90 % líneas y ramas   |
# | archivo Dart de lib/ sin pruebas (C1)     | check-dart-coverage.sh: archivo con código que ninguna prueba carga |
#
# Diferencias explícitas con CI (no cambian los criterios ni los umbrales):
#   - Contrato: en CI la base es `main`, que aún no contiene el contrato (OMITIDO, T049). Aquí se usa la variable
#     soportada KUOTA_CI_BREAKING_BASE=HEAD para que el mismo gate compare el contrato defectuoso con el de HEAD.
#   - Cobertura: se ejecutan las pruebas de Money (test/unit/money, test/property) con `--coverage.include` limitado a
#     src/common/money/**, sin Testcontainers (memoria limitada de Docker Desktop). Los umbrales son los de
#     vitest.config.ts, sin cambios; el control positivo demuestra que ese alcance pasa con el código limpio.
#   - Secretos: el token de prueba se genera en tiempo de ejecución (nunca se versiona) y gitleaks lo informa redactado.
#   - El cambio de RLS es una migración que solo existe en el worktree temporal y se aplica a un PostgreSQL efímero
#     (db-gate.sh: tmpfs, --rm); nunca a una base persistente.
#
# Requiere Docker, Node/pnpm (store local) y Flutter (lo usa contracts.sh). Sin alguno → salida 2, nunca PASS.
# Uso: scripts/ci/prove-gates.sh [secreto|float|rls|contrato|dominio|cobertura ...]   (por defecto, los 6)
# Salida: 0 si todos los gates seleccionados quedan probados (pasan limpios y fallan con su defecto); 1 si alguno no; 2 entorno.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || { echo "prove-gates: se requiere Docker" >&2; exit 2; }
use_project_node
use_project_flutter
command -v pnpm >/dev/null 2>&1 || { echo "prove-gates: se requiere pnpm" >&2; exit 2; }

ALL=(secreto float rls contrato dominio cobertura cobertura-dart dart-sin-pruebas)
SELECTED=("$@")
[ ${#SELECTED[@]} -gt 0 ] || SELECTED=("${ALL[@]}")
for name in "${SELECTED[@]}"; do
  [[ " ${ALL[*]} " == *" $name "* ]] || { echo "prove-gates: defecto desconocido '$name' (${ALL[*]})" >&2; exit 2; }
done

BRANCH="$(git -C "$KUOTA_ROOT" rev-parse --abbrev-ref HEAD)"
TMP="$(mktemp -d)"
WT="$TMP/wt"
LOGS="$TMP/logs"
mkdir -p "$LOGS"
cleanup() {
  git -C "$KUOTA_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  git -C "$KUOTA_ROOT" worktree prune >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

step "Worktree temporal desde HEAD ($(git -C "$KUOTA_ROOT" rev-parse --short HEAD), sin rama)"
git -C "$KUOTA_ROOT" worktree add --detach --quiet "$WT" HEAD || { echo "prove-gates: no se pudo crear el worktree" >&2; exit 2; }
(cd "$WT" && pnpm install --frozen-lockfile --offline --silent >"$LOGS/install.log" 2>&1) ||
  { echo "prove-gates: pnpm install --offline falló en el worktree (ver dependencias en el store local)" >&2; exit 2; }
(cd "$WT/backend" && pnpm run -s prisma:generate >"$LOGS/prisma.log" 2>&1) ||
  { echo "prove-gates: prisma generate falló en el worktree" >&2; exit 2; }
(cd "$WT/flutter" && flutter pub get --offline --enforce-lockfile >"$LOGS/pub.log" 2>&1) ||
  { echo "prove-gates: flutter pub get --offline falló en el worktree" >&2; exit 2; }

reset_worktree() { git -C "$WT" checkout --quiet -- . && git -C "$WT" clean -fdq; }

# --- Gates (se ejecutan dentro del worktree) -------------------------------------------------------------------------
gate_secreto() { (cd "$WT" && KUOTA_CI_BRANCH="$BRANCH" bash scripts/ci/general.sh); }
gate_float() { (cd "$WT" && bash scripts/ci/check-no-float.sh ts); }
gate_rls() { (cd "$WT" && bash scripts/ci/db-gate.sh); }
gate_contrato() { (cd "$WT" && KUOTA_CI_BREAKING_BASE=HEAD bash scripts/ci/contracts.sh); }
gate_dominio() { (cd "$WT" && pnpm --filter backend run lint); }
gate_cobertura_dart() { (cd "$WT" && bash scripts/ci/check-dart-coverage.sh "$WT/flutter"); }
gate_dart_sin_pruebas() { gate_cobertura_dart; }
gate_cobertura() {
  (cd "$WT/backend" && pnpm exec vitest run test/unit/money test/property --coverage \
    --coverage.include='src/common/money/**' --coverage.reporter=text)
}

# Firma que demuestra que el gate falló por el defecto y no por otra causa.
signature_secreto='^[[:space:]]+FAIL[[:space:]]+Secretos: cambios sin confirmar'
signature_float='^[[:space:]]+FAIL[[:space:]]+Anti-float TS: el lint real del backend pasa'
signature_rls='prove_gate_items: tiene tenant_id y RLS no está forzado'  # violación de db:check-rls, no un error de la migración
signature_contrato='^[[:space:]]+FAIL[[:space:]]+Compatibilidad: oasdiff breaking contra HEAD'
signature_dominio='domain-sin-framework'
signature_cobertura_dart='✗ financial_domain: (líneas|ramas) por debajo de 90'
signature_dart_sin_pruebas='✗ shared_core: lib/src/prove_gate_untested.dart tiene código y ninguna prueba lo carga'
signature_cobertura='ERROR: Coverage for .* does not meet "src/common/money/\*\*" threshold'

# --- Cambios defectuosos de referencia -------------------------------------------------------------------------------
defect_secreto() {
  local token
  token="ghp_$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"
  printf '// prove-gates: secreto de prueba generado en tiempo de ejecución\nexport const githubToken = "%s";\n' "$token" \
    >"$WT/backend/src/prove-gate-secret.ts"
}
defect_float() {
  printf 'export interface ProveGatePayment {\n  amount: number;\n}\n' >"$WT/backend/src/common/money/prove-gate.ts"
}
defect_rls() {
  local dir="$WT/backend/prisma/migrations/0003_prove_gate_no_force"
  mkdir -p "$dir"
  cat >"$dir/migration.sql" <<'SQL'
-- prove-gates (T087): tabla con tenant_id y RLS habilitado pero SIN FORCE. db:check-rls debe rechazarla.
BEGIN;
CREATE TABLE kuota.prove_gate_items (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
ALTER TABLE kuota.prove_gate_items ENABLE ROW LEVEL SECURITY;
COMMIT;
SQL
}
defect_contrato() {
  # Quita `api_version` de las propiedades requeridas de la RESPUESTA de compatibilidad (incompatible para clientes).
  LC_ALL=C perl -0pi -e 's/^required:\n- api_version\n/required:\n/m' "$WT/contracts/openapi/schemas/CompatibilityInfo.yaml"
  ! grep -q -- '^- api_version' "$WT/contracts/openapi/schemas/CompatibilityInfo.yaml"
}
defect_dominio() {
  printf "import { Injectable } from '@nestjs/common';\n\nexport const proveGateDecorator = Injectable;\n" \
    >"$WT/backend/src/modules/dev-probe/domain/prove-gate.ts"
}
defect_cobertura() {
  cat >"$WT/backend/src/common/money/prove-gate-uncovered.ts" <<'TS'
// prove-gates (T087): código de Money sin pruebas, para bajar la cobertura de src/common/money/** del 90 %.
export function proveGateA(value: bigint): bigint {
  if (value > 10n) return value - 1n;
  if (value < -10n) return value + 1n;
  return value * 2n;
}
export function proveGateB(value: bigint): bigint {
  let total = 0n;
  for (let i = 0n; i < value; i += 1n) total += i;
  return total;
}
export function proveGateC(values: readonly bigint[]): bigint {
  return values.reduce((sum, v) => (v > 0n ? sum + v : sum - v), 0n);
}
export function proveGateD(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('b');
  return a % b === 0n ? a / b : a / b + 1n;
}
export function proveGateE(value: bigint): string {
  switch (value % 3n) {
    case 0n:
      return 'cero';
    case 1n:
      return 'uno';
    default:
      return 'dos';
  }
}
TS
}

defect_cobertura_dart() {
  # Código de Money sin pruebas en un archivo que las pruebas SÍ cargan: baja la cobertura de financial_domain.
  cat >>"$WT/flutter/packages/financial_domain/lib/src/money/money.dart" <<'DART'

/// prove-gates (C1): lógica sin pruebas para bajar la cobertura de financial_domain del 90 %.
BigInt proveGateUncovered(BigInt value) {
  if (value > BigInt.from(10)) return value - BigInt.one;
  if (value < BigInt.from(-10)) return value + BigInt.one;
  var total = BigInt.zero;
  for (var i = BigInt.zero; i < value; i += BigInt.one) {
    total += i.isEven ? i : -i;
  }
  switch (total.sign) {
    case 0:
      return BigInt.zero;
    case 1:
      return total * BigInt.two;
    default:
      return total ~/ BigInt.two;
  }
}
DART
}
defect_dart_sin_pruebas() {
  printf '/// prove-gates (C1): archivo con código que ninguna prueba importa.
String proveGateUntested(String value) => value.trim();
' \
    >"$WT/flutter/packages/shared_core/lib/src/prove_gate_untested.dart"
}

prove() { # nombre
  local name="$1" positive negative status
  step "Gate: $name"
  reset_worktree
  local fn="${name//-/_}"
  "gate_$fn" >"$LOGS/$name-limpio.log" 2>&1
  positive=$?
  if [ "$positive" -ne 0 ]; then
    record FAIL "Gate $name" "el control positivo falló (salida $positive) sobre el código limpio: el gate no prueba nada"
    tail -15 "$LOGS/$name-limpio.log" | sed 's/^/      /'
    return
  fi
  if ! "defect_$fn"; then
    record FAIL "Gate $name" "no se pudo aplicar el cambio defectuoso de referencia"
    return
  fi
  "gate_$fn" >"$LOGS/$name-defecto.log" 2>&1
  negative=$?
  status="limpio: 0; con defecto: $negative"
  local signature_var="signature_$fn"
  if [ "$negative" -eq 0 ]; then
    record FAIL "Gate $name" "$status: el gate NO bloqueó el cambio defectuoso"
  elif ! grep -qE -- "${!signature_var}" "$LOGS/$name-defecto.log"; then
    record FAIL "Gate $name" "$status, pero sin la firma esperada (falló por otra causa)"
    tail -15 "$LOGS/$name-defecto.log" | sed 's/^/      /'
  else
    record PASS "Gate $name" "$status, por el motivo esperado"
  fi
  reset_worktree
}

for name in "${SELECTED[@]}"; do prove "$name"; done
finish prove-gates
