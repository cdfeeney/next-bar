import { describe, expect, test } from 'vitest';
import tailwindConfig from '../../tailwind.config';

/**
 * V8 acceptance criterion 9 asks for contrast to be *validated*, not eyeballed.
 * The locked palette (docs/CLAUDE-DESIGN-RECOVERY-2026-08-12.md) lives in
 * tailwind.config.ts, so read it from there rather than restating it: a token
 * edit that quietly darkens body text or lightens the muted grey fails here.
 *
 * Scope note: this checks the approved token *pairings*. It cannot see a
 * component that invents an unapproved pairing at the call site — the locked
 * convention for the coral fill is dark-on-coral (`bg-accent text-bg`, 6.42:1),
 * because cream-on-coral is only 2.82:1.
 */

const AA_NORMAL_TEXT = 4.5;

const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, string>;

/** WCAG 2.2 relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  const [r, g, b] = channels.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1–21. */
function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe('locked V8 palette', () => {
  test('still carries the recovered token values', () => {
    expect(colors).toMatchObject({
      bg: '#0a0a0a',
      surface: '#141414',
      border: '#2a2a2a',
      accent: '#ff5b3a',
      text: '#f5f5f0',
      muted: '#8a8a85',
    });
  });

  const pairings: ReadonlyArray<readonly [string, string]> = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['muted', 'bg'],
    ['muted', 'surface'],
    ['accent', 'bg'],
    ['accent', 'surface'],
    // The raised "Next Bar?" pill and the active distance chip: dark on coral.
    ['bg', 'accent'],
  ];

  test.each(pairings)('%s on %s meets WCAG AA for body text', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  test('sanity-checks the ratio maths against known WCAG endpoints', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
