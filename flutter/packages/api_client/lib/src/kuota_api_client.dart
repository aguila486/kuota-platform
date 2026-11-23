import 'package:dio/dio.dart';
import 'package:shared_core/shared_core.dart';

import 'compatibility_status.dart';
import 'generated/generated.dart';
import 'headers.dart';

/// Códigos de [Failure] que produce el CLIENTE cuando el servidor no devuelve un problem+json con `code` (no son códigos
/// del contrato; los del contrato llegan tal cual en [Failure.code]).
abstract final class ApiFailureCodes {
  /// Sin respuesta del servidor (conexión, DNS, TLS, tiempo de espera, cancelación).
  static const network = 'network-error';

  /// 502, 503 o 504 sin problem+json (típico de un proxy o balanceador con Kuota Core caído). Código del CLIENTE, de
  /// transporte: no es un `code` del contrato.
  static const serviceUnavailable = 'service-unavailable';

  /// Respuesta de error sin un problem+json reconocible.
  static const unexpectedResponse = 'unexpected-response';
}

/// Cliente de Kuota Core para las apps (T070). Envuelve el código generado desde el bundle de CLIENTE del contrato
/// (sin dev-probe) y añade:
/// - URL base obligatoria desde [AppConfig] (nunca la de `servers` del contrato);
/// - `X-Correlation-Id` (UUID) y `X-App-Version` en cada solicitud;
/// - errores como [Result]: problem+json → [Failure] con el `code` estable del contrato.
///
/// **Idempotencia (ADR-0003):** ningún interceptor genera ni modifica `Idempotency-Key`. La clave la crea quien crea la
/// operación (la intención original) y la reutiliza en cada reintento de esa misma operación. 001 no tiene operaciones
/// idempotentes en el cliente distribuible: dev-probe es técnico y no se genera.
///
/// Sin credenciales: no hay autenticación en 001 (002). Las clases `auth/*` del código generado son interceptores
/// genéricos sin valores.
final class KuotaApiClient {
  KuotaApiClient({
    required Uri baseUrl,
    required AppVersion appVersion,
    HttpClientAdapter? httpClientAdapter,
    String Function()? correlationIdFactory,
    Duration connectTimeout = const Duration(seconds: 10),
    Duration receiveTimeout = const Duration(seconds: 20),
  }) : _api = ApiClient(
         dio:
             Dio(
                 BaseOptions(
                   baseUrl: _normalizeBaseUrl(baseUrl),
                   connectTimeout: connectTimeout,
                   receiveTimeout: receiveTimeout,
                 ),
               )
               ..interceptors.addAll([
                 CorrelationIdInterceptor(generate: correlationIdFactory),
                 AppVersionInterceptor(appVersion),
               ]),
       ) {
    if (httpClientAdapter != null) _api.dio.httpClientAdapter = httpClientAdapter;
  }

  /// Cliente configurado desde [AppConfig] (`KUOTA_API_BASE_URL` del entorno).
  factory KuotaApiClient.fromConfig(AppConfig config, AppVersion appVersion, {HttpClientAdapter? httpClientAdapter}) =>
      KuotaApiClient(baseUrl: config.apiBaseUrl, appVersion: appVersion, httpClientAdapter: httpClientAdapter);

  final ApiClient _api;

  /// URL base efectiva (sin barra final).
  String get baseUrl => _api.dio.options.baseUrl;

  /// `GET /v1/meta/compatibility` (FR-032): versión de la API, versiones mínimas por app y, si se envió
  /// `X-App-Version`, si esta app está soportada.
  Future<Result<CompatibilityInfo>> getCompatibility() => _call(() => _api.getMetaApi().getCompatibility());

  /// [getCompatibility] clasificada (FR-032): compatible, incompatible, Kuota Core no disponible o respuesta inesperada.
  /// Nunca "compatible" sin una respuesta válida del servidor.
  Future<CompatibilityStatus> checkCompatibility() async => classifyCompatibility(await getCompatibility());

  /// Libera las conexiones del cliente.
  void close({bool force = false}) => _api.dio.close(force: force);

  Future<Result<T>> _call<T>(Future<Response<T>> Function() request) async {
    try {
      final response = await request();
      final data = response.data;
      if (data == null) return const Err(Failure(ApiFailureCodes.unexpectedResponse, message: 'respuesta vacía'));
      return Ok(data);
    } on DioException catch (error) {
      return Err(_failureOf(error));
    }
  }

  static Failure _failureOf(DioException error) {
    final response = error.response;
    if (response == null) return Failure(ApiFailureCodes.network, message: error.type.name);
    final body = response.data;
    if (body is Map && body['code'] is String) {
      // problem+json del contrato: `code` estable; el título no contiene datos del usuario (RFC 9457, FR-011).
      return Failure(body['code'] as String, message: body['title'] is String ? body['title'] as String : null);
    }
    if (const {502, 503, 504}.contains(response.statusCode)) {
      return Failure(ApiFailureCodes.serviceUnavailable, message: 'HTTP ${response.statusCode}');
    }
    return Failure(ApiFailureCodes.unexpectedResponse, message: 'HTTP ${response.statusCode}');
  }

  static String _normalizeBaseUrl(Uri baseUrl) {
    if (!baseUrl.isAbsolute || !(baseUrl.isScheme('http') || baseUrl.isScheme('https')) || baseUrl.host.isEmpty) {
      throw ArgumentError.value('$baseUrl', 'baseUrl', 'debe ser una URL absoluta http o https');
    }
    if (baseUrl.hasQuery || baseUrl.hasFragment || baseUrl.userInfo.isNotEmpty) {
      throw ArgumentError('baseUrl no debe contener credenciales, query ni fragmento');
    }
    final text = baseUrl.toString();
    return text.endsWith('/') ? text.substring(0, text.length - 1) : text;
  }
}
