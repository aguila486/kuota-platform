#!/usr/bin/env bash
# Job agregador `CI: resultado` (G12; T052, T055). Es el ÚNICO check requerido en la protección de main: GitHub cuenta
# un job saltado como satisfecho, así que este job decide explícitamente. Falla si:
#   - un job falló o se canceló;
#   - un componente afectado no ejecutó su job (saltado);
# y advierte, sin aprobarlo como ejecutado, si flutter estaba afectado pero flutter/ aún no existe (US7).
# Entrada (variables de entorno del workflow): NEEDS_JSON = toJSON(needs).
set -euo pipefail
command -v jq >/dev/null || { echo "ci-result: se requiere jq" >&2; exit 2; }
status=0
result() { jq -r --arg j "$1" '.[$j].result // "missing"' <<<"$NEEDS_JSON"; }
output() { jq -r --arg j "$1" --arg o "$2" '.[$j].outputs[$o] // ""' <<<"$NEEDS_JSON"; }

[ "$(result changes)" = "success" ] || { echo "::error::el job changes no terminó bien: $(result changes)"; exit 1; }
[ "$(result general)" = "success" ] || { echo "::error::general: $(result general)"; status=1; }
for component in backend contracts flutter; do
  affected="$(output changes "$component")"
  res="$(result "$component")"
  if [ "$affected" != "true" ]; then
    echo "$component: no afectado ($res)"
    continue
  fi
  if [ "$component" = "flutter" ] && [ "$(output changes flutter_present)" != "true" ]; then
    echo "::warning title=flutter (PENDIENTE)::afectado, pero flutter/ no existe todavía (US7, T080; T050): no se ejecutó y NO cuenta como aprobado"
    continue
  fi
  if [ "$res" = "success" ]; then
    echo "$component: success"
  else
    echo "::error::$component estaba afectado y terminó en: $res"
    status=1
  fi
done
exit "$status"
