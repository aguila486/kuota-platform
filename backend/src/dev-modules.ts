import type { DynamicModule, Type } from '@nestjs/common';
import { DevProbeModule } from './modules/dev-probe/index.js';

/**
 * Módulos técnicos de desarrollo y pruebas (FR-040; Constitución §II, mecanismos técnicos de desarrollo).
 * `AppModule` los registra SOLO si `KUOTA_ENV ∈ {local, testing}` y `KUOTA_DEV_TENANT_CONTEXT=enabled`; fuera de esos
 * entornos ni siquiera se importan en el contenedor de Nest, así que sus rutas no existen.
 *
 * Hoy: `dev-probe` (T040–T042; ausencia fuera de local/testing probada en T096).
 */
export const DEV_ONLY_MODULES: ReadonlyArray<Type | DynamicModule> = [DevProbeModule];
