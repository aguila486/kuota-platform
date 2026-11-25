import 'dart:io';

import 'package:api_client/api_client.dart';
import 'package:api_client/src/generated/generated.dart' as generated;
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// T070 (FR-040; R-12; ADR-0007): el código generado corresponde exactamente a las operaciones PÚBLICAS del contrato
/// fuente y no contiene nada técnico (dev-probe). Las rutas esperadas se calculan del contrato del repositorio, no de
/// una lista escrita en la prueba.
void main() {
  final contractDir = Directory('../../../contracts/openapi');
  final generatedDir = Directory('lib/src/generated');
  String readAll(Directory dir) => [
    for (final file in dir.listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart')))
      file.readAsStringSync(),
  ].join('\n');

  /// Rutas del contrato fuente cuyo path item no está marcado `x-kuota-non-production: true`.
  Set<String> publicContractPaths() {
    final root = loadYaml(File('${contractDir.path}/kuota-core.v1.yaml').readAsStringSync()) as YamlMap;
    final result = <String>{};
    for (final MapEntry(:key, :value) in (root['paths'] as YamlMap).entries) {
      final item = value is YamlMap && value[r'$ref'] is String
          ? loadYaml(File('${contractDir.path}/${value[r'$ref']}').readAsStringSync()) as YamlMap
          : value as YamlMap;
      if (item['x-kuota-non-production'] != true) result.add('$key');
    }
    return result;
  }

  test('las operaciones generadas son exactamente las rutas públicas del contrato', () {
    final generatedPaths = RegExp(r"final _path = r'([^']+)'")
        .allMatches(readAll(Directory('${generatedDir.path}/api')))
        .map((m) => m.group(1)!)
        .toSet();
    expect(publicContractPaths(), isNotEmpty);
    expect(generatedPaths, publicContractPaths());
  });

  test('el contrato fuente sí tiene rutas técnicas, y ninguna llega al cliente generado (dev-probe)', () {
    final root = loadYaml(File('${contractDir.path}/kuota-core.v1.yaml').readAsStringSync()) as YamlMap;
    final allPaths = (root['paths'] as YamlMap).keys.cast<String>().toSet();
    final technical = allPaths.difference(publicContractPaths());
    expect(technical, isNotEmpty, reason: 'la prueba no probaría nada sin rutas técnicas en el contrato');
    final source = readAll(generatedDir).toLowerCase();
    for (final path in technical) {
      expect(source, isNot(contains(path.toLowerCase())), reason: path);
    }
    for (final leak in ['devprobe', 'dev_probe', 'devtenantcontext', 'x-kuota-dev']) {
      expect(source, isNot(contains(leak)), reason: leak);
    }
  });

  test('el ApiClient generado solo expone las APIs públicas (Health y Meta)', () {
    final api = generated.ApiClient();
    expect(api.getMetaApi(), isA<generated.MetaApi>());
    expect(api.getHealthApi(), isA<generated.HealthApi>());
    final apiSource = File('${generatedDir.path}/api.dart').readAsStringSync();
    expect(RegExp(r'\w+Api get\w+Api\(').allMatches(apiSource).map((m) => m.group(0)).toSet(), {
      'HealthApi getHealthApi(',
      'MetaApi getMetaApi(',
    });
  });

  test('ningún modelo generado usa double ni num (dinero exacto, ADR-0007)', () {
    final models = readAll(Directory('${generatedDir.path}/model'));
    expect(RegExp(r'\b(double|num)\??\s+get\s').hasMatch(models), isFalse);
  });

  test('Money no forma parte del cliente distribuible: ninguna operación pública lo usa todavía', () {
    // remove-unused-components lo elimina del bundle de cliente; cuando una operación pública use Money, el generador lo
    // emitirá con `amountMinor` como String (comprobado en el spike T069, research.md R-12).
    expect(File('${generatedDir.path}/model/money.dart').existsSync(), isFalse);
  });

  test('serialización del DTO de compatibilidad: ida y vuelta con los serializadores generados', () {
    final serializers = generated.standardSerializers;
    final json = {
      'api_version': '1.0.0',
      'min_supported': {'admin': '0.1.0', 'collector': '1.2.0', 'client': '0.3.0'},
      'server_time': '2026-11-23T15:04:05.123Z',
    };
    final info = serializers.deserializeWith(CompatibilityInfo.serializer, json)!;
    expect(info.serverTime.isUtc, isTrue);
    final back = serializers.serializeWith(CompatibilityInfo.serializer, info)! as Map<String, Object?>;
    expect(back['api_version'], '1.0.0');
    expect(back['min_supported'], json['min_supported']);
    expect(DateTime.parse(back['server_time']! as String), DateTime.utc(2026, 11, 23, 15, 4, 5, 123));
    expect(back.containsKey('client_supported'), isFalse);
  });
}
