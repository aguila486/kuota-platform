/// Entorno de ejecución de una app Kuota. Coincide con `KUOTA_ENV` del backend (`local`, `testing`, `staging`,
/// `production`).
enum KuotaEnvironment {
  local,
  testing,
  staging,
  production;

  /// Entornos de desarrollo: admiten HTTP sin TLS hacia el servicio central.
  bool get isDevelopment => this == local || this == testing;
}

/// Configuración inválida o ausente. Indica el campo y el motivo, nunca el valor recibido (puede ser sensible).
final class AppConfigError extends Error {
  AppConfigError(this.field, this.reason);

  final String field;
  final String reason;

  @override
  String toString() => 'AppConfigError: $field: $reason';
}

/// Configuración de una app por entorno (T081; R-19).
///
/// Se inyecta en compilación con `--dart-define-from-file=config/<env>.json` (T085 crea esos archivos), y se lee con
/// [AppConfig.fromEnvironment]. Esos valores quedan **dentro del binario**: aquí solo van datos públicos (entorno,
/// URL del servicio central), **nunca secretos** (tokens, claves, credenciales).
///
/// Reglas:
/// - `KUOTA_ENV` obligatorio, uno de [KuotaEnvironment].
/// - `KUOTA_API_BASE_URL` obligatorio: URL absoluta `http`/`https`, sin usuario ni contraseña, sin query ni fragmento.
///   `http` solo en `local`/`testing`; `staging` y `production` exigen `https`.
final class AppConfig {
  const AppConfig._({required this.environment, required this.apiBaseUrl});

  /// Clave del entorno en el archivo de `--dart-define-from-file`.
  static const environmentKey = 'KUOTA_ENV';

  /// Clave de la URL base del servicio central (Kuota Core).
  static const apiBaseUrlKey = 'KUOTA_API_BASE_URL';

  final KuotaEnvironment environment;
  final Uri apiBaseUrl;

  /// Lee la configuración inyectada en compilación (`--dart-define` / `--dart-define-from-file`).
  factory AppConfig.fromEnvironment() => AppConfig.fromValues(const {
    environmentKey: String.fromEnvironment(environmentKey),
    apiBaseUrlKey: String.fromEnvironment(apiBaseUrlKey),
  });

  /// Valida y construye la configuración a partir de pares clave/valor. Lanza [AppConfigError] si no es válida.
  factory AppConfig.fromValues(Map<String, String> values) {
    final environment = _parseEnvironment(values[environmentKey] ?? '');
    final apiBaseUrl = _parseApiBaseUrl(values[apiBaseUrlKey] ?? '', environment);
    return AppConfig._(environment: environment, apiBaseUrl: apiBaseUrl);
  }

  static KuotaEnvironment _parseEnvironment(String raw) {
    if (raw.isEmpty) throw AppConfigError(environmentKey, 'obligatorio');
    for (final environment in KuotaEnvironment.values) {
      if (environment.name == raw) return environment;
    }
    throw AppConfigError(environmentKey, 'debe ser local, testing, staging o production');
  }

  static Uri _parseApiBaseUrl(String raw, KuotaEnvironment environment) {
    if (raw.isEmpty) throw AppConfigError(apiBaseUrlKey, 'obligatorio');
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.isAbsolute || uri.host.isEmpty || !(uri.isScheme('http') || uri.isScheme('https'))) {
      throw AppConfigError(apiBaseUrlKey, 'debe ser una URL absoluta http o https');
    }
    if (uri.userInfo.isNotEmpty) throw AppConfigError(apiBaseUrlKey, 'no debe contener credenciales');
    if (uri.hasQuery || uri.hasFragment) throw AppConfigError(apiBaseUrlKey, 'no debe contener query ni fragmento');
    if (uri.isScheme('http') && !environment.isDevelopment) {
      throw AppConfigError(apiBaseUrlKey, 'staging y production exigen https');
    }
    return uri;
  }

  @override
  String toString() => 'AppConfig(environment: ${environment.name}, apiBaseUrl: $apiBaseUrl)';
}
