import 'package:api_client/api_client.dart';

/// Identidad de Kuota Admin (T085). `version` y `build` deben coincidir con `pubspec.yaml` (test/app_info_test.dart) y
/// se envían a Kuota Core en `X-App-Version` (`admin/<version>+<build>`).
abstract final class AppInfo {
  static const name = 'Kuota Admin';
  static const app = KuotaApp.admin;
  static const version = '0.1.0';
  static const build = 1;

  static String get display => '$version+$build';
  static AppVersion get appVersion => AppVersion(app, version, build: build);
}
