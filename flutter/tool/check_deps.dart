// Verificación de dependencias del workspace Flutter (T084; US7-4; FR-033; R-11; ADR-0003).
//
// Falla si:
//   - una app depende de otra app;
//   - un paquete depende de una app;
//   - `financial_domain` o `shared_core` dependen de Flutter (`flutter`, `flutter_test` o cualquier dependencia
//     `sdk: flutter`);
//   - un paquete depende de otro paquete del workspace fuera del grafo de flutter-architecture.md §3 (T098):
//     shared_core → (ninguno); financial_domain, api_client y design_system → shared_core; app_shell → shared_core,
//     api_client y design_system. Un paquete sin reglas en [allowedPackageDependencies] también es una violación;
//   - un miembro distinto de api_client usa HTTP (`dio` o `http` en `dependencies` o importado desde `lib/`): el cliente
//     HTTP solo vive en api_client (design_system no hace llamadas HTTP; app_shell no duplica el cliente);
//   - existiendo app_shell, una app no depende de él (el arranque compartido no se duplica en las apps).
// "Depende" incluye `dependencies`, `dev_dependencies` y `dependency_overrides`, por nombre o por `path:`. También
// incluye el CÓDIGO: en un pub workspace todos los miembros comparten resolución, de modo que una app podría importar
// `package:<otra_app>/…` sin declararlo. Por eso se revisan los `import`/`export`/`part` de los archivos Dart de cada
// miembro, incluidos los relativos que salen del miembro hacia otra app.
//
// Miembros: los de `workspace:` del pubspec raíz MÁS cualquier directorio de `apps/` o `packages/` con `pubspec.yaml`
// (un miembro olvidado en la lista también se revisa).
//
// Uso: fvm dart run tool/check_deps.dart [--root <directorio del workspace>]   (por defecto, el directorio actual)
// Salida: 0 sin violaciones; 1 con violaciones; 2 si el directorio no es un workspace válido.
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:yaml/yaml.dart';

/// Paquetes que deben ser Dart puro (flutter-architecture.md §3; FR-033).
const pureDartPackages = {'financial_domain', 'shared_core'};

/// Grafo permitido entre paquetes del workspace (flutter-architecture.md §3; Aprobación 11).
const allowedPackageDependencies = <String, Set<String>>{
  'shared_core': {},
  'financial_domain': {'shared_core'},
  'api_client': {'shared_core'},
  'design_system': {'shared_core'},
  'app_shell': {'shared_core', 'api_client', 'design_system'},
};

/// Paquetes de HTTP: solo api_client puede usarlos en producción.
const httpPackages = {'dio', 'http'};
const httpOwner = 'api_client';

/// Capa de composición que toda app debe usar cuando existe.
const shellPackage = 'app_shell';

enum Rule {
  appDependsOnApp('app → app'),
  packageDependsOnApp('paquete → app'),
  pureDartDependsOnFlutter('Dart puro → Flutter'),
  packageGraph('paquete → paquete no permitido'),
  httpOutsideApiClient('HTTP fuera de api_client'),
  appWithoutShell('app sin app_shell');

  const Rule(this.label);
  final String label;
}

final class Violation {
  const Violation(this.rule, this.member, this.detail);

  final Rule rule;
  final String member;
  final String detail;

  @override
  String toString() => '[${rule.label}] $member: $detail';
}

final class WorkspaceError implements Exception {
  const WorkspaceError(this.message);
  final String message;
  @override
  String toString() => message;
}

final class _Member {
  _Member(this.relativePath, this.name, this.pubspec);

  final String relativePath; // relativa a la raíz, con '/'
  final String name;
  final YamlMap pubspec;

  bool get isApp => relativePath.startsWith('apps/');
}

const _dependencySections = ['dependencies', 'dev_dependencies', 'dependency_overrides'];
final _directive = RegExp(r'''^\s*(?:import|export|part)\s+['"]([^'"]+)['"]''', multiLine: true);

