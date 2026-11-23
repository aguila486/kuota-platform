import 'dart:io';

import 'package:admin_web/src/app_info.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaml/yaml.dart';

/// La versión que se muestra y se envía en X-App-Version es la del pubspec.yaml.
void main() {
  test('AppInfo coincide con la versión del pubspec.yaml', () {
    final pubspec = loadYaml(File('pubspec.yaml').readAsStringSync()) as YamlMap;
    expect(pubspec['version'], AppInfo.display);
    expect(AppInfo.appVersion.headerValue, '${AppInfo.app.name}/${AppInfo.display}');
  });
}
