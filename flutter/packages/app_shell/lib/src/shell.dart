import 'package:design_system/design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:material_ui/material_ui.dart';
import 'package:shared_core/shared_core.dart';

import 'app_identity.dart';
import 'providers.dart';

/// Ámbito de Riverpod de una app con su identidad. [overrides] solo para pruebas (configuración o cliente falsos).
ProviderScope kuotaAppScope(AppIdentity identity, {List<Override> overrides = const []}) => ProviderScope(
  overrides: [appIdentityProvider.overrideWithValue(identity), ...overrides],
  child: const KuotaShellApp(),
);

/// Punto de arranque compartido: el `main.dart` de cada app solo llama a esta función con su identidad.
void runKuotaApp(AppIdentity identity) => runApp(kuotaAppScope(identity));

/// App con el tema común (design_system) y la pantalla de inicio. Sin pantallas de negocio.
final class KuotaShellApp extends ConsumerWidget {
  const KuotaShellApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp(
    title: ref.watch(appIdentityProvider).name,
    theme: KuotaTheme.light(),
    darkTheme: KuotaTheme.dark(),
    home: const StartupPage(),
  );
}

/// Pantalla de inicio: nombre, entorno, versión y compatibilidad con Kuota Core, con reintento.
final class StartupPage extends ConsumerWidget {
  const StartupPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final identity = ref.watch(appIdentityProvider);
    final config = ref.watch(appConfigProvider);
    final environment = switch (config) {
      Ok(:final value) => value.environment.name,
      Err() => 'sin configurar',
    };
    return KuotaStartupScreen(
      appName: identity.name,
      environment: environment,
      version: identity.display,
      status: startupStatusFor(identity, config, ref.watch(compatibilityProvider)),
      onRetry: () => ref.invalidate(compatibilityProvider),
    );
  }
}
