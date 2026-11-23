import 'dart:convert';
import 'dart:io';

import 'package:shared_core/shared_core.dart';
import 'package:test/test.dart';

/// T081: `AppConfig` por entorno. Las reglas se prueban con `fromValues`; la lectura real de `--dart-define` se prueba
/// en un proceso aparte (`test/support/print_config.dart`), compilado con los valores, igual que una app.
void main() {
  Map<String, String> values(String env, String url) => {AppConfig.environmentKey: env, AppConfig.apiBaseUrlKey: url};

  group('AppConfig.tryFromValues / tryFromEnvironment', () {
    test('válida → Ok con la misma configuración que fromValues', () {
      final result = AppConfig.tryFromValues(values('local', 'http://localhost:3000'));
      expect(result, isA<Ok<AppConfig>>());
      expect((result as Ok<AppConfig>).value.apiBaseUrl, Uri.parse('http://localhost:3000'));
    });

    test('inválida → Err config-invalid con campo y motivo, sin el valor recibido', () {
      final result = AppConfig.tryFromValues(values('qa', 'http://secreto.example'));
      expect(result, isA<Err<AppConfig>>());
      final failure = (result as Err<AppConfig>).failure;
      expect(failure.code, AppConfig.invalidFailureCode);
      expect(failure.message, startsWith('${AppConfig.environmentKey}:'));
      expect(failure.message, isNot(contains('qa')));
      expect(AppConfig.tryFromValues(values('staging', '')), isA<Err<AppConfig>>());
    });

    test('sin --dart-define (como en las pruebas) tryFromEnvironment no lanza: devuelve Err', () {
      expect(AppConfig.tryFromEnvironment(), isA<Err<AppConfig>>());
    });
  });

  group('AppConfig.fromValues', () {
    test('acepta los cuatro entornos con su URL', () {
      for (final env in KuotaEnvironment.values) {
        final config = AppConfig.fromValues(values(env.name, 'https://api.kuota.example/'));
        expect(config.environment, env);
        expect(config.apiBaseUrl, Uri.parse('https://api.kuota.example/'));
      }
    });

    test('http solo en local y testing; staging y production exigen https', () {
      expect(AppConfig.fromValues(values('local', 'http://127.0.0.1:3000')).apiBaseUrl.port, 3000);
      expect(AppConfig.fromValues(values('testing', 'http://10.0.2.2:3000')).environment, KuotaEnvironment.testing);
      for (final env in ['staging', 'production']) {
        expect(
          () => AppConfig.fromValues(values(env, 'http://api.kuota.example')),
          throwsA(isA<AppConfigError>().having((e) => e.field, 'field', AppConfig.apiBaseUrlKey)),
        );
      }
    });

    test('rechaza entorno ausente o desconocido sin reflejar el valor', () {
      expect(
        () => AppConfig.fromValues({AppConfig.apiBaseUrlKey: 'https://a.example'}),
        throwsA(isA<AppConfigError>().having((e) => e.reason, 'reason', 'obligatorio')),
      );
      final error = _error(() => AppConfig.fromValues(values('produccion-secreta', 'https://a.example')));
      expect(error.field, AppConfig.environmentKey);
      expect(error.toString(), isNot(contains('produccion-secreta')));
    });

    test('rechaza URLs relativas, sin host, de otro esquema, con credenciales, query o fragmento', () {
      const invalid = [
        '',
        '/v1',
        'api.kuota.example',
        'ftp://api.kuota.example',
        'https://usuario:clave-secreta@api.kuota.example',
        'https://api.kuota.example/?token=abc',
        'https://api.kuota.example/#x',
        'https://',
      ];
      for (final url in invalid) {
        final error = _error(() => AppConfig.fromValues(values('local', url)));
        expect(error.field, AppConfig.apiBaseUrlKey, reason: url);
        expect(error.toString(), isNot(contains('clave-secreta')));
      }
    });

    test('sin --dart-define, fromEnvironment falla: no hay valores por defecto inventados', () {
      expect(AppConfig.fromEnvironment, throwsA(isA<AppConfigError>()));
    });
  });

  test('fromEnvironment lee los valores inyectados en compilación (--define, como --dart-define-from-file)', () async {
    final result = await Process.run(Platform.resolvedExecutable, [
      'run',
      '--define=KUOTA_ENV=staging',
      '--define=KUOTA_API_BASE_URL=https://api.staging.kuota.example',
      'test/support/print_config.dart',
    ]);
    expect(result.exitCode, 0, reason: '${result.stderr}');
    final json = jsonDecode((result.stdout as String).trim()) as Map<String, Object?>;
    expect(json, {'environment': 'staging', 'apiBaseUrl': 'https://api.staging.kuota.example'});
  });
}

AppConfigError _error(void Function() action) {
  try {
    action();
  } on AppConfigError catch (error) {
    return error;
  }
  fail('se esperaba AppConfigError');
}
