import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../common/config/app-config.js';
import { KuotaProblemError } from '../../common/errors/problem.js';
import { isSupported, parseAppVersion } from './app-version.js';

/** Contrato: `CompatibilityInfo` (esquema cerrado; nunca refleja encabezados). */
export interface CompatibilityInfo {
  readonly api_version: string;
  readonly min_supported: { readonly admin: string; readonly collector: string; readonly client: string };
  readonly client_supported: boolean | null;
  readonly server_time: string;
}

/** `GET /v1/meta/compatibility` (T029). Público: las apps lo consultan antes de autenticarse (FR-007, FR-040). */
@Controller('meta')
export class CompatibilityController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('compatibility')
  compatibility(@Headers('x-app-version') appVersion?: string): CompatibilityInfo {
    let clientSupported: boolean | null = null;
    if (appVersion !== undefined) {
      const parsed = parseAppVersion(appVersion);
      if (!parsed) {
        throw new KuotaProblemError('validation-error', {
          errors: [{ field: 'X-App-Version', message: 'Formato esperado <admin|collector|client>/<X.Y.Z>[+build]' }],
        });
      }
      clientSupported = isSupported(parsed.version, this.config.minSupported[parsed.app]);
    }
    const { admin, collector, client } = this.config.minSupported;
    return {
      api_version: this.config.apiVersion,
      min_supported: { admin, collector, client },
      client_supported: clientSupported,
      server_time: new Date().toISOString(),
    };
  }
}
