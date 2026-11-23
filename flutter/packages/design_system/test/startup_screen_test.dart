import 'package:design_system/design_system.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// T085: la pantalla de inicio común muestra nombre, entorno, versión y cada estado de compatibilidad.
void main() {
  Future<void> pump(WidgetTester tester, StartupStatus status, {VoidCallback? onRetry}) => tester.pumpWidget(
    MaterialApp(
      theme: KuotaTheme.light(),
      home: KuotaStartupScreen(
        appName: 'Kuota Collector',
        environment: 'local',
        version: '0.1.0+1',
        status: status,
        onRetry: onRetry,
      ),
    ),
  );
  String text(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data!;

  testWidgets('identifica la app: nombre, entorno y versión', (tester) async {
    await pump(tester, const StartupStatus(StartupStatusKind.loading));
    expect(text(tester, 'startup-app-name'), 'Kuota Collector');
    expect(text(tester, 'startup-environment'), 'Entorno: local');
    expect(text(tester, 'startup-version'), 'Versión: 0.1.0+1');
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('cada estado tiene su texto; solo "no disponible" e "inesperado" ofrecen reintentar', (tester) async {
    var retries = 0;
    for (final kind in StartupStatusKind.values) {
      await pump(tester, StartupStatus(kind, detail: 'detalle-$kind'), onRetry: () => retries++);
      expect(text(tester, 'startup-status'), KuotaStartupScreen.title(kind), reason: '$kind');
      expect(text(tester, 'startup-status-detail'), 'detalle-$kind');
      final retry = find.text('Reintentar');
      final retryable = kind == StartupStatusKind.unavailable || kind == StartupStatusKind.unexpected;
      expect(retry, retryable ? findsOneWidget : findsNothing, reason: '$kind');
      if (retryable) await tester.tap(retry);
    }
    expect(retries, 2);
    expect({
      for (final k in StartupStatusKind.values) KuotaStartupScreen.title(k),
    }, hasLength(StartupStatusKind.values.length));
  });
}
