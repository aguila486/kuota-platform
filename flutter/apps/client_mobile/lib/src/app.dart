import 'package:design_system/design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_core/shared_core.dart';

import 'app_info.dart';
import 'providers.dart';

/// App con el tema común (design_system) y la pantalla de inicio (T085). Sin pantallas de negocio.
final class KuotaShellApp extends StatelessWidget {
  const KuotaShellApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: AppInfo.name,
    theme: KuotaTheme.light(),
    darkTheme: KuotaTheme.dark(),
    home: const StartupPage(),
  );
}

/// Pantalla de inicio: nombre, entorno, versión y compatibilidad con Kuota Core.
final class StartupPage extends ConsumerWidget {
  const StartupPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(appConfigProvider);
    final environment = switch (config) {
      Ok(:final value) => value.environment.name,
      Err() => 'sin configurar',
    };
    return KuotaStartupScreen(
      appName: AppInfo.name,
      environment: environment,
      version: AppInfo.display,
      status: startupStatusFor(config, ref.watch(compatibilityProvider)),
      onRetry: () => ref.invalidate(compatibilityProvider),
    );
  }
}
