#!/usr/bin/env bash
# Regla anti punto flotante de Dart (T065; R-10; Constitución IV; ADR-0007): falla si aparece `double` o `num` en el
# código de `flutter/packages/financial_domain/lib/**` fuera de comentarios y literales de texto. El dinero en Dart es
# `BigInt` en unidades mínimas (T063). Se prohíben como palabras completas: tipos (`double amount`), conversiones
# (`double.parse`, `num.tryParse`) y genéricos (`List<num>`); `toDouble()` se detecta aparte. Identificadores que solo
# las contienen (`doubled`, `numParts`) no cuentan.
#
# Limitaciones conocidas (documentadas en research R-10): análisis léxico, no semántico. No inspecciona expresiones
# dentro de interpolaciones `${…}` de un literal ni comentarios de bloque anidados. El control definitivo de Dart es
# `analysis_options` estricto más esta regla y la revisión (alternativa evaluada: `custom_lint`, reevaluar en 004).
#
# Uso: scripts/ci/check-no-float-dart.sh [directorio]   (por defecto, flutter/packages/financial_domain/lib)
# Salida: 0 sin infracciones; 1 con infracciones; 3 PENDIENTE si el directorio no existe o no tiene archivos .dart.
# Un 3 nunca es una aprobación.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-$ROOT/flutter/packages/financial_domain/lib}"

if [ ! -d "$DIR" ]; then
  echo "  PENDIENTE: no existe ${DIR#"$ROOT"/} (financial_domain se crea en T082, US7); no hay código Dart que verificar"
  exit 3
fi

# Programa perl (archivo completo en memoria): sustituye comentarios y literales por espacios conservando los saltos de
# línea, de modo que los números de línea no cambian, e imprime `línea:texto` de cada línea con double/num/toDouble.
# La alternancia se evalúa de izquierda a derecha, así que `//` dentro de un texto o comillas dentro de un comentario
# no confunden el análisis. Las cadenas raw (`r'…'`, `r"…"`, `r'''…'''`) no tienen escapes: `r'a\'` es un literal
# completo.
# (`read -d ''` y no `$(cat <<…)`: bash 3.2 no admite comillas desequilibradas en un heredoc dentro de `$(…)`.)
read -r -d '' STRIP_AND_FIND <<'PERL' || true
my $raw = qr{(?<![\w\$])r(?:'''.*?'''|""".*?"""|'[^'\n]*'|"[^"\n]*")}s;
my $str = qr{'''(?:\\.|.)*?'''|"""(?:\\.|.)*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"}s;
s{(/\*.*?\*/|//[^\n]*|$raw|$str)}{ (my $m = $1) =~ s/[^\n]/ /g; $m }gse;
my $n = 0;
for my $line (split /\n/, $_, -1) {
  $n++;
  print "$n:$line\n" if $line =~ /(?<![\w\$])(double|num)(?![\w\$])|\.toDouble\s*\(/;
}
PERL

found=0
checked=0
while IFS= read -r -d '' file; do
  checked=$((checked + 1))
  hits="$(LC_ALL=C perl -0777 -ne "$STRIP_AND_FIND" "$file")" || {
    echo "  ✗ ${file#"$ROOT"/}: no se pudo analizar"
    found=$((found + 1))
    continue
  }
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do
      echo "  ✗ ${file#"$ROOT"/}:${hit%%:*}: punto flotante prohibido en financial_domain (usa BigInt/Money; R-10)"
      found=$((found + 1))
    done <<<"$hits"
  fi
done < <(find "$DIR" -type f -name '*.dart' -print0)

if [ "$found" -gt 0 ]; then
  echo "check-no-float-dart: $found infracción(es) en $checked archivo(s)"
  exit 1
fi
if [ "$checked" -eq 0 ]; then
  echo "  PENDIENTE: ${DIR#"$ROOT"/} no contiene archivos .dart; no hay código que verificar (no es una aprobación)"
  exit 3
fi
echo "check-no-float-dart: sin double/num en $checked archivo(s) Dart"
exit 0
