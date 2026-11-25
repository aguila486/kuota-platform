import 'package:material_ui/material_ui.dart';

/// Variantes del tema común (US7-3).
enum KuotaThemeVariant {
  light,
  dark,

  /// Alto contraste reservado para recibos futuros (cobranza en campo, pantallas al sol, impresión). Negro sobre blanco
  /// puro, sin colores decorativos. Que un recibo provisional se distinga del confirmado es responsabilidad de los
  /// componentes de recibo de una feature futura, no de este tema.
  highContrastReceipt,
}

/// Tema común de las apps Kuota (T083; flutter-architecture.md: `design_system`).
///
/// Material 3 con un único color semilla. Las apps solo usan [KuotaTheme.of]; no definen colores propios.
abstract final class KuotaTheme {
  /// Color de marca provisional (no hay manual de marca aprobado todavía).
  static const seed = Color(0xFF1F5FAD);

  static ThemeData of(KuotaThemeVariant variant) => switch (variant) {
    KuotaThemeVariant.light => light(),
    KuotaThemeVariant.dark => dark(),
    KuotaThemeVariant.highContrastReceipt => highContrastReceipt(),
  };

  static ThemeData light() => ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: seed));

  static ThemeData dark() => ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark),
  );

  /// Negro sobre blanco (contraste 21:1), bordes negros y texto en negrita.
  static ThemeData highContrastReceipt() {
    const black = Color(0xFF000000);
    const white = Color(0xFFFFFFFF);
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: black,
      onPrimary: white,
      secondary: black,
      onSecondary: white,
      error: Color(0xFF8B0000),
      onError: white,
      surface: white,
      onSurface: black,
      outline: black,
    );
    final base = ThemeData(useMaterial3: true, colorScheme: scheme);
    final text = base.textTheme.apply(bodyColor: black, displayColor: black);
    TextStyle? bold(TextStyle? style) => style?.copyWith(fontWeight: FontWeight.w700);
    return base.copyWith(
      scaffoldBackgroundColor: white,
      dividerTheme: const DividerThemeData(color: black, thickness: 1),
      textTheme: text.copyWith(
        displayLarge: bold(text.displayLarge),
        displayMedium: bold(text.displayMedium),
        displaySmall: bold(text.displaySmall),
        headlineLarge: bold(text.headlineLarge),
        headlineMedium: bold(text.headlineMedium),
        headlineSmall: bold(text.headlineSmall),
        titleLarge: bold(text.titleLarge),
        titleMedium: bold(text.titleMedium),
        titleSmall: bold(text.titleSmall),
        bodyLarge: bold(text.bodyLarge),
        bodyMedium: bold(text.bodyMedium),
        bodySmall: bold(text.bodySmall),
        labelLarge: bold(text.labelLarge),
        labelMedium: bold(text.labelMedium),
        labelSmall: bold(text.labelSmall),
      ),
    );
  }
}
