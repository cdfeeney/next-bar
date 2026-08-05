import type { WeeklyHours } from '@/types';
import { parseOsmOpeningHours } from '@/lib/osmOpeningHours';

/**
 * Extract opening hours from a venue's own web page.
 *
 * Tiered by how much the page actually TELLS us, in descending order of trust:
 *
 *   jsonld      schema.org openingHoursSpecification — explicit days and times,
 *               machine-authored. The only tier we treat as reliable.
 *   schema-text schema.org `openingHours` in its text form ("Mo-Fr 17:00-02:00").
 *               Identical grammar to OSM, so it REUSES osmOpeningHours rather
 *               than growing a second dialect with its own bugs.
 *   needs_human hours are visibly on the page, but only as prose.
 *
 * Freeform prose is deliberately NOT parsed. There is no DOM parser in this
 * project, and regex over arbitrary marketing HTML is precisely where "5-2"
 * becomes 05:00 instead of 17:00, or where "Kitchen 5-10, Bar 5-2" yields the
 * kitchen's hours. So prose is routed to a human WITH the matching snippets as
 * evidence — a venue we cannot read confidently is a venue we say nothing about,
 * and the hints make that queue actionable rather than a dead end.
 */

export type SiteHoursTier = 'jsonld' | 'schema-text';

export type SiteHoursResult =
  | { outcome: 'parsed'; hours: WeeklyHours; tier: SiteHoursTier }
  | { outcome: 'needs_human'; reason: string; hints: string[] }
  | { outcome: 'none'; reason: string };

type Interval = { open: string; close: string };

const DAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const LD_BLOCK_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Max prose snippets handed to a human, so one noisy page cannot flood the queue. */
const MAX_HINTS = 5;

/** `https://schema.org/Monday` | `Monday` | `Mon` → day index, or null. */
function dayIndex(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const leaf = raw.trim().toLowerCase().split('/').pop() ?? '';
  const idx = DAY_INDEX[leaf];
  return idx === undefined ? null : idx;
}

/**
 * `17:00` | `17:00:00` | `24:00` → `HH:MM`, or null.
 *
 * Hours 24–47 roll over, matching the OSM parser: schema.org markup for a bar
 * open until 4am is often authored as `28:00` or `24:00` by the same tooling.
 */
function clock(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  if (hour >= 48) return null;
  if (hour >= 24) hour -= 24;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

/** Flatten a JSON-LD document into every node worth inspecting. */
function flattenNodes(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const v of value) flattenNodes(v, out);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    out.push(obj);
    // @graph is the common wrapper; other nested objects can hold the venue too.
    for (const key of Object.keys(obj)) {
      if (key === '@graph' || Array.isArray(obj[key]) || typeof obj[key] === 'object') {
        flattenNodes(obj[key], out);
      }
    }
  }
  return out;
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const m of html.matchAll(LD_BLOCK_RE)) {
    try {
      nodes.push(...flattenNodes(JSON.parse(m[1])));
    } catch {
      // A malformed block is simply not evidence. Never throw on a hostile page.
    }
  }
  return nodes;
}

/** Build a week from openingHoursSpecification entries. */
function fromSpecifications(nodes: Record<string, unknown>[]): {
  hours: WeeklyHours | null;
  sawSpec: boolean;
} {
  const days: Record<number, Interval[]> = {};
  let sawSpec = false;

  for (const node of nodes) {
    const raw = node.openingHoursSpecification;
    if (raw === undefined || raw === null) continue;
    sawSpec = true;
    const specs = Array.isArray(raw) ? raw : [raw];

    for (const spec of specs) {
      if (spec === null || typeof spec !== 'object') continue;
      const s = spec as Record<string, unknown>;
      // An explicitly closed day is an ABSENT day, never a zero-length window.
      if (s.closed === true) continue;

      const open = clock(s.opens);
      const close = clock(s.closes);
      if (open === null || close === null) continue;

      const dayRaw = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek];
      for (const d of dayRaw) {
        const idx = dayIndex(d);
        if (idx === null) continue;
        (days[idx] ??= []).push({ open, close });
      }
    }
  }

  return {
    hours: Object.keys(days).length > 0 ? (days as unknown as WeeklyHours) : null,
    sawSpec,
  };
}

/** schema.org `openingHours` text form — same grammar as OSM. */
function fromOpeningHoursText(nodes: Record<string, unknown>[]): WeeklyHours | null {
  for (const node of nodes) {
    const raw = node.openingHours;
    if (raw === undefined || raw === null) continue;
    const spec = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string').join('; ') : raw;
    if (typeof spec !== 'string') continue;
    const parsed = parseOsmOpeningHours(spec);
    if (parsed) return parsed;
  }
  return null;
}

const PROSE_TIME_RE =
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\b/gi;

/** Visible text with script/style removed, so JSON-LD cannot create false hints. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function proseHints(html: string): string[] {
  const text = visibleText(html);
  const hints: string[] = [];
  for (const m of text.matchAll(PROSE_TIME_RE)) {
    const at = m.index ?? 0;
    const snippet = text.slice(Math.max(0, at - 35), at + 35).trim();
    if (!hints.includes(snippet)) hints.push(snippet);
    if (hints.length >= MAX_HINTS) break;
  }
  return hints;
}

export function parseSiteHours(html: string): SiteHoursResult {
  if (typeof html !== 'string' || html.trim() === '') {
    return { outcome: 'none', reason: 'empty document' };
  }

  const nodes = jsonLdNodes(html);

  // Tier 1 first: explicit days and times outrank a text form on the same page.
  const { hours: specHours, sawSpec } = fromSpecifications(nodes);
  if (specHours) return { outcome: 'parsed', hours: specHours, tier: 'jsonld' };

  const textHours = fromOpeningHoursText(nodes);
  if (textHours) return { outcome: 'parsed', hours: textHours, tier: 'schema-text' };

  // Structured data was present but unusable — a markup bug on their side, and
  // exactly the case a human should see rather than us silently ignoring it.
  if (sawSpec) {
    return {
      outcome: 'needs_human',
      reason: 'openingHoursSpecification present but no usable day/time survived validation',
      hints: proseHints(html),
    };
  }

  const hints = proseHints(html);
  if (hints.length > 0) {
    return {
      outcome: 'needs_human',
      reason: 'hours appear only as prose; not parsed on purpose',
      hints,
    };
  }

  return { outcome: 'none', reason: 'no structured hours and no hours-like text' };
}
