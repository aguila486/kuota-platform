import 'package:decimal/decimal.dart';

import 'currencies.dart';
import 'money_error.dart';
import 'rounding.dart';

/// Máximo del dominio simétrico de `amountMinor` (ADR-0007).
final BigInt moneyMaxMinor = BigInt.parse('9223372036854775807');

/// Mínimo del dominio: −9223372036854775807. −2^63 queda fuera aunque `BIGINT` lo admita.
final BigInt moneyMinMinor = -moneyMaxMinor;

/// Forma canónica de `amount_minor` en JSON: `0` o signo opcional y 1–19 dígitos sin ceros a la izquierda. Solo valida
/// la forma; el dominio se comprueba numéricamente.
final RegExp canonicalAmountMinor = RegExp(r'^(0|-?[1-9][0-9]{0,18})$');

final RegExp _parseText = RegExp(r'^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$');
const int _maxIntegerDigits = 19;

/// Límite de tamaño de un factor (≈ 1000 dígitos, como en TypeScript): protege de valores extremos; ningún factor real
/// se acerca.
const int _maxFactorBits = 3322;

void _assertInDomain(BigInt amountMinor) {
  if (amountMinor > moneyMaxMinor || amountMinor < moneyMinMinor) {
    throw const MoneyError(MoneyErrorCode.amountOutOfRange);
  }
}

/// Money inmutable (T063; ADR-0007; data-model.md, Objetos de valor): `amountMinor` en unidades mínimas (`BigInt`, nunca
/// `int`, `double` ni `num`, también en web) y moneda del catálogo cerrado. Misma API, misma semántica y mismos errores
/// que `backend/src/common/money/money.ts`.
///
/// Los cálculos en las apps son proyecciones: el servicio central es la única autoridad contable.
final class Money {
  const Money._(this.amountMinor, this.currency);

  /// Construye un Money validando moneda (`UNSUPPORTED_CURRENCY`) y dominio (`AMOUNT_OUT_OF_RANGE`), en ese orden.
  factory Money.of(BigInt amountMinor, String currency) {
    final code = requireCurrency(currency);
    _assertInDomain(amountMinor);
    return Money._(amountMinor, code);
  }

  factory Money.zero(String currency) => Money.of(BigInt.zero, currency);

  /// Cadena decimal de presentación → Money. Acepta `-?(0|[1-9][0-9]*)(.[0-9]+)?` sin separadores, signo `+`, espacios
  /// ni exponentes (`INVALID_AMOUNT`); más decimales que la escala → `TOO_MANY_DECIMALS` (nunca redondea); cero negativo
  /// (`-0`, `-0.00`) → `INVALID_AMOUNT`; fuera de dominio → `AMOUNT_OUT_OF_RANGE`. Se valida primero la moneda.
  factory Money.parse(String text, String currency) {
    final code = requireCurrency(currency);
    final scale = minorUnits(code);
    final match = _parseText.firstMatch(text);
    if (match == null) throw const MoneyError(MoneyErrorCode.invalidAmount);
    final negative = match.group(1) == '-';
    final integer = match.group(2)!;
    final fraction = match.group(3) ?? '';
    if (fraction.length > scale) throw const MoneyError(MoneyErrorCode.tooManyDecimals);
    if (integer.length > _maxIntegerDigits) throw const MoneyError(MoneyErrorCode.amountOutOfRange);
    final magnitude = BigInt.parse('$integer${fraction.padRight(scale, '0')}');
    if (negative && magnitude == BigInt.zero) throw const MoneyError(MoneyErrorCode.invalidAmount);
    return Money.of(negative ? -magnitude : magnitude, code);
  }

  /// JSON → Money (operación `from_json` de los fixtures; FR-022). Orden de validación: moneda
  /// (`UNSUPPORTED_CURRENCY`), forma canónica de `amount_minor` (`INVALID_AMOUNT`: `-0`, ceros a la izquierda,
  /// decimales, exponentes, espacios, signo `+`, números JSON en lugar de String) y dominio (`AMOUNT_OUT_OF_RANGE`).
  /// Nunca pasa por `int`, `double` ni `num`.
  factory Money.fromJson(Object? json) {
    if (json is! Map) throw const MoneyError(MoneyErrorCode.invalidAmount);
    final code = requireCurrency(json['currency']);
    final amountMinor = json['amount_minor'];
    if (amountMinor is! String || !canonicalAmountMinor.hasMatch(amountMinor)) {
      throw const MoneyError(MoneyErrorCode.invalidAmount);
    }
    return Money.of(BigInt.parse(amountMinor), code);
  }

  /// Monto en unidades mínimas.
  final BigInt amountMinor;