/// YAML de [file], o [WorkspaceError] si no se puede leer (un pubspec roto nunca se da por válido).
Object? _loadYamlFile(File file) {
  try {
    return loadYaml(file.readAsStringSync());
  } on YamlException catch (error) {
    throw WorkspaceError('${file.path}: YAML inválido (${error.message})');
  }
}

/// Revisa el workspace con raíz en [root] y devuelve las violaciones (vacía si cumple las reglas).
List<Violation> checkWorkspace(Directory root) {
  final rootPubspec = File(p.join(root.path, 'pubspec.yaml'));
  if (!rootPubspec.existsSync()) throw WorkspaceError('no existe ${rootPubspec.path}');
  final rootYaml = _loadYamlFile(rootPubspec);
  if (rootYaml is! YamlMap || rootYaml['workspace'] is! YamlList) {
    throw WorkspaceError('${rootPubspec.path} no declara `workspace:`');
  }

  final paths = <String>{
    for (final entry in rootYaml['workspace'] as YamlList) p.posix.normalize('$entry'),
    for (final group in ['apps', 'packages'])
      if (Directory(p.join(root.path, group)).existsSync())
        for (final dir in Directory(p.join(root.path, group)).listSync().whereType<Directory>())
          if (File(p.join(dir.path, 'pubspec.yaml')).existsSync()) '$group/${p.basename(dir.path)}',
  };

  final members = <_Member>[];
  for (final path in paths.toList()..sort()) {
    final file = File(p.join(root.path, path, 'pubspec.yaml'));
    if (!file.existsSync()) throw WorkspaceError('el miembro $path no tiene pubspec.yaml');
    final yaml = _loadYamlFile(file);
    if (yaml is! YamlMap || yaml['name'] is! String) throw WorkspaceError('$path/pubspec.yaml no tiene `name`');
    members.add(_Member(path, yaml['name'] as String, yaml));
  }

  final appsByName = {for (final m in members.where((m) => m.isApp)) m.name: m};
  final appDirs = {for (final m in appsByName.values) m.relativePath: m.name};
  final violations = <Violation>[];

  /// Nombre de la app a la que apunta una ruta relativa a la raíz, si la hay.
  String? appAt(String relativeToRoot) {
    for (final MapEntry(key: dir, value: name) in appDirs.entries) {
      if (relativeToRoot == dir || p.posix.isWithin(dir, relativeToRoot)) return name;
    }
    return null;
  }

  final packagesByName = {for (final m in members.where((m) => !m.isApp)) m.name: m};
  final packageDirs = {for (final m in packagesByName.values) m.relativePath: m.name};

  /// Nombre del paquete al que apunta una ruta relativa a la raíz, si lo hay.
  String? packageAt(String relativeToRoot) {
    for (final MapEntry(key: dir, value: name) in packageDirs.entries) {
      if (relativeToRoot == dir || p.posix.isWithin(dir, relativeToRoot)) return name;
    }
    return null;
  }

  /// Un paquete solo puede depender de los paquetes que le permite el grafo; las apps, de cualquier paquete.
  void reportPackage(_Member member, String target, String how) {
    if (member.isApp || target == member.name) return;
    final allowed = allowedPackageDependencies[member.name];
    if (allowed == null || allowed.contains(target)) return;
    violations.add(Violation(Rule.packageGraph, member.relativePath, '$how el paquete $target'));
  }

  for (final member in packagesByName.values) {
    if (!allowedPackageDependencies.containsKey(member.name)) {
      violations.add(
        Violation(Rule.packageGraph, member.relativePath, 'paquete sin reglas en allowedPackageDependencies'),
      );
    }
  }
  if (packagesByName.containsKey(shellPackage)) {
    for (final app in members.where((m) => m.isApp)) {
      final deps = app.pubspec['dependencies'];
      if (deps is! YamlMap || !deps.containsKey(shellPackage)) {
        violations.add(Violation(Rule.appWithoutShell, app.relativePath, 'dependencies no declara $shellPackage'));
      }
    }
  }

  void reportApp(_Member member, String app, String how) {
    if (app == member.name) return;
    violations.add(
      Violation(member.isApp ? Rule.appDependsOnApp : Rule.packageDependsOnApp, member.relativePath, '$how $app'),
    );
  }

  for (final member in members) {
    for (final section in _dependencySections) {
      final deps = member.pubspec[section];
      if (deps is! YamlMap) continue;
      for (final MapEntry(:key, :value) in deps.entries) {
        final name = '$key';
        if (appsByName.containsKey(name)) reportApp(member, name, '$section declara la app');
        if (value is YamlMap && value['path'] is String) {
          final target = p.posix.normalize(p.posix.join(member.relativePath, value['path'] as String));
          final app = appAt(target);
          if (app != null) reportApp(member, app, '$section apunta por path a la app');
        }
        final target = packagesByName.containsKey(name)
            ? name
            : value is YamlMap && value['path'] is String
            ? packageAt(p.posix.normalize(p.posix.join(member.relativePath, value['path'] as String)))
            : null;
        if (target != null) reportPackage(member, target, '$section declara');
        if (section == 'dependencies' && httpPackages.contains(name) && member.name != httpOwner) {
          violations.add(Violation(Rule.httpOutsideApiClient, member.relativePath, '$section declara $name'));
        }
        final isFlutter =
            name == 'flutter' || name == 'flutter_test' || (value is YamlMap && value['sdk'] == 'flutter');
        if (pureDartPackages.contains(member.name) && isFlutter) {
          violations.add(Violation(Rule.pureDartDependsOnFlutter, member.relativePath, '$section declara $name'));
        }
      }
    }

    final memberDir = Directory(p.join(root.path, member.relativePath));
    final dartFiles = memberDir
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .where((f) => !p.split(p.relative(f.path, from: memberDir.path)).any((s) => s.startsWith('.') || s == 'build'));
    for (final file in dartFiles) {
      final fileRelative = p.relative(file.path, from: root.path).replaceAll(r'\', '/');
      for (final match in _directive.allMatches(file.readAsStringSync())) {
        final uri = match.group(1)!;
        if (uri.startsWith('package:')) {
          final package = uri.substring('package:'.length).split('/').first;
          if (appsByName.containsKey(package)) reportApp(member, package, '$fileRelative importa la app');
          if (packagesByName.containsKey(package)) reportPackage(member, package, '$fileRelative importa');
          final inLib = p.posix.isWithin('${member.relativePath}/lib', fileRelative);
          if (inLib && httpPackages.contains(package) && member.name != httpOwner) {
            violations.add(Violation(Rule.httpOutsideApiClient, member.relativePath, '$fileRelative importa $package'));
          }
          if (pureDartPackages.contains(member.name) && package == 'flutter') {
            violations.add(
              Violation(Rule.pureDartDependsOnFlutter, member.relativePath, '$fileRelative importa flutter'),
            );
          }
        } else if (!uri.contains(':')) {
          final target = p.posix.normalize(p.posix.join(p.posix.dirname(fileRelative), uri));
          final app = appAt(target);
          if (app != null) reportApp(member, app, '$fileRelative importa por ruta relativa la app');
        }
      }
    }
  }
  return violations;
}

void main(List<String> args) {
  final rootIndex = args.indexOf('--root');
  final root = Directory(rootIndex >= 0 && rootIndex + 1 < args.length ? args[rootIndex + 1] : Directory.current.path);
  try {
    final violations = checkWorkspace(root);
    if (violations.isEmpty) {
      stdout.writeln(
        'check_deps: sin violaciones (apps independientes con app_shell; grafo de paquetes; Dart puro sin Flutter; HTTP solo en api_client)',
      );
      return;
    }
    for (final violation in violations) {
      stdout.writeln('  ✗ $violation');
    }
    stdout.writeln('check_deps: ${violations.length} violación(es) (US7-4, FR-033)');
    exitCode = 1;
  } on WorkspaceError catch (error) {
    stderr.writeln('check_deps: $error');
    exitCode = 2;
  }
}
