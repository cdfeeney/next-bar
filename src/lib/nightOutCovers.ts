/**
 * S-06b / S-06c — the bundled cover templates and the `night_outs.cover` value shape.
 *
 * `cover` is NULL, `template:<key>` (a file under `public/covers/`), or — since
 * 0082 — `media:<uuid>` (a photo the owner uploaded through `/api/media/upload`,
 * read back through `/api/media/:id/url`). The six templates are DRAFTS the
 * owner swaps later (owner, 2026-09-14): keep the keys stable and replace the
 * files. A value this module does not recognise renders as "no cover", which is
 * what keeps a build that predates a shape from breaking the plan surfaces.
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
/** Same alphabet and length the server accepts (0082). */
const MEDIA_RE = /^media:([0-9a-f-]{36})$/;

/** The stored value for a template. */
export function templateCoverValue(key: string): string {
  return `template:${key}`;
}

/** S-06c: the stored value for a library upload. */
export function mediaCoverValue(mediaId: string): string {
  return `media:${mediaId}`;
}

export type CoverSource =
  | { kind: 'template'; template: CoverTemplate }
  | { kind: 'media'; mediaId: string };

/** What a stored `cover` names, or null for none / unrecognised. */
export function coverSourceOf(cover: string | null | undefined): CoverSource | null {
  if (typeof cover !== 'string') return null;
  const t = TEMPLATE_RE.exec(cover);
  if (t !== null) {
    const template = COVER_TEMPLATES.find((c) => c.key === t[1]);
    return template ? { kind: 'template', template } : null;
  }
  const m = MEDIA_RE.exec(cover);
  return m !== null ? { kind: 'media', mediaId: m[1] } : null;
}

/** The template a stored `cover` names, or null for none / a media cover / unrecognised. */
export function coverTemplateOf(cover: string | null | undefined): CoverTemplate | null {
  const source = coverSourceOf(cover);
  return source?.kind === 'template' ? source.template : null;
}
