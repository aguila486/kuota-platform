import 'package:material_ui/material_ui.dart';

/// Estado de arranque de una app frente a Kuota Core (T085; FR-032). Lo calcula la app; esta pantalla solo lo muestra.
enum StartupStatusKind {
  /// Consulta de compatibilidad en curso.
  loading,

  /// Kuota Core confirmó que esta versión está soportada.
  compatible,

  /// Kuota Core indicó que esta versión no está soportada.
  incompatible,

  /// Kuota Core no respondió o no está disponible.
  unavailable,

  /// Respuesta inesperada o compatibilidad indeterminada.
  unexpected,

  /// La configuración del entorno no es válida (p. ej., URL del servicio central sin definir).
  misconfigured,
}

final class StartupStatus {
  const StartupStatus(this.kind, {this.detail});

  final StartupStatusKind kind;

  /// Detalle técnico breve y no sensible (versión de la API, código de error).
  final String? detail;
}

/// Pantalla de inicio común de las apps (T085; US7-2): nombre, entorno, versión y estado de compatibilidad con
/// Kuota Core. No muestra datos de negocio. Solo ofrece "Reintentar" cuando el estado lo admite.
final class KuotaStartupScreen extends StatelessWidget {
  const KuotaStartupScreen({
    super.key,
    required this.appName,
    required this.environment,
    required this.version,
    required this.status,
    this.onRetry,
  });

  final String appName;
  final String environment;
  final String version;
  final StartupStatus status;
  final VoidCallback? onRetry;

  static String title(StartupStatusKind kind) => switch (kind) {
    StartupStatusKind.loading => 'Comprobando compatibilidad con Kuota Core…',
    StartupStatusKind.compatible => 'Compatible con Kuota Core',
    StartupStatusKind.incompatible => 'Versión no soportada: actualiza la app',
    StartupStatusKind.unavailable => 'Kuota Core no disponible',
    StartupStatusKind.unexpected => 'Respuesta inesperada de Kuota Core',
    StartupStatusKind.misconfigured => 'Configuración del entorno inválida',
  };

  static IconData _icon(StartupStatusKind kind) => switch (kind) {
    StartupStatusKind.loading => Icons.sync,
    StartupStatusKind.compatible => Icons.check_circle,
    StartupStatusKind.incompatible => Icons.system_update,
    StartupStatusKind.unavailable => Icons.cloud_off,
    StartupStatusKind.unexpected => Icons.error_outline,
    StartupStatusKind.misconfigured => Icons.settings,
  };

  bool get _canRetry => status.kind == StartupStatusKind.unavailable || status.kind == StartupStatusKind.unexpected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final isError = switch (status.kind) {
      StartupStatusKind.loading || StartupStatusKind.compatible => false,
      _ => true,
    };
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(appName, key: const Key('startup-app-name'), style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 8),
                  Text('Entorno: $environment', key: const Key('startup-environment')),
                  Text('Versión: $version', key: const Key('startup-version')),
                  const SizedBox(height: 24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          if (status.kind == StartupStatusKind.loading)
                            const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 3))
                          else
                            Icon(_icon(status.kind), color: isError ? scheme.error : scheme.primary),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title(status.kind),
                                  key: const Key('startup-status'),
                                  style: theme.textTheme.titleMedium,
                                ),
                                if (status.detail != null)
                                  Text(status.detail!, key: const Key('startup-status-detail')),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_canRetry && onRetry != null) ...[
                    const SizedBox(height: 16),
                    FilledButton(onPressed: onRetry, child: const Text('Reintentar')),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
