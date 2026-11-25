import { describe, expect, it } from 'vitest';
import { isSupported, parseAppVersion } from '../../../src/modules/meta/app-version.js';

describe('X-App-Version (T029)', () => {
  it('parsea <app>/<X.Y.Z>[+build]', () => {
    expect(parseAppVersion('collector/1.4.2+120')).toEqual({ app: 'collector', version: [1, 4, 2] });
    expect(parseAppVersion('admin/0.1.0')).toEqual({ app: 'admin', version: [0, 1, 0] });
    for (const bad of [
      '',
      'collector/1.4',
      'collector/1.4.2+',
      'collector/1.4.2-rc.1',
      'x/1.0.0',
      'collector/1.4.2 ',
    ]) {
      expect(parseAppVersion(bad), bad).toBeNull();
    }
  });

  it('compara numéricamente e ignora el build', () => {
    expect(isSupported([1, 10, 0], '1.9.0')).toBe(true);
    expect(isSupported([1, 9, 0], '1.10.0')).toBe(false);
    expect(isSupported([2, 0, 0], '2.0.0+99')).toBe(true);
    expect(isSupported([1, 99, 99], '2.0.0')).toBe(false);
    expect(() => isSupported([1, 0, 0], 'no-semver')).toThrow();
  });
});
