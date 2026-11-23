import 'package:app_shell/app_shell.dart';

import 'src/app_info.dart';

/// Kuota Client (T085, T098). Se ejecuta con `--dart-define-from-file=../../config/<entorno>.json` (AppConfig, shared_core). El
/// arranque, la configuración, el cliente y la pantalla de inicio son los de `app_shell`; aquí solo vive la identidad.
void main() => runKuotaApp(AppInfo.identity);
