import 'dart:convert';

import 'package:test/test.dart';

import '../osv_coverage.dart';

/// T050: la cobertura del escaneo Dart exige que cada paquete alojado del lockfile esté en el informe de osv-scanner.
void main() {
  const lock = '''
packages:
  dio:
    dependency: direct main
    source: hosted
    version: "5.11.1"
  yaml:
    dependency: direct dev
    source: hosted
    version: "3.1.4"
  flutter:
    dependency: direct main
    source: sdk
    version: "0.0.0"
''';
  String report(List<(String, String, String)> packages) => jsonEncode({
    'results': [
      {
        'packages': [
          for (final (name, version, ecosystem) in packages)
            {
              'package': {'name': name, 'version': version, 'ecosystem': ecosystem},
              'vulnerabilities': <Object>[],
              'groups': <Object>[],
            },
        ],
      },
    ],
  });

  test('cobertura completa: todos los alojados escaneados; los del SDK se informan aparte', () {
    final coverage = checkCoverage(lock, report([('dio', '5.11.1', 'Pub'), ('yaml', '3.1.4', 'Pub')]));
    expect(coverage.expected, {'dio@5.11.1', 'yaml@3.1.4'});
    expect(coverage.missing, isEmpty);
    expect(coverage.sdk, {'flutter'});
  });

  test('un paquete sin escanear, otra versión u otro ecosistema cuentan como faltantes', () {
    expect(checkCoverage(lock, report([('dio', '5.11.1', 'Pub')])).missing, {'yaml@3.1.4'});
    expect(checkCoverage(lock, report([('dio', '5.0.0', 'Pub'), ('yaml', '3.1.4', 'Pub')])).missing, {'dio@5.11.1'});
    expect(checkCoverage(lock, report([('dio', '5.11.1', 'npm'), ('yaml', '3.1.4', 'Pub')])).missing, {'dio@5.11.1'});
  });

  test('informe vacío (osv-scanner no leyó el lockfile) → todos faltan, nunca aprobado', () {
    expect(checkCoverage(lock, jsonEncode({'results': <Object>[]})).missing, {'dio@5.11.1', 'yaml@3.1.4'});
  });

  test('entradas inválidas → CoverageError', () {
    for (final (l, r) in [
      (lock, '{no json'),
      (lock, '{}'),
      ('no: [un: lock', report([])),
      ('packages: 3', report([])),
    ]) {
      expect(() => checkCoverage(l, r), throwsA(isA<CoverageError>()));
    }
  });
}
