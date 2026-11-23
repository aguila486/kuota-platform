/// Dominio financiero de Kuota en Dart puro (T082, T063; ADR-0007).
///
/// Los cálculos de las apps son **proyecciones**: el servicio central es la única autoridad contable (Constitución).
/// El dinero es `BigInt` en unidades mínimas; `double`, `num` y `toDouble()` están prohibidos en `lib/`
/// (`scripts/ci/check-no-float-dart.sh`, R-10). Los factores y tasas son `Decimal` (paquete `decimal` 3.x).
library;

export 'src/money/currencies.dart' show isCurrencyCode, minorUnits, moneyCurrencies, requireCurrency;
export 'src/money/money.dart' show Money, canonicalAmountMinor, moneyMaxMinor, moneyMinMinor;
export 'src/money/money_error.dart' show MoneyError, MoneyErrorCode;
export 'src/money/rounding.dart' show RoundingMode, divideRounded;
