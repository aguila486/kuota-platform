import 'money_error.dart';

/// Catálogo cerrado de monedas (ADR-0007; R-08): código ISO 4217 → unidades menores (escala).
///
/// Idéntico al de `backend/src/common/money/currencies.ts` y a la copia de referencia
/// `contracts/fixtures/money/currencies.json`; las pruebas fallan si divergen. Ampliarlo es D-LEG-01.
const Map<String, int> moneyCurrencies = {'BHD': 3, 'CLF': 4, 'JPY': 0, 'MXN': 2, 'USD': 2};

/// ¿Está el código en el catálogo? (Distingue mayúsculas: `mxn` no es una moneda.)
bool isCurrencyCode(Object? value) => value is String && moneyCurrencies.containsKey(value);

/// Moneda del catálogo o `UNSUPPORTED_CURRENCY` (incluye minúsculas, vacíos y valores que no son String).
String requireCurrency(Object? value) {
  if (!isCurrencyCode(value)) throw const MoneyError(MoneyErrorCode.unsupportedCurrency);
  return value as String;
}

/// Escala de la moneda (unidades menores ISO 4217). Nunca viaja en el payload.
int minorUnits(String currency) => moneyCurrencies[requireCurrency(currency)]!;
