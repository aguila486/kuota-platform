import 'dart:convert';
import 'dart:io';

import 'package:shared_core/shared_core.dart';

/// Proceso auxiliar de `app_config_test.dart`: imprime la configuración leída de `--define` (como lo haría una app con
/// `--dart-define-from-file`). Solo para pruebas.
void main() {
  final config = AppConfig.fromEnvironment();
  stdout.writeln(jsonEncode({'environment': config.environment.name, 'apiBaseUrl': config.apiBaseUrl.toString()}));
}
