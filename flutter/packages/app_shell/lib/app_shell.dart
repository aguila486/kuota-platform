/// Composición Flutter compartida por Kuota Admin, Kuota Collector y Kuota Client (T098; Aprobación 11).
///
/// Cada app solo declara su identidad ([AppIdentity]) y arranca con [runKuotaApp]. Aquí viven los providers de
/// configuración, cliente y compatibilidad, la traducción a [StartupStatus] y el shell con la página de inicio.
library;

export 'package:api_client/api_client.dart' show KuotaApp;

export 'src/app_identity.dart';
export 'src/providers.dart';
export 'src/shell.dart';
