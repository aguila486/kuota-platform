import 'package:app_shell/app_shell.dart';

/// Identidad de Kuota Collector (T085, T098). `version` y `build` deben coincidir con `pubspec.yaml` (test/app_info_test.dart)
/// y se envían a Kuota Core en `X-App-Version` (`collector/<version>+<build>`).
abstract final class AppInfo {
  static const identity = AppIdentity(name: 'Kuota Collector', app: KuotaApp.collector, version: '0.1.0', build: 1);
}
