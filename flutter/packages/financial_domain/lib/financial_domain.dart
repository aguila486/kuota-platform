/// Dominio financiero de Kuota en Dart puro (T082; ADR-0007).
///
/// Los cálculos de las apps son **proyecciones**: el servicio central es la única autoridad contable (Constitución).
/// El dinero es `BigInt` en unidades mínimas; `double`, `num` y `toDouble()` están prohibidos en `lib/`
/// (`scripts/ci/check-no-float-dart.sh`, R-10).
///
/// Estado (2026-11-23): solo estructura. `Money`, `RoundingMode` y el catálogo de monedas se implementan en T063
/// (`lib/src/money/`) con la misma API y errores que `backend/src/common/money/`. Los fixtures compartidos de
/// `contracts/fixtures/money/` se ejecutan en T059. Este archivo no exporta nada hasta entonces.
library;
