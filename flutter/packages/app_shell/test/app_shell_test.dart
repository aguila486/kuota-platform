import 'package:api_client/api_client.dart';
import 'package:api_client/src/generated/generated.dart' as generated;
import 'package:app_shell/app_shell.dart';
import 'package:design_system/design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_core/shared_core.dart';

/// T098: identidad, providers y traducción a `StartupStatus` del shell compartido, sin widgets.
void main() {
  CompatibilityInfo info({bool? supported}) =>
      generated.standardSerializers.deserializeWith(CompatibilityInfo.serializer, {
        'api_version': '1.2.3',
        'min_supported': {'admin': '0.1.0', 'collector': '0.2.0', 'client': '0.3.0'},
        'client_supported': supported,
        'server_time': '2026-11-23T12:00:00Z',
      })!;
  final local = Ok(AppConfig.fromValues({'KUOTA_ENV': 'local', 'KUOTA_API_BASE_URL': 'http://127.0.0.1:3000'}));

  group('AppIdentity', () {
    test('versión visible, X-App-Version y versión mínima de cada app', () {
      for (final (app, minimum) in [
        (KuotaApp.admin, '0.1.0'),
        (KuotaApp.collector, '0.2.0'),
        (KuotaApp.client, '0.3.0'),
      ]) {
        final identity = AppIdentity(name: 'x', app: app, version: '1.4.2', build: 7);
        expect(identity.display, '1.4.2+7');
        expect(identity.appVersion.headerValue, '${app.name}/1.4.2+7');
        expect(identity.minimumFrom(info()), minimum);
      }
    });

    test('una versión que no es semver se rechaza al construir X-App-Version', () {
      expect(
        () => const AppIdentity(name: 'x', app: KuotaApp.admin, version: '1.0', build: 1).appVersion,
        throwsArgumentError,
      );
    });
  });

  group('providers', () {
    test('sin identidad sobrescrita, el ámbito falla en lugar de inventar una', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(() => container.read(appIdentityProvider), throwsA(anything));
    });

    test('apiClientProvider: cliente con la URL de la configuración; null con configuración inválida', () {
      const identity = AppIdentity(name: 'x', app: KuotaApp.client, version: '0.1.0', build: 1);
      final ok = ProviderContainer(
        overrides: [appIdentityProvider.overrideWithValue(identity), appConfigProvider.overrideWithValue(local)],
      );
      addTearDown(ok.dispose);
      expect(ok.read(apiClientProvider)!.baseUrl, 'http://127.0.0.1:3000');

      final invalid = ProviderContainer(
        overrides: [
          appIdentityProvider.overrideWithValue(identity),
          appConfigProvider.overrideWithValue(const Err(Failure('config-invalid'))),
        ],
      );
      addTearDown(invalid.dispose);
      expect(invalid.read(apiClientProvider), isNull);
    });

    test('appConfigProvider sin --dart-define (pruebas) es Err, nunca una URL inventada', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(appConfigProvider), isA<Err<AppConfig>>());
    });

    test('compatibilityProvider es null sin configuración válida (no consulta la red)', () async {
      final container = ProviderContainer(
        overrides: [appConfigProvider.overrideWithValue(const Err(Failure('config-invalid')))],
      );
      addTearDown(container.dispose);
      expect(await container.read(compatibilityProvider.future), isNull);
    });
  });

  group('startupStatusFor', () {
    const identity = AppIdentity(name: 'x', app: KuotaApp.client, version: '0.1.0', build: 1);
    StartupStatus of(Result<AppConfig> config, AsyncValue<CompatibilityStatus?> value) =>
        startupStatusFor(identity, config, value);

    test('cada estado de compatibilidad tiene su estado de arranque', () {
      expect(of(local, const AsyncLoading()).kind, StartupStatusKind.loading);
      expect(of(local, AsyncData(Compatible(info(supported: true)))).detail, 'API 1.2.3');
      expect(
        of(local, AsyncData(Incompatible(info: info(supported: false)))).detail,
        'Versión mínima soportada: 0.3.0',
      );
      expect(of(local, const AsyncData(Incompatible())).detail, isNull);
      expect(of(local, const AsyncData(ApiUnavailable(Failure('network-error')))).detail, 'network-error');
      expect(
        of(local, const AsyncData(UnexpectedCompatibility(Failure('internal-error')))).kind,
        StartupStatusKind.unexpected,
      );
      expect(of(local, const AsyncData(null)).kind, StartupStatusKind.misconfigured);
      final error = of(local, AsyncError<CompatibilityStatus?>(StateError('x'), StackTrace.empty));
      expect(error.kind, StartupStatusKind.unexpected);
      expect(error.detail, 'error-interno-de-la-app');
    });

    test('la configuración inválida manda sobre cualquier resultado', () {
      final status = of(const Err(Failure('config-invalid', message: 'KUOTA_ENV: obligatorio')), const AsyncLoading());
      expect(status.kind, StartupStatusKind.misconfigured);
      expect(status.detail, 'KUOTA_ENV: obligatorio');
    });
  });
}
