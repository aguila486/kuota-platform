/// Fallo esperado de una operación (T081; flutter-architecture.md: `Result/Failure`). `code` es estable y apto para
/// lógica (por ejemplo, el `code` de un problem+json del servicio central); `message` es solo diagnóstico y nunca debe
/// contener datos personales ni secretos.
final class Failure {
  const Failure(this.code, {this.message});

  final String code;
  final String? message;

  @override
  bool operator ==(Object other) => other is Failure && other.code == code && other.message == message;

  @override
  int get hashCode => Object.hash(code, message);

  @override
  String toString() => message == null ? 'Failure($code)' : 'Failure($code: $message)';
}

/// Resultado de una operación que puede fallar de forma esperada, sin excepciones: [Ok] con el valor o [Err] con un
/// [Failure]. Es `sealed`: un `switch` sobre un `Result` es exhaustivo.
sealed class Result<T> {
  const Result();

  bool get isOk => this is Ok<T>;

  /// Transforma el valor de un [Ok]; un [Err] se propaga sin cambios.
  Result<R> map<R>(R Function(T value) transform) => switch (this) {
    Ok(:final value) => Ok(transform(value)),
    Err(:final failure) => Err(failure),
  };

  /// Reduce el resultado a un valor, tratando ambos casos.
  R fold<R>({required R Function(T value) ok, required R Function(Failure failure) err}) => switch (this) {
    Ok(:final value) => ok(value),
    Err(:final failure) => err(failure),
  };
}

final class Ok<T> extends Result<T> {
  const Ok(this.value);

  final T value;

  @override
  bool operator ==(Object other) => other is Ok<T> && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => 'Ok($value)';
}

final class Err<T> extends Result<T> {
  const Err(this.failure);

  final Failure failure;

  @override
  bool operator ==(Object other) => other is Err<T> && other.failure == failure;

  @override
  int get hashCode => failure.hashCode;

  @override
  String toString() => 'Err($failure)';
}
