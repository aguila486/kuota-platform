#!/usr/bin/env bash
# Prueba del gate de dependencias (scripts/ci/osv-gate.mjs; T048, SEC-2026-001): alta/crítica o sin severidad bloquean,
# moderadas informan, y un informe inválido o incoherente con la salida del scanner nunca se interpreta como aprobado.
# Los informes son sintéticos con la estructura real de osv-scanner 2.x (results → packages → vulnerabilities/groups).
# No requiere red ni Docker.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0

# pkg nombre versión id severidad → paquete con una vulnerabilidad agrupada.
pkg() { printf '{"package":{"name":"%s","version":"%s","ecosystem":"npm"},"vulnerabilities":[{"id":"%s","aliases":["CVE-0000-%s"]}],"groups":[{"ids":["%s"],"aliases":["%s","CVE-0000-%s"],"max_severity":"%s"}]}' "$1" "$2" "$3" "$2" "$3" "$3" "$2" "$4"; }
report() { printf '{"results":[{"source":{"path":"/src/pnpm-lock.yaml","type":"lockfile"},"packages":[%s]}]}' "$1"; }

write() { printf '%s' "$2" >"$TMP/$1.json"; }
write limpio '{"results":[],"experimental_config":{"licenses":{"summary":false,"allowlist":null}}}'
write alta "$(report "$(pkg effect 3.20.0 GHSA-7589-6fvf-x4pw 8.7)")"
write critica "$(report "$(pkg lodash 4.17.20 GHSA-cccc-cccc-cccc 9.8)")"
write moderada "$(report "$(pkg glob 10.5.0 GHSA-3g3m-2fjr-6pw4 6.3)")"
write otra-alta-con-moderada "$(report "$(pkg glob 10.5.0 GHSA-3g3m-2fjr-6pw4 6.3),$(pkg lodash 4.17.20 GHSA-35jh-r3h4-6jhm 7.2)")"
write umbral-exacto "$(report "$(pkg x 1.0.0 GHSA-tttt-tttt-tttt 7.0)")"
write sin-severidad "$(report "$(pkg x 1.0.0 GHSA-ssss-ssss-ssss '')")"
write sin-grupos '{"results":[{"packages":[{"package":{"name":"effect","version":"3.20.0"},"vulnerabilities":[{"id":"GHSA-7589-6fvf-x4pw"}]}]}]}'
write vuln-fuera-de-grupo '{"results":[{"packages":[{"package":{"name":"effect","version":"3.20.0"},"vulnerabilities":[{"id":"GHSA-7589-6fvf-x4pw"},{"id":"GHSA-oooo-oooo-oooo"}],"groups":[{"ids":["GHSA-7589-6fvf-x4pw"],"max_severity":"5.0"}]}]}]}'
write vacio ''
write truncado '{"results": ['
write objeto-vacio '{}'
write results-no-lista '{"results":"x"}'
write lista '[]'
write paquete-sin-nombre '{"results":[{"packages":[{"vulnerabilities":[],"groups":[]}]}]}'
write packages-ausente '{"results":[{"source":{}}]}'

echo "Gate de dependencias (osv-gate.mjs)"
while IFS='|' read -r name file scanner expect; do
  if [ -n "$scanner" ]; then
    node "$ROOT/scripts/ci/osv-gate.mjs" "$TMP/$file.json" "$scanner" >/dev/null 2>&1
  else
    node "$ROOT/scripts/ci/osv-gate.mjs" "$TMP/$file.json" >/dev/null 2>&1
  fi
  got=$?
  if [ "$got" = "$expect" ]; then echo "  ✓ $name → $got"; else echo "  ✗ $name: esperado $expect, obtenido $got"; FAILED=$((FAILED + 1)); fi
done <<'EOF'
sin vulnerabilidades (salida 0)|limpio|0|0
alta (effect 8.7) bloquea|alta|1|1
crítica bloquea|critica|1|1
moderada informa sin bloquear|moderada|1|0
otra alta junto a una moderada bloquea|otra-alta-con-moderada|1|1
severidad 7.0 exacta bloquea|umbral-exacto|1|1
sin severidad clasificable bloquea|sin-severidad|1|1
vulnerabilidad sin grupos bloquea|sin-grupos|1|1
vulnerabilidad fuera de todo grupo bloquea|vuln-fuera-de-grupo|1|1
archivo vacío es inválido|vacio|1|2
JSON truncado es inválido|truncado|1|2
objeto sin results es inválido|objeto-vacio|0|2
results que no es lista es inválido|results-no-lista|0|2
lista en lugar de objeto es inválida|lista|0|2
paquete sin nombre es inválido|paquete-sin-nombre|1|2
resultado sin packages es inválido|packages-ausente|1|2
salida 1 sin hallazgos es incoherente|limpio|1|2
salida 0 con hallazgos es incoherente|moderada|0|2
sin código del scanner: alta bloquea|alta||1
EOF
[ "$FAILED" -eq 0 ] && echo "Resultado: gate correcto en todos los casos." || echo "Resultado: $FAILED caso(s) fallaron."
exit "$FAILED"
