import 'dart:convert';

import 'package:shared_core/shared_core.dart';
import 'package:test/test.dart';

/// T081: logger sin PII. Se comprueba lo que realmente llega al destino (el registro saneado y su JSON). Valores
/// ficticios.
void main() {
  final records = <LogRecord>[];
  KuotaLogger logger({LogLevel minLevel = LogLevel.info}) =>
      KuotaLogger('prueba', sink: records.add, clock: () => DateTime.utc(2026, 11, 23, 12), minLevel: minLevel);
  setUp(records.clear);

  test('enmascara correos, teléfonos, Bearer y clave=valor en el mensaje', () {
    logger().info(
      'cliente persona.ficticia@example.invalid tel +52 55 1234 5678 Bearer FICTICIO.TOKEN password=FICTICIA api_key=FICTICIA',
    );
    final message = records.single.message;
    for (final leak in ['persona.ficticia', '1234 5678', 'FICTICIO.TOKEN', 'password=FICTICIA', 'api_key=FICTICIA']) {
      expect(message, isNot(contains(leak)));
    }
    expect(message, contains('[REDACTED:email]'));
    expect(message, contains('[REDACTED:phone]'));
    expect(message, contains('Bearer [REDACTED]'));
  });

  test('redacta claves sensibles a cualquier profundidad y no confunde un UUID con un teléfono', () {
    logger().info('evento', {
      'correlation_id': '0193b6f0-0000-7000-8000-000000000001',
      'Authorization': 'Bearer x',
      'datos': {
        'email': 'a@b.example',
        'lista': [
          {'token': 'FICTICIO'},
          'llamar al 5512345678',
        ],
      },
    });
    final fields = records.single.fields;
    expect(fields['correlation_id'], '0193b6f0-0000-7000-8000-000000000001');
    expect(fields['Authorization'], redacted);
    final datos = fields['datos']! as Map<String, Object?>;
    expect(datos['email'], redacted);
    final lista = datos['lista']! as List<Object?>;
    expect(lista[0], {'token': redacted});
    expect(lista[1], 'llamar al [REDACTED:phone]');
  });

  test('objetos arbitrarios se registran solo por su tipo; BigInt y fechas sin pérdida', () {
    logger().info('tipos', {
      'objeto': _ConDatos(),
      'monto_minor': BigInt.parse('9223372036854775807'),
      'cuando': DateTime.utc(2026, 1, 2),
      'duracion_ms': 12.5,
      'intentos': 3,
      'activo': true,
      'nulo': null,
    });
    final fields = records.single.fields;
    expect(fields['objeto'], '[_ConDatos]');
    expect(fields['monto_minor'], '9223372036854775807');
    expect(fields['cuando'], '2026-01-02T00:00:00.000Z');
    expect(fields['duracion_ms'], 12.5);
    expect(fields['intentos'], 3);
    expect(fields['activo'], true);
    expect(fields['nulo'], isNull);
    expect(jsonEncode(records.single.toJson()), isNot(contains('secreto-interno')));
  });

  test('respeta el nivel mínimo y produce JSON con level, time, logger y msg', () {
    logger(minLevel: LogLevel.warning)
      ..info('no se registra')
      ..warning('sí');
    expect(records, hasLength(1));
    expect(records.single.toJson(), {
      'level': 'warning',
      'time': '2026-11-23T12:00:00.000Z',
      'logger': 'prueba',
      'msg': 'sí',
    });
  });

  test('la profundidad está acotada', () {
    Object? nested = 'fondo';
    for (var i = 0; i < 20; i++) {
      nested = {'n': nested};
    }
    logger().info('profundo', {'x': nested});
    expect(jsonEncode(records.single.fields), contains('[TRUNCATED]'));
  });

  test('el destino por defecto (dart:developer) acepta registros sin fallar', () {
    expect(() => KuotaLogger('defecto').error('sin destino propio', {'k': 'v'}), returnsNormally);
  });
}

final class _ConDatos {
  final secreto = 'secreto-interno';
  @override
  String toString() => secreto;
}
