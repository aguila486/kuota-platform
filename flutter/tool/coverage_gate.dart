// Gate de cobertura de los paquetes compartidos de Flutter/Dart (C1 de T092; Constitución X; FR-035).
//
// Constitución X: "Cobertura mínima en dominio financiero: 90 % de líneas y ramas; resto del backend y paquetes
// compartidos: 80 %". Este verificador lee el lcov de UN paquete (generado con `dart test --coverage-path
// --branch-coverage` o `flutter test --coverage --branch-coverage`) y falla si:
//   - el porcentaje de líneas o de ramas del código de `lib/` está por debajo del mínimo;
//   - algún archivo de `lib/` con código ejecutable no aparece en el informe (ninguna prueba lo cargó): un archivo sin
//     probar no puede quedar fuera del denominador;
//   - el informe no existe, está vacío o no contiene ningún archivo de `lib/` del paquete.
//
// Alcance (mismo criterio que el backend, `vitest.config.ts`: `exclude: ['src/generated/**']`): se excluye solo el
// código GENERADO de `lib/src/generated/**` (cliente OpenAPI de api_client, que T071 verifica regenerándolo). Su
// cobertura se informa aparte, nunca se oculta. Ningún otro archivo productivo se excluye.
//
// Uso: fvm dart run tool/coverage_gate.dart <directorio-del-paquete> <lcov> <mínimo-líneas> <mínimo-ramas>
// Salida: 0 cumple; 1 por debajo del mínimo o archivos sin cargar; 2 entrada inválida.
import 'dart:io';

import 'package:path/path.dart' as p;

