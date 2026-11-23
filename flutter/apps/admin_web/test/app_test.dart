import 'dart:convert';
import 'dart:typed_data';

import 'package:admin_web/src/app_info.dart';
import 'package:api_client/api_client.dart';
import 'package:app_shell/app_shell.dart';
import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_core/shared_core.dart';

/// Kuota Admin con el shell compartido (T098): muestra SU nombre y envía SU `X-App-Version`. Los estados de arranque se
/// prueban una sola vez en `packages/app_shell/test/startup_test.dart`.
void main() {
  testWidgets('arranca con su identidad y consulta la compatibilidad como admin', (tester) async {
    final server = _Server();
    final client = KuotaApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3000'),
      appVersion: AppInfo.identity.appVersion,
      httpClientAdapter: server,
    );
    final config = AppConfig.fromValues({'KUOTA_ENV': 'local', 'KUOTA_API_BASE_URL': 'http://127.0.0.1:3000'});
    await tester.pumpWidget(
      kuotaAppScope(
        AppInfo.identity,
        overrides: [appConfigProvider.overrideWithValue(Ok(config)), apiClientProvider.overrideWithValue(client)],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Kuota Admin'), findsOneWidget);
    expect(find.text('Versión: 0.1.0+1'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('startup-status'))).data, 'Compatible con Kuota Core');
    expect(server.requests.single.headers['X-App-Version'], 'admin/0.1.0+1');
  });
}

/// Servidor falso: registra la solicitud real que envía dio y responde CompatibilityInfo.
final class _Server implements HttpClientAdapter {
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode({
        'api_version': '1.0.0',
        'min_supported': {'admin': '0.1.0', 'collector': '0.1.0', 'client': '0.1.0'},
        'client_supported': true,
        'server_time': '2026-11-23T12:00:00Z',
      }),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
