/// Códigos de error de dominio de Money (ADR-0007). El texto de [MoneyErrorCode.code] es contrato con TypeScript
/// (`backend/src/common/money/money-error.ts`) y con los fixtures compartidos.
enum MoneyErrorCode {
  currencyMismatch('CURRENCY_MISMATCH', 'Operación entre monedas distintas'),
  roundingRequired('ROUNDING_REQUIRED', 'El resultado es inexacto y no se indicó un modo de redondeo'),
  invalidAmount('INVALID_AMOUNT', 'Monto con formato inválido'),
  tooManyDecimals('TOO_MANY_DECIMALS', 'El monto tiene más decimales que la escala de la moneda'),
  amountOutOfRange('AMOUNT_OUT_OF_RANGE', 'Monto fuera del dominio de Money (±9223372036854775807 unidades mínimas)'),
  unsupportedCurrency('UNSUPPORTED_CURRENCY', 'Moneda no soportada');

  const MoneyErrorCode(this.code, this.message);

  /// Código estable compartido con TypeScript (p. ej. `CURRENCY_MISMATCH`).
  final String code;

  /// Mensaje fijo: nunca incluye el valor recibido.
  final String message;
}

/// Error tipado de Money. Los argumentos inválidos de programación (partes ≤ 0, proporciones negativas, factores
/// extremos) son `ArgumentError`/`RangeError`, igual que en TypeScript, no códigos de Money.
final class MoneyError implements Exception {
  const MoneyError(this.errorCode);

  final MoneyErrorCode errorCode;

  /// Código estable (p. ej. `AMOUNT_OUT_OF_RANGE`).
  String get code => errorCode.code;

  String get message => errorCode.message;

  @override
  String toString() => 'MoneyError($code): $message';
}
