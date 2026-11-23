#!/usr/bin/env bash
# Prepara en CI (Linux x64) el SDK EXACTO de flutter/.fvmrc sin acciones de terceros ni FVM: descarga el archivo oficial
# de Flutter y verifica su sha256 contra el valor fijado aquí (publicado en releases_linux.json, verificado el
# 2026-11-23). Exporta KUOTA_FLUTTER_SDK para los pasos siguientes (GITHUB_ENV). En local se usa FVM (lib.sh,
# use_project_flutter); este script no es necesario.
# Cambiar la versión de .fvmrc exige añadir aquí su sha256: si no está, falla.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(sed -nE 's/.*"flutter"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/flutter/.fvmrc")"
case "$VERSION" in
  3.50.1) SHA256="4ad17fc8462fbcef2ba19ff4a78c0a16b7147fde1add8578e267ea62cdb92678" ;;
  *) echo "setup-flutter: no hay sha256 fijado para Flutter $VERSION; añádelo desde releases_linux.json" >&2; exit 1 ;;
esac
[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || { echo "setup-flutter: solo para Linux x64 (CI)" >&2; exit 1; }
ARCHIVE="flutter_linux_${VERSION}-stable.tar.xz"
URL="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/$ARCHIVE"
DEST="${RUNNER_TEMP:-$HOME/.cache}/kuota-flutter-$VERSION"
mkdir -p "$DEST"
curl --fail --location --silent --show-error --retry 3 -o "$DEST/$ARCHIVE" "$URL"
echo "$SHA256  $DEST/$ARCHIVE" | sha256sum --check --strict
tar -xJf "$DEST/$ARCHIVE" -C "$DEST"
rm -f "$DEST/$ARCHIVE"
git config --global --add safe.directory "$DEST/flutter"
"$DEST/flutter/bin/flutter" config --no-analytics >/dev/null
"$DEST/flutter/bin/flutter" --version
[ -n "${GITHUB_ENV:-}" ] && echo "KUOTA_FLUTTER_SDK=$DEST/flutter" >>"$GITHUB_ENV"
echo "KUOTA_FLUTTER_SDK=$DEST/flutter"
