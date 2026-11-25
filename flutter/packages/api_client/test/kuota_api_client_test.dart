import 'package:api_client/api_client.dart';
import 'package:dio/dio.dart';
import 'package:shared_core/shared_core.dart';
import 'package:test/test.dart';

import 'support/fake_adapter.dart';

/// T070: el cliente envuelto. Se prueba lo que Dio envía de verdad (URL y cabeceras finales tras los interceptores) y
/// cómo se deserializan las respuestas del contrato, contra un servidor falso con respuestas del esquema del contrato.
void main() {
  final appVersion = AppVersion(KuotaApp.collector, '1.4.2', build: 120);
  const compatibility = {
    'api_version': '1.0.0',
    'min_supported': {'admin': '0.1.0', 'collector': '1.2.0', 'client': '0.3.0'},
    'client_supported': true,
    'server_time': '2026-11-23T15:04:05.123Z',
  };
  Map<String, Object> problem(int status, String code) => {
    'type': 'https://errors.kuota.app/$code',
    'title': 'Título estable',
    'status': status,
    'code': code,
    'correlation_id': '0193b6f0-0000-7000-8000-000000000001',
  };

  KuotaApiClient client(FakeAdapter adapter, {String base = 'https://api.kuota.example'}) =>
      KuotaApiClient(baseUrl: Uri.parse(base), appVersion: appVersion, httpClientAdapter: adapter);

  group('getCompatibility', () {
    test('GET /v1/meta/compatibility con X-App-Version y X-Correlation-Id; DTO tipado del contrato', () async {
      final adapter = FakeAdapter([const FakeReply(200, compatibility)]);
      final result = await client(adapter).getCompatibility();

      final request = adapter.requests.single;
      expect(request.method, 'GET');
      expect(request.uri.toString(), 'https://api.kuota.example/v1/meta/compatibility');
      expect(request.headers[KuotaHeaders.appVersion], 'collector/1.4.2+120');
      expect(isUuid(request.headers[KuotaHeaders.correlationId] as String), isTrue);

      final info = (result as Ok<CompatibilityInfo>).value;
      expect(info.apiVersion, '1.0.0');
      expect(info.minSupported.collector, '1.2.0');
      expect(info.clientSupported, isTrue);
      expect(info.serverTime, DateTime.utc(2026, 11, 23, 15, 4, 5, 123));
    });

    test('client_supported nulo (sin X-App-Version reconocida) se representa como null', () async {
      final adapter = FakeAdapter([
        FakeReply(200, Map<String, Object?>.of(compatibility)..['client_supported'] = null),
      ]);
      final info = (await client(adapter).getCompatibility() as Ok<CompatibilityInfo>).value;
      expect(info.clientSupported, isNull);
    });

    test('error problem+json → Err con el code estable del contrato (no una excepción)', () async {
      final adapter = FakeAdapter([
        FakeReply(503, problem(503, 'service-unavailable'), contentType: 'application/problem+json; charset=utf-8'),
      ]);
      final result = await client(adapter).getCompatibility();
      expect(result, const Err<CompatibilityInfo>(Failure('service-unavailable', message: 'Título estable')));
    });

    test('error sin problem+json: 500 → unexpected-response, 502/503/504 → service-unavailable; sin respuesta → network-error', () async {
      final adapter = FakeAdapter([
        const FakeReply(500, '<html>Error</html>', contentType: 'text/html'),
        const FakeReply(502, '<html>Bad gateway</html>', contentType: 'text/html'),
        const FakeReply(504, '', contentType: 'text/plain'),
        const FakeReply.networkError(),
      ]);
      final api = client(adapter);
      expect((await api.getCompatibility() as Err).failure.code, ApiFailureCodes.unexpectedResponse);
      expect((await api.getCompatibility() as Err).failure.code, ApiFailureCodes.serviceUnavailable);
      expect((await api.getCompatibility() as Err).failure.code, ApiFailureCodes.serviceUnavailable);
      expect((await api.getCompatibility() as Err).failure.code, ApiFailureCodes.network);
    });
  });

  group('configuración', () {
    test(
      'URL base obligatoria: se usa la configurada, con su prefijo y sin barra final; nunca la de servers',
      () async {
        final adapter = FakeAdapter([const FakeReply(200, compatibility)]);
        final api = client(adapter, base: 'https://gateway.kuota.example/core/');
        expect(api.baseUrl, 'https://gateway.kuota.example/core');
        await api.getCompatibility();
        expect(adapter.requests.single.uri.toString(), 'https://gateway.kuota.example/core/v1/meta/compatibility');
        expect(adapter.requests.single.uri.host, isNot('localhost'));
      },
    );

    test('fromConfig toma KUOTA_API_BASE_URL de AppConfig', () async {
      final config = AppConfig.fromValues({
        AppConfig.environmentKey: 'staging',
        AppConfig.apiBaseUrlKey: 'https://api.staging.kuota.example',
      });
      final adapter = FakeAdapter([const FakeReply(200, compatibility)]);
      await KuotaApiClient.fromConfig(config, appVersion, httpClientAdapter: adapter).getCompatibility();
      expect(adapter.requests.single.uri.host, 'api.staging.kuota.example');
    });

    test('rechaza URLs base relativas, con credenciales, query o fragmento', () {
      for (final base in [
        '/v1',
        'ftp://x.example',
        'https://u:p@x.example',
        'https://x.example/?a=1',
        'https://x.example/#f',
      ]) {
        expect(() => client(FakeAdapter([]), base: base), throwsArgumentError, reason: base);
      }
    });

    test('sin credenciales incrustadas: ninguna solicitud lleva Authorization ni Cookie', () async {
      final adapter = FakeAdapter([const FakeReply(200, compatibility)]);
      await client(adapter).getCompatibility();
      final headers = adapter.requests.single.headers.keys.map((k) => k.toLowerCase());
      expect(headers, isNot(contains('authorization')));
      expect(headers, isNot(contains('cookie')));
    });
  });

  group('X-Correlation-Id y X-App-Version', () {
    test('un UUID nuevo por solicitud, generado con el generador inyectable', () async {
      final ids = ['0193b6f0-0000-7000-8000-00000000000a', '0193b6f0-0000-7000-8000-00000000000b'];
      final adapter = FakeAdapter([const FakeReply(200, compatibility), const FakeReply(200, compatibility)]);
      final api = KuotaApiClient(
        baseUrl: Uri.parse('https://api.kuota.example'),
        appVersion: appVersion,
        httpClientAdapter: adapter,
        correlationIdFactory: () => ids.removeAt(0),
      );
      await api.getCompatibility();
      await api.getCompatibility();
      expect(adapter.requests.map((r) => r.headers[KuotaHeaders.correlationId]), [
        '0193b6f0-0000-7000-8000-00000000000a',
        '0193b6f0-0000-7000-8000-00000000000b',
      ]);
    });

    test('newCorrelationId produce UUID v4 distintos', () {
      final ids = {for (var i = 0; i < 200; i++) newCorrelationId()};
      expect(ids, hasLength(200));
      expect(
        ids.every(
          (id) => RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(id),
        ),
        isTrue,
      );
    });

    test('AppVersion respeta el patrón del contrato y rechaza versiones inválidas', () {
      for (final v in [AppVersion(KuotaApp.admin, '0.1.0'), AppVersion(KuotaApp.client, '10.20.30', build: 7)]) {
        expect(AppVersion.headerPattern.hasMatch(v.headerValue), isTrue, reason: v.headerValue);
      }
      expect(() => AppVersion(KuotaApp.collector, '1.4'), throwsArgumentError);
      expect(() => AppVersion(KuotaApp.collector, '1.4.2-beta'), throwsArgumentError);
      expect(() => AppVersion(KuotaApp.collector, '1.4.2', build: -1), throwsArgumentError);
    });
  });

  group('idempotencia (ADR-0003): la clave pertenece a la operación, no al interceptor', () {
    Dio dioWithInterceptors(FakeAdapter adapter) => Dio(BaseOptions(baseUrl: 'https://api.kuota.example'))
      ..httpClientAdapter = adapter
      ..interceptors.addAll([CorrelationIdInterceptor(), AppVersionInterceptor(appVersion)]);

    test('los interceptores nunca generan Idempotency-Key', () async {
      final adapter = FakeAdapter([const FakeReply(200, {})]);
      await dioWithInterceptors(adapter).post<Object?>('/v1/futura-operacion', data: {'x': 1});
      expect(adapter.requests.single.headers.keys.map((k) => k.toLowerCase()), isNot(contains('idempotency-key')));
    });

    test('un reintento de la misma operación conserva exactamente la clave de la intención original', () async {
      final adapter = FakeAdapter([const FakeReply(503, {}), const FakeReply(201, {})]);
      final dio = dioWithInterceptors(adapter);
      const key = '0193b6f0-0000-7000-8000-0000000000cc'; // creada una sola vez, con la operación
      final options = Options(headers: {KuotaHeaders.idempotencyKey: key});
      await expectLater(
        dio.post<Object?>('/v1/futura-operacion', data: {'x': 1}, options: options),
        throwsA(isA<DioException>()),
      );
      await dio.post<Object?>('/v1/futura-operacion', data: {'x': 1}, options: options); // reintento
      expect(adapter.requests.map((r) => r.headers[KuotaHeaders.idempotencyKey]), [key, key]);
      // La correlación sí es por solicitud: el reintento es otra solicitud HTTP.
      final correlations = adapter.requests.map((r) => r.headers[KuotaHeaders.correlationId]).toSet();
      expect(correlations, hasLength(2));
    });

    test('un X-Correlation-Id válido aportado por quien llama se conserva; uno inválido se sustituye', () async {
      final adapter = FakeAdapter([const FakeReply(200, {}), const FakeReply(200, {})]);
      final dio = dioWithInterceptors(adapter);
      const own = '0193b6f0-0000-7000-8000-0000000000dd';
      await dio.get<Object?>('/x', options: Options(headers: {KuotaHeaders.correlationId: own}));
      await dio.get<Object?>('/x', options: Options(headers: {KuotaHeaders.correlationId: 'no-es-uuid'}));
      expect(adapter.requests[0].headers[KuotaHeaders.correlationId], own);
      expect(isUuid(adapter.requests[1].headers[KuotaHeaders.correlationId] as String), isTrue);
    });
  });
}
