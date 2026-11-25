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

  group('grafo de paquetes, HTTP y app_shell (T098; flutter-architecture.md §3)', () {
    final withShell = {
      ...clean,
      'apps/admin_web': 'dependencies:\n  app_shell:\n    path: ../../packages/app_shell\n',
      'apps/client_mobile': 'dependencies:\n  app_shell:\n    path: ../../packages/app_shell\n',
      'packages/api_client': 'dependencies:\n  dio: any\n  shared_core:\n    path: ../shared_core\n',
      'packages/app_shell':
          'dependencies:\n  api_client: any\n  design_system: any\n  shared_core: any\ndev_dependencies:\n  dio: any\n',
    };

    test('el grafo permitido (app_shell → shared_core, api_client, design_system; dio solo en api_client) pasa', () {
      expect(
        checkWorkspace(
          workspace(
            withShell,
            files: {
              'packages/app_shell/lib/a.dart': "import 'package:api_client/api_client.dart';\n",
              'packages/app_shell/test/t.dart': "import 'package:dio/dio.dart';\n",
              'packages/api_client/lib/b.dart': "import 'package:dio/dio.dart';\n",
            },
          ),
        ),
        isEmpty,
      );
    });

    test('dependencias fuera del grafo → falla (por nombre, por path y por import)', () {
      final violations = checkWorkspace(
        workspace(
          {
            ...withShell,
            'packages/design_system': 'dependencies:\n  api_client: any\n',
            'packages/financial_domain': 'dependencies:\n  shell:\n    path: ../app_shell\n',
          },
          files: {'packages/shared_core/lib/x.dart': "import 'package:design_system/design_system.dart';\n"},
        ),
      );
      final text = violations.map((v) => '$v').join('\n');
      expect(violations.map((v) => v.rule).toSet(), {Rule.packageGraph});
      expect(text, contains('packages/design_system: dependencies declara el paquete api_client'));
      expect(text, contains('packages/financial_domain: dependencies declara el paquete app_shell'));
      expect(text, contains('packages/shared_core: packages/shared_core/lib/x.dart importa el paquete design_system'));
    });

    test('HTTP fuera de api_client → falla (design_system, app_shell o una app; dependencies o lib/)', () {
      final violations = checkWorkspace(
        workspace(
          {...withShell, 'packages/design_system': 'dependencies:\n  http: any\n'},
          files: {
            'packages/app_shell/lib/c.dart': "import 'package:dio/dio.dart';\n",
            'apps/admin_web/lib/d.dart': "import 'package:http/http.dart';\n",
          },
        ),
      );
      expect(violations.map((v) => v.rule).toSet(), {Rule.httpOutsideApiClient});
      expect(violations.map((v) => v.member).toSet(), {
        'packages/design_system',
        'packages/app_shell',
        'apps/admin_web',
      });
    });

    test('con app_shell en el workspace, una app que no depende de él → falla', () {
      final violations = checkWorkspace(
        workspace({...withShell, 'apps/client_mobile': 'dependencies:\n  shared_core: any\n'}),
      );
      expect(violations.single.rule, Rule.appWithoutShell);
      expect(violations.single.member, 'apps/client_mobile');
    });

    test('un paquete sin reglas en el grafo → falla (hay que decidir sus dependencias)', () {
      final violations = checkWorkspace(workspace({...withShell, 'packages/nuevo': 'dependencies:\n  meta: any\n'}));
      expect(violations.single.rule, Rule.packageGraph);
      expect('${violations.single}', contains('sin reglas'));
    });
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
