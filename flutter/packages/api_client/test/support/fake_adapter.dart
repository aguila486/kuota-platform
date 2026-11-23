import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Respuesta programada del servidor falso.
final class FakeReply {
  const FakeReply(this.status, this.body, {this.contentType = 'application/json; charset=utf-8'});

  /// Simula un fallo de red (sin respuesta del servidor).
  const FakeReply.networkError() : status = -1, body = null, contentType = '';

  final int status;
  final Object? body;
  final String contentType;
}

/// `HttpClientAdapter` en memoria: registra cada solicitud que Dio envía de verdad (método, URL y cabeceras finales,
/// después de los interceptores) y responde con la siguiente [FakeReply] de la cola.
final class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(List<FakeReply> replies) : _replies = List.of(replies);

  final List<FakeReply> _replies;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final reply = _replies.removeAt(0);
    if (reply.status < 0) {
      throw DioException.connectionError(requestOptions: options, reason: 'servidor falso: sin conexión');
    }
    final text = reply.body is String ? reply.body! as String : jsonEncode(reply.body);
    return ResponseBody.fromString(
      text,
      reply.status,
      headers: {
        Headers.contentTypeHeader: [reply.contentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