final class CoverageGateError implements Exception {
  const CoverageGateError(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Conteo de líneas y ramas (cubiertas / totales).
final class Tally {
  int lines = 0;
  int linesHit = 0;
  int branches = 0;
  int branchesHit = 0;

  double get linePercent => lines == 0 ? 100 : 100 * linesHit / lines;
  double get branchPercent => branches == 0 ? 100 : 100 * branchesHit / branches;

  @override
  String toString() =>
      'líneas $linesHit/$lines (${linePercent.toStringAsFixed(1)} %), '
      'ramas $branchesHit/$branches (${branchPercent.toStringAsFixed(1)} %)';
}

typedef GateResult = ({Tally own, Tally generated, List<String> notLoaded, int files});

/// Ruta del código generado (excluida del umbral, informada aparte).
const generatedDir = 'lib/src/generated/';

/// ¿Tiene el archivo código ejecutable? Ignora comentarios y directivas (`library`, `import`, `export`, `part`).
bool hasExecutableCode(String source) {
  final withoutComments = source
      .replaceAll(RegExp(r'/\*[\s\S]*?\*/'), '')
      .split('\n')
      .map((line) => line.replaceFirst(RegExp(r'//.*$'), '').trim())
      .where((line) => line.isNotEmpty);
  final code = withoutComments.join('\n').replaceAll(RegExp(r'''\b(library|import|export|part)\b[^;]*;'''), '');
  return code.trim().isNotEmpty;
}

/// Evalúa el lcov de un paquete. [libFiles]: rutas relativas al paquete (`lib/...`) con su contenido.
GateResult evaluate(String packageDir, String lcov, Map<String, String> libFiles) {
  final lines = <String, Map<int, int>>{};
  final branches = <String, Map<String, int>>{};
  String? current;
  for (final raw in lcov.split('\n')) {
    final line = raw.trim();
    if (line.startsWith('SF:')) {
      final path = line.substring(3);
      final absolute = p.isAbsolute(path) ? path : p.join(packageDir, path);
      final relative = p.relative(p.normalize(absolute), from: p.normalize(packageDir));
      current = relative.startsWith('lib/') ? relative : null;
      if (current != null) {
        lines.putIfAbsent(current, () => {});
        branches.putIfAbsent(current, () => {});
      }
    } else if (current != null && line.startsWith('DA:')) {
      final parts = line.substring(3).split(',');
      final number = int.parse(parts[0]);
      final hits = int.parse(parts[1]);
      final byLine = lines[current]!;
      byLine[number] = (byLine[number] ?? 0) > hits ? byLine[number]! : hits;
    } else if (current != null && line.startsWith('BRDA:')) {
      final parts = line.substring(5).split(',');
      if (parts.length != 4) throw CoverageGateError('BRDA inválido: $line');
      final key = '${parts[0]},${parts[1]},${parts[2]}';
      final hits = parts[3] == '-' ? 0 : int.parse(parts[3]);
      final byBranch = branches[current]!;
      byBranch[key] = (byBranch[key] ?? 0) > hits ? byBranch[key]! : hits;
    }
  }
  if (lines.isEmpty) throw const CoverageGateError('el informe no contiene archivos de lib/ de este paquete');

  final own = Tally();
  final generated = Tally();
  for (final file in lines.keys) {
    final tally = file.startsWith(generatedDir) ? generated : own;
    tally
      ..lines += lines[file]!.length
      ..linesHit += lines[file]!.values.where((h) => h > 0).length
      ..branches += branches[file]!.length
      ..branchesHit += branches[file]!.values.where((h) => h > 0).length;
  }
  final notLoaded = [
    for (final entry in libFiles.entries)
      if (!entry.key.startsWith(generatedDir) && !lines.containsKey(entry.key) && hasExecutableCode(entry.value))
        entry.key,
  ]..sort();
  return (
    own: own,
    generated: generated,
    notLoaded: notLoaded,
    files: lines.keys.where((f) => !f.startsWith(generatedDir)).length,
  );
}

void main(List<String> args) {
  if (args.length != 4) {
    stderr.writeln('uso: dart run tool/coverage_gate.dart <paquete> <lcov> <mínimo-líneas> <mínimo-ramas>');
    exit(2);
  }
  if (!Directory(args[0]).existsSync()) {
    stderr.writeln('  ✗ no existe el paquete ${args[0]}');
    exit(2);
  }
  // Ruta real (sin enlaces simbólicos): el lcov de la VM usa rutas reales (p. ej. /private/var en macOS, no /var).
  final packageDir = Directory(args[0]).resolveSymbolicLinksSync();
  final lcovFile = File(args[1]);
  final minLines = double.tryParse(args[2]);
  final minBranches = double.tryParse(args[3]);
  final name = p.basename(packageDir);
  if (minLines == null || minBranches == null || minLines <= 0 || minBranches <= 0) {
    stderr.writeln('  ✗ $name: umbrales inválidos');
    exit(2);
  }
  if (!lcovFile.existsSync() || lcovFile.lengthSync() == 0) {
    stderr.writeln('  ✗ $name: no hay informe de cobertura (${args[1]})');
    exit(2);
  }
  final libDir = Directory(p.join(packageDir, 'lib'));
  final libFiles = {
    for (final file in libDir.listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart')))
      p.relative(file.path, from: packageDir): file.readAsStringSync(),
  };
  final GateResult result;
  try {
    result = evaluate(packageDir, lcovFile.readAsStringSync(), libFiles);
  } on CoverageGateError catch (error) {
    stderr.writeln('  ✗ $name: $error');
    exit(2);
  } on FormatException catch (error) {
    stderr.writeln('  ✗ $name: lcov inválido: ${error.message}');
    exit(2);
  }
  stdout.writeln('  $name: ${result.own} en ${result.files} archivo(s); mínimo $minLines % / $minBranches %');
  if (result.generated.lines > 0) stdout.writeln('    (informativo) código generado: ${result.generated}');
  var failed = false;
  if (result.own.linePercent < minLines) {
    stdout.writeln('  ✗ $name: líneas por debajo de $minLines %');
    failed = true;
  }
  if (result.own.branchPercent < minBranches) {
    stdout.writeln('  ✗ $name: ramas por debajo de $minBranches %');
    failed = true;
  }
  for (final file in result.notLoaded) {
    stdout.writeln('  ✗ $name: $file tiene código y ninguna prueba lo carga');
    failed = true;
  }
  exit(failed ? 1 : 0);
}
