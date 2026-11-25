import 'dart:convert';

import 'package:decimal/decimal.dart';
import 'package:financial_domain/financial_domain.dart';
import 'package:test/test.dart';

/// T059 (ADR-0007; R-09): ejecuta TODOS los casos de `contracts/fixtures/money/*.json` con el Money de Dart, compara el
/// catálogo con `currencies.json` y prueba Money → JSON → Money con los mismos casos y rechazos que el runner de
/// TypeScript (T057, `backend/test/unit/money/fixtures.spec.ts`). Se ejecuta en la VM y en Chrome (`dart_test.yaml`):
/// como los tres runners comparan con los mismos valores esperados, TypeScript, Dart VM y Flutter Web producen
/// resultados idénticos. Los montos se leen y se escriben como String y `BigInt`, nunca como `int`, `double` ni `num`.
///
/// Los archivos se leen en un isolate híbrido de la VM (`spawnHybridCode`), porque en el navegador no hay `dart:io`.
const _fixturesDir = '../../../contracts/fixtures/money';
const _nonFixtureFiles = {'fixture.schema.json', 'currencies.json'};

const _loader =
    '''
import 'dart:io';
import 'package:stream_channel/stream_channel.dart';

void hybridMain(StreamChannel<Object?> channel) {
  final files = <String, String>{};
  for (final entity in Directory('$_fixturesDir').listSync()) {
    if (entity is File && entity.path.endsWith('.json')) {
      files[entity.uri.pathSegments.last] = entity.readAsStringSync();
    }
  }
  channel.sink.add(files);
  channel.sink.close();
}
''';

typedef _Json = Map<String, Object?>;

Future<Map<String, String>> _loadFiles() async {
  final channel = spawnHybridCode(_loader);
  final files = (await channel.stream.first as Map<Object?, Object?>).cast<String, String>();
  return files;
}

Money _money(Object? json) {
  final m = json! as _Json;
  return Money.of(BigInt.parse(m['amount_minor']! as String), m['currency']! as String);
}

/// Ejecuta un caso (misma correspondencia operación → API que el runner de TypeScript).
Object _run(_Json c) {
  final inputs = c['inputs']! as _Json;
  final rounding = c['rounding'] == null ? null : RoundingMode.fromCode(c['rounding']! as String);
  switch (c['operation']) {
    case 'add':
      return _money(inputs['a']).add(_money(inputs['b']));
    case 'subtract':
      return _money(inputs['a']).subtract(_money(inputs['b']));
    case 'multiply':
      return _money(inputs['a']).multiply(Decimal.parse(inputs['factor']! as String), rounding);
    case 'allocate':
      final parts = inputs['parts'];
      return parts != null
          ? _money(inputs['a']).allocate(parts as int)
          : _money(inputs['a']).allocateRatios((inputs['ratios']! as List<Object?>).cast<int>());
    case 'parse':
      // Convención de los fixtures (research R-08): la moneda viaja en inputs.a.currency; su amount_minor se ignora.
      return Money.parse(inputs['text']! as String, (inputs['a']! as _Json)['currency']! as String);
    case 'format':
      return _money(inputs['a']).format();
    case 'from_json':
      return Money.fromJson(inputs['json']);
  }
  throw ArgumentError.value(c['operation'], 'operation', 'operación desconocida');
}

/// Resultado canónico comparable con `expected` (JSON) o `error:<CÓDIGO>`.
Object? _outcome(_Json c) {
  try {
    final result = _run(c);
    if (result is String) return result;
    if (result is Money) return result.toJson();
    return [for (final m in result as List<Money>) m.toJson()];
  } on MoneyError catch (error) {
    return 'error:${error.code}';
  }
}

