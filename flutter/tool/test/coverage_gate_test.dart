import 'package:test/test.dart';

import '../coverage_gate.dart';

/// C1 (Constitución X): el gate de cobertura cuenta líneas y ramas del código propio de `lib/`, informa aparte el código
/// generado y nunca deja fuera del denominador un archivo con código que ninguna prueba carga.
void main() {
  const pkg = '/ws/packages/demo';
  const money = 'class A {\n  int f(int x) => x > 0 ? x : -x;\n}\n';

  String lcov(String path, List<(int, int)> da, [List<(int, int, int, String)> brda = const []]) => [
    'SF:$path',
    for (final (line, hits) in da) 'DA:$line,$hits',
    for (final (line, block, branch, taken) in brda) 'BRDA:$line,$block,$branch,$taken',
    'end_of_record',
  ].join('\n');

  test('cuenta líneas y ramas, con rutas absolutas o relativas al paquete', () {
    final report = [
      lcov('$pkg/lib/src/a.dart', [(1, 3), (2, 0), (3, 1), (4, 1)], [(2, 0, 0, '1'), (2, 0, 1, '-')]),
      lcov('lib/src/b.dart', [(1, 1)]),
    ].join('\n');
    final result = evaluate(pkg, report, {'lib/src/a.dart': money, 'lib/src/b.dart': money});
    expect(result.own.lines, 5);
    expect(result.own.linesHit, 4);
    expect(result.own.branches, 2);
    expect(result.own.branchesHit, 1);
    expect(result.own.linePercent, 80);
    expect(result.own.branchPercent, 50);
    expect(result.notLoaded, isEmpty);
    expect(result.files, 2);
  });

  test('una línea o rama repetida (varios aislados de prueba) se cuenta una vez, con el máximo de impactos', () {
    final report = [
      lcov('$pkg/lib/a.dart', [(1, 0)], [(1, 0, 0, '-')]),
      lcov('$pkg/lib/a.dart', [(1, 2)], [(1, 0, 0, '4')]),
    ].join('\n');
    final result = evaluate(pkg, report, {'lib/a.dart': money});
    expect(result.own.lines, 1);
    expect(result.own.linesHit, 1);
    expect(result.own.branches, 1);
    expect(result.own.branchesHit, 1);
  });

  test('el código generado se informa aparte y no entra en el umbral; otros paquetes y test/ se ignoran', () {
    final report = [
      lcov('$pkg/lib/src/own.dart', [(1, 1)]),
      lcov('$pkg/lib/src/generated/model.g.dart', [(1, 0), (2, 0)]),
      lcov('/ws/packages/otro/lib/x.dart', [(1, 0)]),
      lcov('$pkg/test/helper.dart', [(1, 0)]),
    ].join('\n');
    final result = evaluate(pkg, report, {'lib/src/own.dart': money, 'lib/src/generated/model.g.dart': money});
    expect(result.own.lines, 1);
    expect(result.own.linePercent, 100);
    expect(result.generated.lines, 2);
    expect(result.generated.linesHit, 0);
  });

  test(
    'un archivo de lib/ con código que ninguna prueba carga queda señalado (no sale del denominador en silencio)',
    () {
      final result = evaluate(pkg, lcov('$pkg/lib/a.dart', [(1, 1)]), {
        'lib/a.dart': money,
        'lib/sin_pruebas.dart': money,
        'lib/barril.dart': "/// Exporta todo.\nlibrary;\n\nexport 'a.dart' show A;\n",
        'lib/src/generated/x.dart': money,
      });
      expect(result.notLoaded, ['lib/sin_pruebas.dart']);
    },
  );

  test('un informe sin archivos de lib/ del paquete o con BRDA mal formado es una entrada inválida', () {
    expect(() => evaluate(pkg, lcov('/ws/packages/otro/lib/x.dart', [(1, 1)]), {}), throwsA(isA<CoverageGateError>()));
    expect(
      () => evaluate(pkg, 'SF:$pkg/lib/a.dart\nBRDA:1,0\nend_of_record', {'lib/a.dart': money}),
      throwsA(isA<CoverageGateError>()),
    );
  });

  test('hasExecutableCode distingue código de comentarios y directivas', () {
    expect(hasExecutableCode(money), isTrue);
    expect(
      hasExecutableCode("// solo\n/* bloque */\nlibrary;\nimport 'a.dart';\nexport 'b.dart' show B, C;\n"),
      isFalse,
    );
    expect(hasExecutableCode("part of 'x.dart';\nconst a = 1;\n"), isTrue);
  });

  test('sin líneas instrumentadas el porcentaje es 100 (no divide por cero)', () {
    final t = Tally();
    expect(t.linePercent, 100);
    expect(t.branchPercent, 100);
  });
}
