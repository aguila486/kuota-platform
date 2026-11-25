import 'package:api_client/api_client.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_core/shared_core.dart';

import 'app_identity.dart';

/// Identidad de la app. No tiene valor por defecto: [kuotaAppScope] la sobrescribe con la de cada app.
final appIdentityProvider = Provider<AppIdentity>(
  (ref) => throw StateError('appIdentityProvider debe sobrescribirse con la identidad de la app (kuotaAppScope)'),
);

/// Configuración del entorno (`--dart-define-from-file`). Inválida → `Err`, nunca un valor por defecto inventado.
final appConfigProvider = Provider<Result<AppConfig>>((ref) => AppConfig.tryFromEnvironment());

/// Cliente de Kuota Core (api_client) para la configuración válida; `null` si la configuración no lo es.
final apiClientProvider = Provider<KuotaApiClient?>((ref) {
  final config = ref.watch(appConfigProvider);
  if (config is! Ok<AppConfig>) return null;
  final client = KuotaApiClient.fromConfig(config.value, ref.watch(appIdentityProvider).appVersion);
  ref.onDispose(client.close);
  return client;
});

/// Compatibilidad con Kuota Core: una consulta real a `GET /v1/meta/compatibility`. `null` sin configuración válida.
final compatibilityProvider = FutureProvider<CompatibilityStatus?>((ref) async {
  final client = ref.watch(apiClientProvider);
  if (client == null) return null;
  return client.checkCompatibility();
});

/// Estado que muestra la pantalla de inicio. Nunca "compatible" sin una respuesta válida del servidor.
StartupStatus startupStatusFor(
  AppIdentity identity,
  Result<AppConfig> config,
  AsyncValue<CompatibilityStatus?> compatibility,
) {
  if (config case Err(:final failure)) {
    return StartupStatus(StartupStatusKind.misconfigured, detail: failure.message);
  }
  return switch (compatibility) {
    AsyncData(value: Compatible(:final info)) => StartupStatus(
      StartupStatusKind.compatible,
      detail: 'API ${info.apiVersion}',
    ),
    AsyncData(value: Incompatible(:final info)) => StartupStatus(
      StartupStatusKind.incompatible,
      detail: info == null ? null : 'Versión mínima soportada: ${identity.minimumFrom(info)}',
    ),
    AsyncData(value: ApiUnavailable(:final failure)) => StartupStatus(
      StartupStatusKind.unavailable,
      detail: failure.code,
    ),
    AsyncData(value: UnexpectedCompatibility(:final failure)) => StartupStatus(
      StartupStatusKind.unexpected,
      detail: failure.code,
    ),
    AsyncData(value: null) => const StartupStatus(StartupStatusKind.misconfigured),
    AsyncError() => const StartupStatus(StartupStatusKind.unexpected, detail: 'error-interno-de-la-app'),
    AsyncLoading() => const StartupStatus(StartupStatusKind.loading),
  };
}
