import { describe, expect, it } from 'vitest';
import { normalizeCapacitorSpm } from './normalize-capacitor-spm.mjs';

describe('normalizeCapacitorSpm', () => {
  it('converts Windows plugin paths to valid SwiftPM paths', () => {
    const source =
      '.package(name: "CapacitorShare", path: "..\\..\\..\\node_modules\\@capacitor\\share")';

    expect(normalizeCapacitorSpm(source)).toBe(
      '.package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share")',
    );
  });

  it('does not alter remote package URLs or unrelated Swift', () => {
    const source =
      '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0")';
    expect(normalizeCapacitorSpm(source)).toBe(source);
  });
});
