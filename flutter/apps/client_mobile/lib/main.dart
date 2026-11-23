import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'src/app.dart';

/// Kuota Client (T085). Se ejecuta con `--dart-define-from-file=../../config/<entorno>.json` (AppConfig, shared_core).
void main() => runApp(const ProviderScope(child: KuotaShellApp()));
