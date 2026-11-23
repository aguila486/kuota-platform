import 'package:app_shell/app_shell.dart';

/// Identidad de Kuota Admin (T085, T098). `version` y `build` deben coincidir con `pubspec.yaml` (test/app_info_test.dart)
/// y se envían a Kuota Core en `X-App-Version` (`admin/<version>+<build>`).
abstract final class AppInfo {
  static const identity = AppIdentity(name: 'Kuota Admin', app: KuotaApp.admin, version: '0.1.0', build: 1);
}
