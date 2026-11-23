import 'dart:io';

import 'package:decimal/decimal.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// T082: el paquete existe con las restricciones que exige su tarea, para que T063 pueda implementar `Money` sin
/// cambiar la estructura. No prueba `Money` (T063) ni los fixtures compartidos (T059): todavía no existen.
void main() {
  final pubspec = loadYaml(File('pubspec.yaml').readAsStringSync()) as YamlMap;

  test('Dart puro: no depende de flutter ni de flutter_test', () {
    for (final section in ['dependencies', 'dev_dependencies']) {
      final deps = (pubspec[section] as YamlMap?)?.keys.cast<String>() ?? const <String>[];
      expect(deps, isNot(contains('flutter')), reason: section);
      expect(deps, isNot(contains('flutter_test')), reason: section);
    }
  });

  test('miembro del workspace con la dependencia decimal 3.x fijada (ADR-0007, R-08)', () {
    expect(pubspec['resolution'], 'workspace');
    final decimal = (pubspec['dependencies'] as YamlMap)['decimal'] as String;
    expect(decimal, matches(RegExp(r'^3\.\d+\.\d+$')));
  });

  test('existe la estructura lib/src/money/ reservada para T063', () {
    expect(Directory('lib/src/money').existsSync(), isTrue);
  });

  test('decimal resuelve en el workspace y es exacto (base de los factores de multiply en T063)', () {
    expect(Decimal.parse('0.1') + Decimal.parse('0.2'), Decimal.parse('0.3'));
    // Un factor decimal se representa como fracción exacta de BigInt, sin pasar por double.
    final factor = Decimal.parse('1.0825');
    expect(factor.toRational().numerator, BigInt.from(433));
    expect(factor.toRational().denominator, BigInt.from(400));
    // Montos mayores que 2^53 se mantienen exactos.
    final big = BigInt.parse('9223372036854775807');
    expect((Decimal.fromBigInt(big) * Decimal.one).toBigInt(), big);
  });
}
