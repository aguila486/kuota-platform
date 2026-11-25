import 'money_error.dart';

/// Modos de redondeo (ADR-0007). No hay modo por defecto: cada operación inexacta debe indicarlo. Qué modo usa cada
/// operación de negocio es D-FIN-02 (pendiente).
enum RoundingMode {
  /// Mitad alejándose de cero.
  halfUp('HALF_UP'),

  /// Mitad al par.
  halfEven('HALF_EVEN'),

  /// Hacia cero.
  down('DOWN'),

  /// Alejándose de cero.
  up('UP'),

  /// Hacia −∞.
  floor('FLOOR'),

  /// Hacia +∞.
  ceiling('CEILING');

  const RoundingMode(this.code);

  /// Nombre compartido con TypeScript y los fixtures (`HALF_UP`, …).
  final String code;

  /// Modo a partir de su nombre compartido; `ArgumentError` si no existe.
  static RoundingMode fromCode(String code) => values.firstWhere(
    (m) => m.code == code,
    orElse: () => throw ArgumentError.value(code, 'code', 'modo desconocido'),
  );
}

/// `numerator / denominator` redondeado a entero con aritmética exacta (`BigInt`); `denominator` > 0. Misma semántica que
/// `divideRounded` de TypeScript. Si la división es exacta no exige modo; si es inexacta y no hay modo →
/// `ROUNDING_REQUIRED`.
BigInt divideRounded(BigInt numerator, BigInt denominator, [RoundingMode? mode]) {
  if (denominator <= BigInt.zero) throw RangeError('El divisor debe ser positivo');
  final quotient = numerator ~/ denominator; // trunca hacia cero
  final remainder = numerator.remainder(denominator); // mismo signo que el numerador
  if (remainder == BigInt.zero) return quotient;
  if (mode == null) throw const MoneyError(MoneyErrorCode.roundingRequired);
  final sign = numerator.isNegative ? -BigInt.one : BigInt.one;
  final twiceRemainder = remainder.abs() * BigInt.two;
  switch (mode) {
    case RoundingMode.down:
      return quotient;
    case RoundingMode.up:
      return quotient + sign;
    case RoundingMode.floor:
      return sign.isNegative ? quotient - BigInt.one : quotient;
    case RoundingMode.ceiling:
      return sign.isNegative ? quotient : quotient + BigInt.one;
    case RoundingMode.halfUp:
      return twiceRemainder >= denominator ? quotient + sign : quotient;
    case RoundingMode.halfEven:
      if (twiceRemainder > denominator) return quotient + sign;
      if (twiceRemainder < denominator) return quotient;
      return quotient.isEven ? quotient : quotient + sign;
  }
}
