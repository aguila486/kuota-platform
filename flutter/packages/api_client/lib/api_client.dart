/// Cliente de Kuota Core para las apps Kuota (T070).
///
/// API pública: [KuotaApiClient] (configuración, interceptores de `X-Correlation-Id` y `X-App-Version`, errores como
/// `Result`) y los DTO generados de las operaciones públicas del contrato. El código de `src/generated/` se genera desde
/// el bundle de CLIENTE (`scripts/contracts/generate-dart-client.sh`), que excluye las operaciones técnicas
/// (`x-kuota-non-production`, dev-probe): las apps no pueden invocarlas.
library;

export 'src/generated/generated.dart'
    show
        CompatibilityInfo,
        CompatibilityInfoMinSupported,
        DependencyStatus,
        LivenessStatus,
        Problem,
        ProblemErrorsInner,
        ReadinessStatus,
        ReadinessStatusChecks;
export 'src/headers.dart'
    show AppVersion, AppVersionInterceptor, CorrelationIdInterceptor, KuotaApp, KuotaHeaders, isUuid, newCorrelationId;
export 'src/kuota_api_client.dart';
