import 'package:api_client/api_client.dart';
import 'package:api_client/src/generated/generated.dart' as generated;
import 'package:shared_core/shared_core.dart';
import 'package:test/test.dart';

import 'support/fake_adapter.dart';

/// T085: clasificación de la compatibilidad a partir de respuestas reales del cliente (servidor falso con el esquema del
/// contrato). Nunca "compatible" sin una respuesta válida que lo confirme.
void main() {
  CompatibilityInfo info({bool? supported}) =>
      generated.standardSerializers.deserializeWith(CompatibilityInfo.serializer, {
        'api_version': '1.0.0',
        'min_supported': {'admin': '0.1.0', 'collector': '0.1.0', 'client': '0.1.0'},
        'client_supported': supported,
        'server_time': '2026-11-23T12:00:00Z',
      })!;

  test('client_supported true → Compatible; false → Incompatible con la información del servidor', () {
    expect(classifyCompatibility(Ok(info(supported: true))), isA<Compatible>());
    final incompatible = classifyCompatibility(Ok(info(supported: false)));
    expect(incompatible, isA<Incompatible>());
    expect((incompatible as Incompatible).info?.minSupported.collector, '0.1.0');
  });

  test('client_supported ausente → indeterminado (UnexpectedCompatibility), nunca Compatible', () {
    final status = classifyCompatibility(Ok(info()));
    expect(status, isA<UnexpectedCompatibility>());
    expect((status as UnexpectedCompatibility).failure.code, 'compatibility-undetermined');
  });

  test('app-version-unsupported (contrato, 426) → Incompatible', () {
    expect(classifyCompatibility(const Err(Failure(appVersionUnsupported))), isA<Incompatible>());
  });

  test('sin red o 502/503/504 sin problem+json → ApiUnavailable; otros errores → UnexpectedCompatibility', () {
    expect(classifyCompatibility(const Err(Failure(ApiFailureCodes.network))), isA<ApiUnavailable>());
    expect(classifyCompatibility(const Err(Failure(ApiFailureCodes.serviceUnavailable))), isA<ApiUnavailable>());
    for (final code in ['internal-error', 'validation-error', ApiFailureCodes.unexpectedResponse]) {
      expect(classifyCompatibility(Err(Failure(code))), isA<UnexpectedCompatibility>(), reason: code);
    }
  });

  test('extremo a extremo con el cliente: 503 de un proxy (HTML) → service-unavailable → ApiUnavailable', () async {
    final adapter = FakeAdapter([const FakeReply(503, '<html>no disponible</html>', contentType: 'text/html')]);
    final client = KuotaApiClient(
      baseUrl: Uri.parse('https://api.kuota.example'),
      appVersion: AppVersion(KuotaApp.client, '0.1.0'),
      httpClientAdapter: adapter,
    );
    final result = await client.getCompatibility();
    expect((result as Err).failure.code, ApiFailureCodes.serviceUnavailable);
    expect(classifyCompatibility(result), isA<ApiUnavailable>());
  });

  test('checkCompatibility consulta y clasifica en una sola llamada (la usan las tres apps)', () async {
    KuotaApiClient client(List<FakeReply> replies) => KuotaApiClient(
      baseUrl: Uri.parse('https://api.kuota.example'),
      appVersion: AppVersion(KuotaApp.collector, '0.1.0', build: 1),
      httpClientAdapter: FakeAdapter(replies),
    );
    final body = {
      'api_version': '1.0.0',
      'min_supported': {'admin': '0.1.0', 'collector': '0.2.0', 'client': '0.1.0'},
      'client_supported': false,
      'server_time': '2026-11-23T12:00:00Z',
    };
    final incompatible = await client([FakeReply(200, body)]).checkCompatibility();
    expect(incompatible, isA<Incompatible>());
    expect((incompatible as Incompatible).info!.minSupported.collector, '0.2.0');
    expect(
      await client([const FakeReply(503, '<html/>', contentType: 'text/html')]).checkCompatibility(),
      isA<ApiUnavailable>(),
    );
  });
}
