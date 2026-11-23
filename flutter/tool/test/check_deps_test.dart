import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:test/test.dart';

import '../check_deps.dart';

/// T084 (US7-4, FR-033): `tool/check_deps.dart` falla con el pubspec defectuoso de referencia y con cada regla, y
/// aprueba el workspace real. Los workspaces de prueba se crean en un directorio temporal.
void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('check_deps_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  /// Workspace temporal con miembros `apps/*` y `packages/*`; cada entrada es `ruta → pubspec` (sin `name`, se añade).
  Directory workspace(Map<String, String> members, {List<String>? listed, Map<String, String> files = const {}}) {
    File(p.join(tmp.path, 'pubspec.yaml')).writeAsStringSync(
      'name: ws\nenvironment:\n  sdk: ^3.14.0\nworkspace:\n${(listed ?? members.keys).map((m) => '  - $m').join('\n')}\n',
    );
    for (final MapEntry(key: path, value: body) in members.entries) {
      final file = File(p.join(tmp.path, path, 'pubspec.yaml'))..createSync(recursive: true);
      final hasName = RegExp(r'^name:', multiLine: true).hasMatch(body);
      file.writeAsStringSync(hasName ? body : 'name: ${p.basename(path)}\n$body');
    }
    for (final MapEntry(key: path, value: body) in files.entries) {
      (File(p.join(tmp.path, path))..createSync(recursive: true)).writeAsStringSync(body);
    }
    return tmp;
  }

  const clean = {
    'apps/admin_web':
        'dependencies:\n  shared_core:\n    path: ../../packages/shared_core\n  flutter:\n    sdk: flutter\n',
    'apps/client_mobile': 'dependencies:\n  design_system:\n    path: ../../packages/design_system\n',
    'packages/shared_core': 'dev_dependencies:\n  test: any\n',
    'packages/financial_domain': 'dependencies:\n  decimal: any\n',
    'packages/design_system': 'dependencies:\n  flutter:\n    sdk: flutter\n',
  };

  test('el workspace real de Kuota cumple las reglas', () {
    expect(checkWorkspace(Directory.current), isEmpty);
  });

  test('workspace limpio con apps y paquetes: sin violaciones', () {
    expect(checkWorkspace(workspace(clean)), isEmpty);
  });

  test('pubspec defectuoso de referencia: una app depende de otra app → falla', () {
    final reference = File('tool/test/fixtures/app_depends_on_app.pubspec.yaml').readAsStringSync();
    final violations = checkWorkspace(workspace({...clean, 'apps/collector_mobile': reference}));
    expect(violations.map((v) => v.rule), contains(Rule.appDependsOnApp));
    expect(violations.map((v) => '$v'), contains(contains('apps/collector_mobile')));
    expect(violations.map((v) => '$v'), contains(contains('client_mobile')));
  });

  test('un paquete que depende de una app → falla (por nombre y por path)', () {
    final byName = checkWorkspace(workspace({...clean, 'packages/design_system': 'dependencies:\n  admin_web: any\n'}));
    expect(byName.single.rule, Rule.packageDependsOnApp);
    tmp.deleteSync(recursive: true);
    tmp = Directory.systemTemp.createTempSync('check_deps_');
    final byPath = checkWorkspace(
      workspace({...clean, 'packages/shared_core': 'dev_dependencies:\n  otra:\n    path: ../../apps/admin_web\n'}),
    );
    expect(byPath.single.rule, Rule.packageDependsOnApp);
  });

  test('financial_domain o shared_core con Flutter → falla (dependencies, dev_dependencies o sdk: flutter)', () {
    final violations = checkWorkspace(
      workspace({
        ...clean,
        'packages/financial_domain':
            'dependencies:\n  decimal: any\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
        'packages/shared_core': 'dependencies:\n  ui:\n    sdk: flutter\n',
      }),
    );
    expect(violations.map((v) => v.rule).toSet(), {Rule.pureDartDependsOnFlutter});
    expect(violations.map((v) => v.member).toSet(), {'packages/financial_domain', 'packages/shared_core'});
  });

  test('importar código de otra app SIN declararlo (resolución compartida del workspace) → falla', () {
    final violations = checkWorkspace(
      workspace(
        clean,
        files: {
          'apps/client_mobile/lib/main.dart': "import 'package:admin_web/src/secreto.dart';\n",
          'apps/admin_web/lib/x.dart': "export '../../client_mobile/lib/main.dart';\n",
          'packages/shared_core/lib/y.dart': "import 'package:flutter/widgets.dart';\n",
        },
      ),
    );
    final text = violations.map((v) => '$v').join('\n');
    expect(text, contains('apps/client_mobile: apps/client_mobile/lib/main.dart importa la app admin_web'));
    expect(text, contains('apps/admin_web: apps/admin_web/lib/x.dart importa por ruta relativa la app client_mobile'));
    expect(violations.where((v) => v.rule == Rule.appDependsOnApp), hasLength(2));
    expect(violations.where((v) => v.rule == Rule.pureDartDependsOnFlutter), hasLength(1));
  });

  test('un miembro que falta en `workspace:` también se revisa', () {
    final violations = checkWorkspace(
      workspace({
        ...clean,
        'apps/collector_mobile': 'dependencies:\n  client_mobile: any\n',
      }, listed: clean.keys.toList()),
    );
    expect(violations.single.member, 'apps/collector_mobile');
  });

  test('importar el propio paquete o paquetes compartidos está permitido', () {
    final violations = checkWorkspace(
      workspace(
        clean,
        files: {
          'apps/admin_web/lib/main.dart': "import 'package:admin_web/src/a.dart';\nimport 'package:shared_core/shared_core.dart';\nimport 'src/b.dart';\n",
        },
      ),
    );
    expect(violations, isEmpty);
  });

  test('un pubspec con YAML inválido → WorkspaceError (salida 2), nunca una excepción no controlada', () {
    final broken = workspace({...clean, 'apps/admin_web': 'dependencies:\n  a: 1\n  a: 2\n'});
    expect(() => checkWorkspace(broken), throwsA(isA<WorkspaceError>()));
  });

  test('raíz sin workspace → WorkspaceError', () {
    File(p.join(tmp.path, 'pubspec.yaml')).writeAsStringSync('name: suelto\n');
    expect(() => checkWorkspace(tmp), throwsA(isA<WorkspaceError>()));
  });

  test('CLI: sale con 1 ante el pubspec defectuoso, 0 en el workspace real y 2 sin workspace', () async {
    Future<int> run(String root) async =>
        (await Process.run(Platform.resolvedExecutable, ['run', 'tool/check_deps.dart', '--root', root])).exitCode;
    final reference = File('tool/test/fixtures/app_depends_on_app.pubspec.yaml').readAsStringSync();
    expect(await run(workspace({...clean, 'apps/collector_mobile': reference}).path), 1);
    expect(await run(Directory.current.path), 0);
    final empty = Directory.systemTemp.createTempSync('check_deps_vacio_');
    addTearDown(() => empty.deleteSync(recursive: true));
    expect(await run(empty.path), 2);
  });
}
