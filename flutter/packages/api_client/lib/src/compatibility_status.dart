import 'package:shared_core/shared_core.dart';

import 'generated/generated.dart';
import 'kuota_api_client.dart';

/// Estado de compatibilidad de una app con Kuota Core (T085; FR-032), derivado SOLO de una respuesta real de
/// `GET /v1/meta/compatibility`. Nunca se declara compatible sin respuesta válida.
sealed class CompatibilityStatus {
  const CompatibilityStatus();
}

/// El servidor confirmó que esta versión está soportada (`client_supported: true`).
final class Compatible extends CompatibilityStatus {
  const Compatible(this.info);
  final CompatibilityInfo info;
}

/// Esta versión NO está soportada: `client_supported: false`, o el error del contrato `app-version-unsupported` (426).
/// Hay que actualizar la app. [info] solo existe cuando la respuesta fue la de compatibilidad.
final class Incompatible extends CompatibilityStatus {
  const Incompatible({this.info});
  final CompatibilityInfo? info;
}

/// Kuota Core no respondió (red, DNS, TLS, tiempo de espera) o un intermediario indicó que no está disponible
/// (502/503/504 sin problem+json).
final class ApiUnavailable extends CompatibilityStatus {
  const ApiUnavailable(this.failure);
  final Failure failure;
}

/// Respuesta inesperada (error del servidor sin problem+json reconocible, código no previsto o compatibilidad
/// indeterminada).
final class UnexpectedCompatibility extends CompatibilityStatus {
  const UnexpectedCompatibility(this.failure);
  final Failure failure;
}

/// Código del contrato (backend `PROBLEM_CODES`, HTTP 426) para una versión de app no soportada.
const appVersionUnsupported = 'app-version-unsupported';

/// Clasifica el resultado de [KuotaApiClient.getCompatibility].
CompatibilityStatus classifyCompatibility(Result<CompatibilityInfo> result) => switch (result) {
  Ok(:final value) when value.clientSupported == true => Compatible(value),
  Ok(:final value) when value.clientSupported == false => Incompatible(info: value),
  // Se envía siempre X-App-Version: si el servidor no se pronuncia, la compatibilidad es indeterminada, no "sí".
  Ok() => const UnexpectedCompatibility(
    Failure('compatibility-undetermined', message: 'el servidor no indicó si esta versión está soportada'),
  ),
  Err(:final failure) when failure.code == appVersionUnsupported => const Incompatible(),
  Err(:final failure)
      when failure.code == ApiFailureCodes.network || failure.code == ApiFailureCodes.serviceUnavailable =>
    ApiUnavailable(failure),
  Err(:final failure) => UnexpectedCompatibility(failure),
};