  /// Código ISO 4217 del catálogo.
  final String currency;

  Money add(Money other) {
    _assertSameCurrency(other);
    return Money.of(amountMinor + other.amountMinor, currency);
  }

  Money subtract(Money other) {
    _assertSameCurrency(other);
    return Money.of(amountMinor - other.amountMinor, currency);
  }

  /// Multiplica por un factor decimal exacto. Si el resultado no es entero en unidades mínimas, exige [rounding]
  /// (`ROUNDING_REQUIRED`); no hay modo por defecto. Resultado fuera de dominio → `AMOUNT_OUT_OF_RANGE`. El producto
  /// se calcula con `BigInt` a partir de la fracción exacta del factor: nunca se redondea un intermedio.
  Money multiply(Decimal factor, [RoundingMode? rounding]) {
    final fraction = factor.toRational();
    final numerator = fraction.numerator;
    final denominator = fraction.denominator; // > 0 y potencia de 2·5 en un Decimal
    if (numerator.bitLength > _maxFactorBits || denominator.bitLength > _maxFactorBits) {
      throw RangeError('Factor fuera de rango');
    }
    return Money.of(divideRounded(amountMinor * numerator, denominator, rounding), currency);
  }

  /// Reparto exacto en [parts] partes iguales (entero ≥ 1); equivale a [allocateRatios] con unos.
  List<Money> allocate(int parts) {
    if (parts < 1) throw RangeError.value(parts, 'parts', 'El número de partes debe ser un entero ≥ 1');
    return allocateRatios(List<int>.filled(parts, 1));
  }

  /// Reparto exacto por mayor residuo: la suma de las partes es igual al total; los empates se resuelven por índice (el
  /// menor primero). Con total negativo se reparte el valor absoluto y se aplica el signo a cada parte. Las
  /// proporciones son enteros ≥ 0 con al menos una mayor que cero.
  List<Money> allocateRatios(List<int> ratios) {
    if (ratios.isEmpty || ratios.any((r) => r < 0)) {
      throw ArgumentError.value(ratios, 'ratios', 'Las proporciones deben ser enteros ≥ 0');
    }
    final weights = [for (final r in ratios) BigInt.from(r)];
    final total = weights.fold(BigInt.zero, (sum, w) => sum + w);
    if (total == BigInt.zero) {
      throw ArgumentError.value(ratios, 'ratios', 'Al menos una proporción debe ser mayor que cero');
    }
    final negative = amountMinor.isNegative;
    final magnitude = amountMinor.abs();
    final shares = [
      for (var i = 0; i < weights.length; i++)
        (index: i, base: (magnitude * weights[i]) ~/ total, rest: (magnitude * weights[i]).remainder(total)),
    ];
    var leftover = magnitude - shares.fold(BigInt.zero, (sum, s) => sum + s.base);
    final byRemainder = [...shares]
      ..sort((x, y) => x.rest == y.rest ? x.index.compareTo(y.index) : y.rest.compareTo(x.rest));
    final extra = <int>{};
    for (final share in byRemainder) {
      if (leftover == BigInt.zero) break;
      extra.add(share.index);
      leftover -= BigInt.one;
    }
    Money part(({int index, BigInt base, BigInt rest}) s) {
      final value = s.base + (extra.contains(s.index) ? BigInt.one : BigInt.zero);
      return Money.of(negative ? -value : value, currency);
    }

    return [for (final s in shares) part(s)];
  }

  /// Cadena decimal canónica con exactamente `escala` decimales y punto (`1234.50`, `-0.75`, `100` en JPY). El formato
  /// localizado lo hace solo la UI (`design_system`) y nunca vuelve a un cálculo.
  String format() {
    final scale = minorUnits(currency);
    final negative = amountMinor.isNegative;
    final digits = amountMinor.abs().toString();
    final sign = negative ? '-' : '';
    if (scale == 0) return '$sign$digits';
    final padded = digits.padLeft(scale + 1, '0');
    return '$sign${padded.substring(0, padded.length - scale)}.${padded.substring(padded.length - scale)}';
  }

  /// JSON del contrato (ADR-0007): `amount_minor` siempre String canónico.
  Map<String, String> toJson() => {'amount_minor': amountMinor.toString(), 'currency': currency};

  bool equals(Money other) => this == other;

  @override
  bool operator ==(Object other) => other is Money && other.currency == currency && other.amountMinor == amountMinor;

  @override
  int get hashCode => Object.hash(amountMinor, currency);

  @override
  String toString() => 'Money(${format()} $currency)';

  void _assertSameCurrency(Money other) {
    if (other.currency != currency) throw const MoneyError(MoneyErrorCode.currencyMismatch);
  }
}
