import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * NB-01: the Google Places UI Kit compact element is themed to the app's
 * dark surface through Google's documented custom properties, with
 * color-scheme pinned so it never flips to the light palette. This pins
 * the rule so a stylesheet cleanup cannot silently bring the white block
 * back. (Attribution/Maps visibility is covered by GooglePlacePhoto tests.)
 */
describe('globals.css — Places UI Kit theme', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const block = css.match(/gmp-place-details-compact\s*\{([^}]*)\}/)?.[1] ?? '';

  test('themes the compact element dark with the documented properties', () => {
    expect(block).toMatch(/color-scheme:\s*dark/);
    for (const prop of [
      '--gmp-mat-color-surface',
      '--gmp-mat-color-on-surface',
      '--gmp-mat-color-on-surface-variant',
      '--gmp-mat-color-primary',
      '--gmp-mat-font-family',
    ]) {
      expect(block).toContain(prop);
    }
    // Surface must not be white in any spelling.
    expect(block).not.toMatch(/--gmp-mat-color-surface:\s*(#fff|#ffffff|white)/i);
  });
});
