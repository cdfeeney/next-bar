/**
 * S-06b — the bundled cover templates and the `night_outs.cover` value shape.
 *
 * `cover` is NULL or `template:<key>`; `<key>` names a file under
 * `public/covers/`. The six templates are DRAFTS the owner swaps later (owner,
 * 2026-09-14): keep the keys stable and replace the files. A value this module
 * does not recognise renders as "no cover" — that is what keeps a future
 * `media:<uuid>` value (library uploads, a later migration) from breaking the
 * plan surfaces on a build that predates it.
 */

export type CoverTemplate = { key: string; label: string; src: string };

export const COVER_TEMPLATES: readonly CoverTemplate[] = [
  { key: 'neon-night', label: 'Neon night', src: '/covers/neon-night.svg' },
  { key: 'rooftop', label: 'Rooftop', src: '/covers/rooftop.svg' },
  { key: 'dive-bar', label: 'Dive bar', src: '/covers/dive-bar.svg' },
  { key: 'birthday', label: 'Birthday', src: '/covers/birthday.svg' },
  { key: 'first-round', label: 'First round', src: '/covers/first-round.svg' },
  { key: 'last-call', label: 'Last call', src: '/covers/last-call.svg' },
];

const TEMPLATE_RE = /^template:([a-z0-9-]{1,40})$/;

/** The stored value for a template. */
export function templateCoverValue(key: string): string {
  return `template:${key}`;
}

/** The template a stored `cover` names, or null for none / unrecognised. */
export function coverTemplateOf(cover: string | null | undefined): CoverTemplate | null {
  if (typeof cover !== 'string') return null;
  const m = TEMPLATE_RE.exec(cover);
  if (m === null) return null;
  return COVER_TEMPLATES.find((t) => t.key === m[1]) ?? null;
}
