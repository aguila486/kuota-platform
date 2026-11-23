/** `X-App-Version` (contrato `AppVersion`): `<app>/<X.Y.Z>[+build]`. Lógica pura, sin framework. */
export const APP_NAMES = ['admin', 'collector', 'client'] as const;
export type AppName = (typeof APP_NAMES)[number];

const APP_VERSION = /^(admin|collector|client)\/(\d+)\.(\d+)\.(\d+)(?:\+\d+)?$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:\+\d+)?$/;

export interface AppVersion {
  readonly app: AppName;
  readonly version: readonly [number, number, number];
}

/** Devuelve la versión o `null` si el formato no es válido. */
export function parseAppVersion(header: string): AppVersion | null {
  const match = APP_VERSION.exec(header);
  if (!match) return null;
  return { app: match[1] as AppName, version: [Number(match[2]), Number(match[3]), Number(match[4])] };
}

/** `true` si `version` ≥ `minimum` (semver X.Y.Z; el build no cuenta para la compatibilidad). */
export function isSupported(version: readonly [number, number, number], minimum: string): boolean {
  const match = SEMVER.exec(minimum);
  if (!match) throw new Error('Versión mínima no válida (la configuración debió rechazarla)');
  const min = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < 3; i++) {
    if (version[i]! !== min[i]!) return version[i]! > min[i]!;
  }
  return true;
}
