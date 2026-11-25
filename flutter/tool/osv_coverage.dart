// Cobertura del escaneo de dependencias Dart (T050; Constitución II; SEC-2026-001 como precedente de gate).
//
// osv-scanner puede terminar sin hallazgos porque no encontró vulnerabilidades… o porque no leyó el lockfile. Este
// verificador exige que CADA paquete alojado (`source: hosted`, de pub.dev) de `flutter/pubspec.lock` aparezca, con su
// versión exacta y el ecosistema `Pub`, en el informe JSON de `osv-scanner --all-packages`. Los paquetes `sdk`
// (flutter, flutter_test…) llegan con el SDK fijado y no están en OSV; se informan aparte. La severidad la evalúa
// scripts/ci/osv-gate.mjs sobre el mismo informe.
//
// Uso: fvm dart run tool/osv_coverage.dart <pubspec.lock> <informe-osv.json>
// Salida: 0 cobertura completa; 1 algún paquete alojado sin escanear; 2 entrada inválida.
import 'dart:convert';
import 'dart:io';

import 'package:yaml/yaml.dart';

final class CoverageError implements Exception {
  const CoverageError(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Resultado: paquetes alojados esperados, los que faltan en el informe y los de SDK (no escaneables).
typedef Coverage = ({Set<String> expected, Set<String> missing, Set<String> sdk});

Coverage checkCoverage(String lockText, String reportText) {
  final Object? lock;
  final Object? report;
  try {
    lock = loadYaml(lockText);
    report = jsonDecode(reportText);
  } on YamlException catch (error) {
    throw CoverageError('pubspec.lock inválido: ${error.message}');
  } on FormatException catch (error) {
    throw CoverageError('informe JSON inválido: ${error.message}');
  }
  if (lock is! YamlMap || lock['packages'] is! YamlMap) throw const CoverageError('pubspec.lock sin `packages`');
  if (report is! Map || report['results'] is! List) throw const CoverageError('informe sin `results`');

  final expected = <String>{};
  final sdk = <String>{};
  for (final MapEntry(:key, :value) in (lock['packages'] as YamlMap).entries) {
    if (value is! YamlMap) throw CoverageError('entrada inválida para $key');
    switch (value['source']) {
      case 'hosted':
        expected.add('$key@${value['version']}');
      case 'sdk':
        sdk.add('$key');
      default:
        // git/path no se escanean en OSV por versión: un paquete así no debe pasar inadvertido.
        expected.add('$key@${value['version']}');
    }
  }
  final scanned = <String>{
    for (final result in report['results'] as List)
      if (result is Map && result['packages'] is List)
        for (final pkg in result['packages'] as List)
          if (pkg is Map && pkg['package'] is Map && (pkg['package'] as Map)['ecosystem'] == 'Pub')
            '${(pkg['package'] as Map)['name']}@${(pkg['package'] as Map)['version']}',
  };
  return (expected: expected, missing: expected.difference(scanned), sdk: sdk);
}

void main(List<String> args) {
  if (args.length != 2) {
    stderr.writeln('uso: dart run tool/osv_coverage.dart <pubspec.lock> <informe-osv.json>');
    exitCode = 2;
    return;
  }
  try {
    final coverage = checkCoverage(File(args[0]).readAsStringSync(), File(args[1]).readAsStringSync());
    if (coverage.expected.isEmpty) throw const CoverageError('el lockfile no tiene paquetes alojados');
    if (coverage.missing.isNotEmpty) {
      for (final package in coverage.missing.toList()..sort()) {
        stdout.writeln('  ✗ sin escanear: $package');
      }
      stdout.writeln('osv-coverage: ${coverage.missing.length} de ${coverage.expected.length} paquetes sin escanear');
      exitCode = 1;
      return;
    }
    stdout.writeln(
      'osv-coverage: ${coverage.expected.length}/${coverage.expected.length} paquetes alojados escaneados '
      '(${coverage.sdk.length} del SDK fijado, no publicados en OSV: ${(coverage.sdk.toList()..sort()).join(', ')})',
    );
  } on CoverageError catch (error) {
    stderr.writeln('osv-coverage: $error');
    exitCode = 2;
  } on FileSystemException catch (error) {
    stderr.writeln('osv-coverage: ${error.message}: ${error.path}');
    exitCode = 2;
  }
}
