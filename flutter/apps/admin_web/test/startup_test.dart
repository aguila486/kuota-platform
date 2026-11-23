import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:admin_web/src/app.dart';
import 'package:admin_web/src/app_info.dart';
import 'package:admin_web/src/providers.dart';
import 'package:api_client/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_core/shared_core.dart';

/// T085 (US7-2, FR-032): la app real (ProviderScope de Riverpod, api_client y la pantalla común) frente a un servidor
/// falso con respuestas del contrato: cargando, compatible, incompatible, no disponible, inesperado y configuración
/// inválida. Ninguna prueba accede a la red.
void main() {
  final local = AppConfig.fromValues({'KUOTA_ENV': 'local', 'KUOTA_API_BASE_URL': 'http://127.0.0.1:3000'});
  Map<String, Object?> compatibility({bool? supported = true}) => {
    'api_version': '1.0.0',
    'min_supported': {'admin': '0.1.0', 'collector': '0.2.0', 'client': '0.3.0'},
    'client_supported': supported,
    'server_time': '2026-11-23T12:00:00Z',
  };

  Future<_Server> start(WidgetTester tester, List<_Reply> replies, {Result<AppConfig>? config}) async {
    final server = _Server(replies);
    final client = KuotaApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3000'),
      appVersion: AppInfo.appVersion,
      httpClientAdapter: server,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(config ?? Ok(local)),
          apiClientProvider.overrideWithValue(config is Err ? null : client),
        ],
        child: const KuotaShellApp(),
      ),
    );
    return server;
  }

  String status(WidgetTester tester) => tester.widget<Text>(find.byKey(const Key('startup-status'))).data!;
  String? detail(WidgetTester tester) {
    final found = find.byKey(const Key('startup-status-detail'));
    return found.evaluate().isEmpty ? null : tester.widget<Text>(found).data;
  }

  testWidgets('muestra nombre, entorno y versión; "cargando" hasta la respuesta; luego compatible', (tester) async {
    final gate = Completer<void>();
    final server = await start(tester, [_Reply(200, compatibility(), wait: gate.future)]);
    await tester.pump();
    expect(find.text('Kuota Admin'), findsOneWidget);
    expect(find.text('Entorno: local'), findsOneWidget);
    expect(find.text('Versión: 0.1.0+1'), findsOneWidget);
    expect(status(tester), 'Comprobando compatibilidad con Kuota Core…');
    gate.complete();
    await tester.pumpAndSettle();
    expect(status(tester), 'Compatible con Kuota Core');
    expect(detail(tester), 'API 1.0.0');
    final request = server.requests.single;
    expect(request.uri.path, '/v1/meta/compatibility');
    expect(request.headers['X-App-Version'], 'admin/0.1.0+1');
  });

  testWidgets('versión no soportada (client_supported: false) → incompatible con la versión mínima', (tester) async {
    await start(tester, [_Reply(200, compatibility(supported: false))]);
    await tester.pumpAndSettle();
    expect(status(tester), 'Versión no soportada: actualiza la app');
    expect(detail(tester), startsWith('Versión mínima soportada: 0.'));
    expect(find.text('Reintentar'), findsNothing);
  });

  testWidgets('sin red → no disponible; "Reintentar" repite la consulta real', (tester) async {
    final server = await start(tester, [const _Reply.networkError(), _Reply(200, compatibility())]);
    await tester.pumpAndSettle();
    expect(status(tester), 'Kuota Core no disponible');
    expect(detail(tester), ApiFailureCodes.network);
    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();
    expect(status(tester), 'Compatible con Kuota Core');
    expect(server.requests, hasLength(2));
  });

  testWidgets('error del servidor (problem+json internal-error) → respuesta inesperada', (tester) async {
    await start(tester, [
      const _Reply(500, {'type': 'x', 'title': 'Error interno', 'status': 500, 'code': 'internal-error'}),
    ]);
    await tester.pumpAndSettle();
    expect(status(tester), 'Respuesta inesperada de Kuota Core');
    expect(detail(tester), 'internal-error');
  });

  testWidgets('compatibilidad indeterminada (sin client_supported) → nunca compatible', (tester) async {
    await start(tester, [_Reply(200, compatibility(supported: null))]);
    await tester.pumpAndSettle();
    expect(status(tester), 'Respuesta inesperada de Kuota Core');
  });

  testWidgets('configuración inválida → sin consulta HTTP y estado de configuración', (tester) async {
    final server = await start(
      tester,
      [],
      config: const Err(Failure('config-invalid', message: 'KUOTA_API_BASE_URL: obligatorio')),
    );
    await tester.pumpAndSettle();
    expect(status(tester), 'Configuración del entorno inválida');
    expect(find.text('Entorno: sin configurar'), findsOneWidget);
    expect(server.requests, isEmpty);
  });
}

final class _Reply {
  const _Reply(this.status, this.body, {this.wait});
  const _Reply.networkError() : status = -1, body = null, wait = null;

  final int status;
  final Object? body;
  final Future<void>? wait;
}

/// Servidor falso: registra las solicitudes reales que envía dio y responde con la siguiente respuesta programada.
final class _Server implements HttpClientAdapter {
  _Server(List<_Reply> replies) : _replies = List.of(replies);

  final List<_Reply> _replies;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final reply = _replies.removeAt(0);
    await reply.wait;
    if (reply.status < 0) throw DioException.connectionError(requestOptions: options, reason: 'sin conexión (prueba)');
    final type = reply.status >= 400 ? 'application/problem+json' : 'application/json';
    return ResponseBody.fromString(
      jsonEncode(reply.body),
      reply.status,
      headers: {
        Headers.contentTypeHeader: [type],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
