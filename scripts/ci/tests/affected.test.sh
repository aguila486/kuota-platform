#!/usr/bin/env bash
# T045 (US3-1..3): detector de componentes afectados de CI (scripts/ci/affected.sh), con listas de archivos conocidas.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FAILED=0

check() { # descripción esperado archivos…
  local name="$1" expected="$2" got
  shift 2
  got="$(KUOTA_CHANGED_FILES="$(printf '%s\n' "$@")" "$ROOT/scripts/ci/affected.sh" | paste -sd' ' -)"
  if [ "$got" = "$expected" ]; then echo "  ✓ $name → $got"; else echo "  ✗ $name: esperado '$expected', obtenido '$got'"; FAILED=$((FAILED + 1)); fi
}

echo "Detector de componentes afectados (CI)"
# Criterios literales de T045.
check "solo docs/ → solo general" "general" docs/architecture/vision.md docs/process/git-workflow.md
check "backend/** → general + backend" "general backend" backend/src/main.ts
check "contracts/** → general + contracts + backend + flutter" "general backend contracts flutter" \
  contracts/openapi/schemas/Money.yaml
# Selección segura (G12): ante cambios que afectan a seguridad, contrato o al propio pipeline, se ejecuta más.
check "migración Prisma → backend (PostgreSQL)" "general backend" backend/prisma/migrations/0002_idempotency_maintenance/migration.sql
check "roles de PostgreSQL → backend" "general backend" infra/docker/postgres/init/02-maintenance-roles.sql
check "herramientas del contrato → contracts" "general contracts" scripts/contracts/breaking.sh
check "package.json raíz → backend + contracts" "general backend contracts" package.json
check "lockfile → backend" "general backend" pnpm-lock.yaml
check "workflow → suite completa" "general backend contracts flutter" .github/workflows/ci.yml
check "scripts de CI → suite completa" "general backend contracts flutter" scripts/ci/backend.sh
check "filtros → suite completa" "general backend contracts flutter" scripts/dev/path-filters.sh
check "Constitución → suite completa" "general backend contracts flutter" .specify/memory/constitution.md
check "flutter/** → general + flutter" "general flutter" flutter/apps/admin_web/lib/main.dart
check "prefijo no engañoso" "general" backend-notes.md flutterx/a.txt contractsx/x.yaml
check "sin cambios → solo general" "general"

[ "$FAILED" -eq 0 ] && echo "Resultado: detección correcta en todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
