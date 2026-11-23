import 'package:api_client/api_client.dart';

/// Identidad de una app Kuota: nombre visible, tipo de app y versión. `version` y `build` deben coincidir con el
/// `pubspec.yaml` de la app (lo comprueba su `test/app_info_test.dart`) y viajan a Kuota Core en `X-App-Version`
/// (`<app>/<version>+<build>`).
final class AppIdentity {
  const AppIdentity({required this.name, required this.app, required this.version, required this.build});

  final String name;
  final KuotaApp app;
  final String version;
  final int build;

  /// Versión visible (`0.1.0+1`), igual que el campo `version` del `pubspec.yaml`.
  String get display => '$version+$build';

  /// Valor validado de `X-App-Version` (ArgumentError si la versión no es semver).
  AppVersion get appVersion => AppVersion(app, version, build: build);

  /// Versión mínima soportada que informa Kuota Core para esta app.
  String minimumFrom(CompatibilityInfo info) => switch (app) {
    KuotaApp.admin => info.minSupported.admin,
    KuotaApp.collector => info.minSupported.collector,
    KuotaApp.client => info.minSupported.client,
  };
}
