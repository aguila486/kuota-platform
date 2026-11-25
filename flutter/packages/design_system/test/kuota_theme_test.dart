import 'package:design_system/design_system.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// T083 (US7-3): una app que usa el sistema de diseño obtiene el tema común, incluida la variante de alto contraste
/// para recibos. Prueba de widget: se monta una app mínima con cada variante y se inspecciona el tema que reciben sus
/// widgets.
void main() {
  /// Relación de contraste WCAG 2.x entre dos colores (1:1 a 21:1).
  double contrast(Color a, Color b) {
    final la = a.computeLuminance();
    final lb = b.computeLuminance();
    final (hi, lo) = la > lb ? (la, lb) : (lb, la);
    return (hi + 0.05) / (lo + 0.05);
  }

  Future<ThemeData> themeSeenByApp(WidgetTester tester, KuotaThemeVariant variant) async {
    late ThemeData seen;
    await tester.pumpWidget(
      MaterialApp(
        theme: KuotaTheme.of(variant),
        home: Builder(
          builder: (context) {
            seen = Theme.of(context);
            return const Scaffold(body: Text('Recibo'));
          },
        ),
      ),
    );
    // MaterialApp anima el cambio de tema entre montajes: se espera a que termine para leer el tema final.
    await tester.pumpAndSettle();
    expect(find.text('Recibo'), findsOneWidget);
    return seen;
  }

  testWidgets('claro y oscuro: Material 3, brillo correcto y texto legible (AA, ≥ 4.5:1)', (tester) async {
    for (final (variant, brightness) in [
      (KuotaThemeVariant.light, Brightness.light),
      (KuotaThemeVariant.dark, Brightness.dark),
    ]) {
      final theme = await themeSeenByApp(tester, variant);
      expect(theme.useMaterial3, isTrue);
      expect(theme.colorScheme.brightness, brightness);
      expect(contrast(theme.colorScheme.onSurface, theme.colorScheme.surface), greaterThanOrEqualTo(4.5));
    }
  });

  testWidgets('alto contraste para recibos: negro sobre blanco (21:1), bordes negros y texto en negrita', (
    tester,
  ) async {
    final theme = await themeSeenByApp(tester, KuotaThemeVariant.highContrastReceipt);
    final scheme = theme.colorScheme;
    expect(scheme.surface, const Color(0xFFFFFFFF));
    expect(scheme.onSurface, const Color(0xFF000000));
    expect(contrast(scheme.onSurface, scheme.surface), closeTo(21, 0.01));
    expect(contrast(scheme.onPrimary, scheme.primary), greaterThanOrEqualTo(7)); // AAA
    expect(contrast(scheme.onError, scheme.error), greaterThanOrEqualTo(7));
    expect(scheme.outline, const Color(0xFF000000));
    expect(theme.scaffoldBackgroundColor, const Color(0xFFFFFFFF));
    final body = theme.textTheme.bodyMedium!;
    expect(body.color, const Color(0xFF000000));
    final lightWeight = KuotaTheme.light().textTheme.bodyMedium!.fontWeight ?? FontWeight.normal;
    expect(body.fontWeight, FontWeight.w700);
    expect(body.fontWeight!.value, greaterThan(lightWeight.value));
  });

  test('KuotaTheme.of cubre todas las variantes', () {
    for (final variant in KuotaThemeVariant.values) {
      expect(KuotaTheme.of(variant), isA<ThemeData>());
    }
  });
}
