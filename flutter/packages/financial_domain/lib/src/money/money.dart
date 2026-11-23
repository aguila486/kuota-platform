/// Ubicación de `Money` y `RoundingMode` en Dart (T063; ADR-0007; R-08). PENDIENTE: este archivo no contiene
/// implementación, solo reserva la ruta que fija tasks.md.
///
/// Reglas que T063 debe cumplir (fuente: ADR-0007 y la implementación TypeScript, `backend/src/common/money/`):
/// - `amountMinor` es `BigInt` (nunca `int`, `double` ni `num`, tampoco en web), en el dominio simétrico
///   −9223372036854775807 … 9223372036854775807; fuera de él, `AMOUNT_OUT_OF_RANGE`.
/// - Catálogo cerrado idéntico a `contracts/fixtures/money/currencies.json` (BHD 3, CLF 4, JPY 0, MXN 2, USD 2).
/// - `add`/`subtract` solo en la misma moneda (`CURRENCY_MISMATCH`); `multiply(factor: Decimal, rounding)` sin modo
///   por defecto (`ROUNDING_REQUIRED`); `allocate` por mayor residuo con empates por índice; `parse` y `format`
///   canónicos; JSON `{amount_minor: string canónico, currency}` sin pérdida.
/// - Interpretaciones pendientes de confirmar antes de T063 (research.md, R-08): `parse` estricto y `allocate` con
///   total negativo.
library;
