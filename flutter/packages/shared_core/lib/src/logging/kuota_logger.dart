import 'dart:convert';
import 'dart:developer' as developer;

/// Nivel de un registro de log.
enum LogLevel { debug, info, warning, error }

/// Registro de log ya saneado: es lo único que recibe un [LogSink].
final class LogRecord {
  const LogRecord({
    required this.time,
    required this.level,
    required this.logger,
    required this.message,
    required this.fields,
  });

  final DateTime time;
  final LogLevel level;
  final String logger;
  final String message;
  final Map<String, Object?> fields;

  /// JSON de una línea (misma forma que los logs del servicio central: `level`, `time`, `msg` y campos).
  Map<String, Object?> toJson() => {
    'level': level.name,
    'time': time.toUtc().toIso8601String(),
    'logger': logger,
    'msg': message,
    ...fields,
  };
}

/// Destino de los registros. Por defecto, `dart:developer` (disponible en VM, móvil y web).
typedef LogSink = void Function(LogRecord record);

/// Valor que sustituye a los datos sensibles.
const redacted = '[REDACTED]';

/// Claves cuyo valor nunca se registra, a cualquier profundidad (sin distinguir mayúsculas). Misma lista que el
/// servicio central (`backend/src/common/logging/redaction.ts`, FR-010).
const _sensitiveKeys = {
  'phone',
  'email',
  'password',
  'otp',
  'pin',
  'token',
  'access_token',
  'refresh_token',
  'tax_id',
  'curp',
  'rfc',
  'authorization',
  'cookie',
  'set-cookie',
};

final _email = RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
// 10 a 15 dígitos con separadores opcionales; no pegado a letras, dígitos ni guiones (evita UUID).
final _phone = RegExp(r'(?<![\w-])\+?\d(?:[\s().-]?\d){9,14}(?![\w-])');
final _keyValueSecret = RegExp(
  r'\b(password|passwd|pwd|secret|token|otp|pin|api[_-]?key)(\s*[=:]\s*)[^\s,;&]+',
  caseSensitive: false,
);
final _bearer = RegExp(r'\bBearer\s+[A-Za-z0-9._~+/=-]+');

/// Enmascara correos, teléfonos y secretos tipo `clave=valor` o `Bearer …` en texto libre.
String maskSensitiveText(String text) => text
    .replaceAll(_bearer, 'Bearer $redacted')
    .replaceAllMapped(_keyValueSecret, (m) => '${m[1]}${m[2]}$redacted')
    .replaceAll(_email, '[REDACTED:email]')
    .replaceAll(_phone, '[REDACTED:phone]');

const _maxDepth = 8;

/// Copia saneada de un valor de log: redacta claves sensibles y enmascara texto a cualquier profundidad. Cualquier
/// objeto que no sea un tipo JSON básico se sustituye por su tipo (nunca se serializa su contenido).
Object? sanitizeLogValue(Object? value, [int depth = 0]) {
  if (value is String) return maskSensitiveText(value);
  if (value == null || value is bool || value is num) return value;
  if (value is BigInt) return value.toString(); // exacto (montos en unidades mínimas), JSON sin pérdida
  if (value is DateTime) return value.toUtc().toIso8601String();
  if (depth >= _maxDepth) return '[TRUNCATED]';
  if (value is Iterable<Object?>) return [for (final item in value) sanitizeLogValue(item, depth + 1)];
  if (value is Map<Object?, Object?>) {
    return {
      for (final MapEntry(:key, value: item) in value.entries)
        '$key': _sensitiveKeys.contains('$key'.toLowerCase()) ? redacted : sanitizeLogValue(item, depth + 1),
    };
  }
  return '[${value.runtimeType}]';
}

/// Logger estructurado sin PII (T081; FR-009/FR-010 en el lado móvil). Sanea el mensaje y los campos antes de que
/// lleguen al [LogSink]: nunca escribe correos, teléfonos, tokens, contraseñas ni objetos arbitrarios.
final class KuotaLogger {
  KuotaLogger(this.name, {LogSink? sink, DateTime Function()? clock, this.minLevel = LogLevel.info})
    : _sink = sink ?? _developerSink,
      _clock = clock ?? DateTime.now;

  final String name;
  final LogLevel minLevel;
  final LogSink _sink;
  final DateTime Function() _clock;

  void debug(String message, [Map<String, Object?> fields = const {}]) => log(LogLevel.debug, message, fields);
  void info(String message, [Map<String, Object?> fields = const {}]) => log(LogLevel.info, message, fields);
  void warning(String message, [Map<String, Object?> fields = const {}]) => log(LogLevel.warning, message, fields);
  void error(String message, [Map<String, Object?> fields = const {}]) => log(LogLevel.error, message, fields);

  void log(LogLevel level, String message, [Map<String, Object?> fields = const {}]) {
    if (level.index < minLevel.index) return;
    _sink(
      LogRecord(
        time: _clock(),
        level: level,
        logger: name,
        message: maskSensitiveText(message),
        fields: sanitizeLogValue(fields)! as Map<String, Object?>,
      ),
    );
  }

  static void _developerSink(LogRecord record) =>
      developer.log(jsonEncode(record.toJson()), name: record.logger, level: 800 + record.level.index * 100);
}
