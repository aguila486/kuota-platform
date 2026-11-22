import type { DynamicModule, Type } from '@nestjs/common';

/**
 * Módulos técnicos de desarrollo y pruebas (FR-040; Constitución §II, mecanismos técnicos de desarrollo).
 * `AppModule` los registra SOLO si `KUOTA_ENV ∈ {local, testing}` y `KUOTA_DEV_TENANT_CONTEXT=enabled`; fuera de esos
 * entornos ni siquiera se importan en el contenedor de Nest, así que sus rutas no existen.
 *
 * Vacío a propósito en G5: el módulo `dev-probe` se crea en G7 (T040–T042) y se añade aquí entonces.
 */
export const DEV_ONLY_MODULES: ReadonlyArray<Type | DynamicModule> = [];
