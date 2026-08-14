import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * V8-2 continuity guard.
 *
 * `docs/V8-DATA-CONTINUITY-2026-08-14.md` is the inventory of record: every
 * `next-bar:` browser-storage key must have exactly one row there naming its
 * server owner or declaring it local-only. This test makes that document
 * executable in both directions:
 *
 *   src → doc   a new key with no inventory row fails the build (nothing may
 *               ship unaccounted for).
 *   doc → src   an inventoried key that vanished from `src/` fails the build.
 *               That is the mechanical proof that no V7 key was renamed or
 *               quietly dropped — the thing a code review reliably misses.
 *
 * Plus a frozen V7 baseline: the exact keys a V7 install has on disk. Those
 * may never leave `src/` without a tested forward migration, so they are
 * asserted by literal name rather than by whatever the doc happens to say.
 *
 * Only RUNTIME sources count as a key's read path — `*.test.ts` is excluded.
 * Both review lanes caught the same hole here: scanning tests made the
 * doc → src and V7-baseline directions tautological, because this file's own
 * `V7_KEYS` array (and any fixture that seeds a key) kept every literal
 * "present in src/" even after its last production reader was deleted. A
 * guard that cannot fail is worse than no guard, because it is advertised.
 */

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const INVENTORY_DOC = path.join(
  REPO_ROOT,
  'docs',
  'V8-DATA-CONTINUITY-2026-08-14.md',
);

/**
 * `next-bar:`-prefixed strings that are CustomEvent names on `window`, not
 * storage keys. They carry no data at rest, so they get no inventory row —
 * but they must be classified HERE deliberately, or this guard would pass
 * them through as "documented" by accident. Adding a new broadcast means
 * adding it to this list on purpose.
 */
const BROADCAST_EVENTS = [
  'next-bar:ratings:server-update',
  'next-bar:pairwise:local-update',
] as const;

/**
 * The V7 on-disk key set, frozen. An upgrading V7 install has these in
 * localStorage/sessionStorage; renaming or removing one strands real user
 * data. Forward migration is allowed — deletion of the read path is not.
 */
const V7_KEYS = [
  'next-bar:age-ack:v1',
  'next-bar:demo:seeded-ids:v1',
  'next-bar:demo:seeded:v1',
  'next-bar:follows:v1',
  'next-bar:handle-nudge-dismissed:v1',
  'next-bar:install-nudge-dismissed:v1',
  'next-bar:intent:v1',
  'next-bar:list:want-to-go:v1',
  'next-bar:lists:v1',
  'next-bar:night-log:v1',
  'next-bar:night-phase-override:v1',
  'next-bar:night-vibe:v1',
  'next-bar:onboarding-prompted:v1',
  'next-bar:pairwise:merged-for:v1',
  'next-bar:pairwise:v1',
  'next-bar:profile:v1',
  'next-bar:ratings:merged-for:v1',
  'next-bar:ratings:v1',
  'next-bar:saved:v1',
] as const;

/**
 * Keys must appear as a QUOTED string literal. Matching bare text let a key
 * stay "present" via a prose comment, which is the same false-pass the
 * runtime-only scan was meant to close.
 *
 * Known and accepted limitation: a delete-only site (a `removeItem` call, or
 * a wipe list like `accountCache.ALL_KEYS`) is still a literal, so it counts
 * as presence. Distinguishing read from write sites needs real parsing, which
 * is more machinery than this guard earns.
 */
