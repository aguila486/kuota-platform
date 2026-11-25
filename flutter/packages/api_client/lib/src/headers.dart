import 'dart:math';

import 'package:dio/dio.dart';

/// Cabeceras del contrato (contracts/openapi/parameters).
abstract final class KuotaHeaders {
  static const correlationId = 'X-Correlation-Id';
  static const appVersion = 'X-App-Version';
  static const idempotencyKey = 'Idempotency-Key';
}

/// App que llama al servicio central (`X-App-Version`: `<app>/<semver>+<build>`).
enum KuotaApp { admin, collector, client }

/// Versión de la app para `X-App-Version`. Valida el formato del contrato (`^(admin|collector|client)/\d+\.\d+\.\d+(\+\d+)?$`).
final class AppVersion {
  AppVersion(this.app, this.version, {this.build}) {
    if (!_semver.hasMatch(version)) throw ArgumentError.value(version, 'version', 'debe ser semver MAJOR.MINOR.PATCH');
    if (build != null && build! < 0) throw ArgumentError.value(build, 'build', 'debe ser ≥ 0');
  }

  static final _semver = RegExp(r'^\d+\.\d+\.\d+$');
  static final headerPattern = RegExp(r'^(admin|collector|client)/\d+\.\d+\.\d+(\+\d+)?$');

  final KuotaApp app;
  final String version;
  final int? build;

  String get headerValue => '${app.name}/$version${build == null ? '' : '+$build'}';

  @override
  String toString() => headerValue;
}

final _uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);

/// ¿Es un UUID (formato del contrato para `X-Correlation-Id`)?
bool isUuid(String value) => _uuid.hasMatch(value);

final _random = Random.secure();

/// UUID v4 aleatorio (generador criptográfico; disponible en VM, móvil y web).
String newCorrelationId() {
  final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// `X-Correlation-Id` en cada solicitud: conserva el que aporte quien llama si es un UUID válido; si falta o no es
/// válido, genera uno nuevo. El servidor lo devuelve en la respuesta y en los errores problem+json.
final class CorrelationIdInterceptor extends Interceptor {
  CorrelationIdInterceptor({String Function()? generate}) : _generate = generate ?? newCorrelationId;

  final String Function() _generate;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final current = options.headers[KuotaHeaders.correlationId];
    if (current is! String || !isUuid(current)) options.headers[KuotaHeaders.correlationId] = _generate();
    handler.next(options);
  }
}

/// `X-App-Version` en cada solicitud, para que el servicio central evalúe la compatibilidad de la app.
final class AppVersionInterceptor extends Interceptor {
  AppVersionInterceptor(this.appVersion);

  final AppVersion appVersion;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers[KuotaHeaders.appVersion] = appVersion.headerValue;
    handler.next(options);
  }
}
