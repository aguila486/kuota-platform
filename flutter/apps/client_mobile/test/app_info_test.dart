import 'dart:io';

import 'package:client_mobile/src/app_info.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yaml/yaml.dart';

/// La identidad de la app (T085, T098): su versión es la del pubspec.yaml y la que viaja en X-App-Version.
void main() {
  test('AppInfo coincide con el pubspec.yaml y con X-App-Version', () {
    final pubspec = loadYaml(File('pubspec.yaml').readAsStringSync()) as YamlMap;
    expect(pubspec['version'], AppInfo.identity.display);
    expect(AppInfo.identity.name, 'Kuota Client');
    expect(AppInfo.identity.appVersion.headerValue, 'client/${AppInfo.identity.display}');
  });
}