const KEY_PATTERN = /['"`](next-bar:[A-Za-z0-9:_-]+)['"`]/g;

/**
 * A `next-bar` prefix that does NOT continue into a complete literal key —
 * i.e. one assembled by interpolation or concatenation. Neither form is
 * visible to `KEY_PATTERN`, so such a key would bypass the inventory
 * silently. Refuse the construct rather than pretend to cover it.
 */
const COMPUTED_KEY_PATTERN = /next-bar(?::(?![A-Za-z0-9:_-])|['"`]\s*[+,)])/g;

/**
 * Runtime sources only — a test fixture is not a key's read path. `.js`/`.jsx`
 * are included because `allowJs` is on, so a future plain-JS module under
 * `src/` would otherwise be invisible to this guard.
 */
function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFilesUnder(p));
    else if (/\.(tsx?|jsx?)$/.test(p) && !/\.test\.(tsx?|jsx?)$/.test(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Every `next-bar:` literal appearing in runtime code under `src/`. */
function literalsInSrc(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFilesUnder(SRC_DIR)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    for (const match of readFileSync(file, 'utf8').matchAll(KEY_PATTERN)) {
      const where = found.get(match[1]) ?? [];
      if (!where.includes(rel)) where.push(rel);
      found.set(match[1], where);
    }
  }
  return found;
}

/**
 * Keys carrying a SUBSTANTIVE inventory row.
 *
 * Every one of the three cells after the key must be non-blank, so a row can
 * only satisfy the guard by actually naming the storage, the owner, and the
 * continuity rule. Matching on key presence alone let a placeholder row
 * (`| \`next-bar:x:v1\` | | | |`) count as "documented", which is precisely
 * the unaccounted-for key criterion 1 exists to prevent.
 */
function keysInInventory(): string[] {
  const doc = readFileSync(INVENTORY_DOC, 'utf8');
  const rows = doc.matchAll(
    /^\|\s*`(next-bar:[^`]+)`\s*\|\s*\S[^|]*\|\s*\S[^|]*\|\s*\S[^|]*\|/gm,
  );
  return [...rows].map((row) => row[1]);
}

describe('V7→V8 storage-key inventory', () => {
  it('every storage key used in src/ has exactly one inventory row', () => {
    const used = literalsInSrc();
    const storageKeys = [...used.keys()].filter(
      (key) => !BROADCAST_EVENTS.includes(key as (typeof BROADCAST_EVENTS)[number]),
    );
    const inventory = keysInInventory();

    const undocumented = storageKeys
      .filter((key) => !inventory.includes(key))
      .map((key) => `${key} (used in ${used.get(key)!.join(', ')})`);

    expect(
      undocumented,
      `add a row to docs/${path.basename(INVENTORY_DOC)} naming the server owner, or "local-only, never synced"`,
    ).toEqual([]);
  });

  it('no key is inventoried twice', () => {
    const inventory = keysInInventory();
    const duplicated = inventory.filter(
      (key, i) => inventory.indexOf(key) !== i,
    );
    expect(duplicated, 'one row per key — two rows can state two owners').toEqual(
      [],
    );
  });

  it('every inventoried key still exists in src/ (nothing renamed away)', () => {
    const used = literalsInSrc();
    const orphaned = keysInInventory().filter((key) => !used.has(key));
    expect(
      orphaned,
      'an inventoried key vanished from src/ — a rename strands V7 data; ship a forward migration that reads the old key first',
    ).toEqual([]);
  });

  it('every frozen V7 key is still read somewhere in src/', () => {
    const used = literalsInSrc();
    const missing = V7_KEYS.filter((key) => !used.has(key));
    expect(
      missing,
      'V7 installs hold these keys on disk; dropping the read path loses real user data',
    ).toEqual([]);
  });

  it('every frozen V7 key is inventoried', () => {
    const inventory = keysInInventory();
    const missing = V7_KEYS.filter((key) => !inventory.includes(key));
    expect(missing).toEqual([]);
  });

  it('broadcast event names are not inventoried as storage', () => {
    const inventory = keysInInventory();
    const misfiled = BROADCAST_EVENTS.filter((name) => inventory.includes(name));
    expect(
      misfiled,
      'these are window CustomEvent names, not data at rest',
    ).toEqual([]);
  });

  it('every declared broadcast event is actually used in src/', () => {
    const used = literalsInSrc();
    const stale = BROADCAST_EVENTS.filter((name) => !used.has(name));
    expect(stale, 'remove the exemption when the broadcast goes away').toEqual([]);
  });

  it('no storage key is built by interpolation, which the scan cannot see', () => {
    const offenders: string[] = [];
    for (const file of sourceFilesUnder(SRC_DIR)) {
      const src = readFileSync(file, 'utf8');
      if (COMPUTED_KEY_PATTERN.test(src)) {
        offenders.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
      }
      COMPUTED_KEY_PATTERN.lastIndex = 0;
    }
    expect(
      offenders,
      'write the key as one literal — a computed key silently bypasses this inventory',
    ).toEqual([]);
  });
});