void main() {
  late Map<String, String> files;
  late List<_Json> cases;

  setUpAll(() async {
    files = await _loadFiles();
    cases = [
      for (final name in files.keys.where((f) => !_nonFixtureFiles.contains(f)).toList()..sort())
        ...((jsonDecode(files[name]!) as _Json)['cases']! as List<Object?>).cast<_Json>(),
    ];
  });

  test('hay archivos de fixtures, con identificadores únicos y las operaciones y errores de ADR-0007', () {
    expect(files.keys.where((f) => !_nonFixtureFiles.contains(f)), isNotEmpty);
    expect(files.keys, containsAll(_nonFixtureFiles));
    final ids = [for (final c in cases) c['id']];
    expect(ids.toSet(), hasLength(ids.length));
    expect(
      {for (final c in cases) c['operation']},
      {'add', 'subtract', 'multiply', 'allocate', 'parse', 'format', 'from_json'},
    );
    expect({for (final c in cases) c['expected_error']}..remove(null), {
      for (final code in MoneyErrorCode.values) code.code,
    });
  });

  test('todos los casos producen exactamente el resultado o el error esperado', () {
    final mismatches = <String>[];
    for (final c in cases) {
      final expected = c.containsKey('expected_error') ? 'error:${c['expected_error']}' : c['expected'];
      final actual = _outcome(c);
      if (jsonEncode(actual) != jsonEncode(expected)) {
        mismatches.add('${c['id']}: esperado ${jsonEncode(expected)}, obtenido ${jsonEncode(actual)}');
      }
    }
    expect(mismatches, isEmpty, reason: '${mismatches.length} de ${cases.length} casos difieren');
    expect(cases.length, greaterThan(0));
  });

  test('el catálogo del código coincide con contracts/fixtures/money/currencies.json', () {
    final reference = ((jsonDecode(files['currencies.json']!) as _Json)['currencies']! as List<Object?>).cast<_Json>();
    final fromCode = [
      for (final code in moneyCurrencies.keys.toList()..sort()) {'code': code, 'minor_units': moneyCurrencies[code]},
    ];
    expect(jsonEncode(fromCode), jsonEncode(reference));
  });

  test('todo monto válido de los fixtures hace ida y vuelta Money → JSON → Money idéntica, como String', () {
    final valid = <_Json>[];
    for (final c in cases) {
      final inputs = c['inputs']! as _Json;
      final expected = c['expected'];
      for (final m in [inputs['a'], inputs['b'], if (expected is List) ...expected, if (expected is Map) expected]) {
        if (m == null) continue;
        try {
          _money(m);
          valid.add(m as _Json);
        } on MoneyError {
          // fuera de dominio o moneda no soportada: no es un monto válido
        }
      }
    }
    final amounts = {for (final m in valid) m['amount_minor']};
    expect(amounts, containsAll(['0', '-9223372036854775807', '9223372036854775807', '9007199254740993']));
    expect(amounts.any((a) => (a! as String).startsWith('-')), isTrue);
    for (final m in valid) {
      final text = jsonEncode(_money(m).toJson());
      expect(text, jsonEncode({'amount_minor': m['amount_minor'], 'currency': m['currency']}));
      final back = Money.fromJson(jsonDecode(text));
      expect(back.amountMinor, BigInt.parse(m['amount_minor']! as String));
      expect(back.amountMinor.toString(), m['amount_minor']);
      expect(back.currency, m['currency']);
      expect(back, _money(m));
    }
  });

  test('los from_json inválidos de los fixtures se rechazan con su código (sin pasar por int, double ni num)', () {
    final invalid = [
      for (final c in cases)
        if (c['operation'] == 'from_json' && c.containsKey('expected_error')) c,
    ];
    expect(invalid, isNotEmpty);
    for (final c in invalid) {
      expect(_outcome(c), 'error:${c['expected_error']}', reason: c['id'] as String);
    }
    // Un número JSON en lugar de String nunca se acepta, ni siquiera si su valor sería válido.
    expect(
      () => Money.fromJson({'amount_minor': 1, 'currency': 'MXN'}),
      throwsA(isA<MoneyError>().having((e) => e.code, 'code', 'INVALID_AMOUNT')),
    );
  });
}
