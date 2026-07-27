/**
 * Tonight intent — blueprint B2 live-intent signals ("going / maybe /
 * here now"), the discovery→coordination converter.
 *
 * Friends-only by design (surfaced on /friends, never public). Local-only
 * for now: your own intent lives in localStorage, mirroring
 * src/lib/ratings.ts; friends' intents are seeded demo data until the D1
 * Supabase pass syncs real ones.
 *
 * An intent is only meaningful for ONE night out, so reads expire stale
 * entries. A "night" runs until NIGHT_ROLLOVER_HOUR (5am local): Friday
 * 10pm and Saturday 1am are the same night, Saturday evening is not.
 */

export type IntentStatus = 'going' | 'maybe' | 'here' | 'not-going';

export type TonightIntent = {
  status: IntentStatus;
  setAt: string; // ISO timestamp
};

const KEY = 'next-bar:intent:v1';

/** Small-hours cutoff: before this local hour you're still on last night. */
const NIGHT_ROLLOVER_HOUR = 5;

const VALID_STATUSES: ReadonlySet<IntentStatus> = new Set<IntentStatus>([
  'going',
  'maybe',
  'here',
  'not-going',
]);

function isIntentStatus(value: unknown): value is IntentStatus {
  return (
    typeof value === 'string' && VALID_STATUSES.has(value as IntentStatus)
  );
}

function isTonightIntent(value: unknown): value is TonightIntent {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return isIntentStatus(obj.status) && typeof obj.setAt === 'string';
}

/**
 * The calendar date (YYYY-MM-DD, local time) of the night an instant
 * belongs to — small hours roll back to the previous date.
 */
export function nightOf(iso: string): string {
  const date = new Date(iso);
  if (date.getHours() < NIGHT_ROLLOVER_HOUR) {
    date.setDate(date.getDate() - 1);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isSameNight(iso: string, now: Date): boolean {
  return nightOf(iso) === nightOfDate(now);
}

// nightOf for a Date we already hold — works off local fields directly
// (round-tripping through toISOString would shift the night in non-UTC TZs).
function nightOfDate(date: Date): string {
  const copy = new Date(date.getTime());
  if (copy.getHours() < NIGHT_ROLLOVER_HOUR) {
    copy.setDate(copy.getDate() - 1);
  }
  const y = copy.getFullYear();
  const m = String(copy.getMonth() + 1).padStart(2, '0');
  const d = String(copy.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  } catch {
    // Ignore — some environments may not support StorageEvent constructor.
  }
}

/** Your current intent, or null if unset, stale (previous night), or corrupt. */
export function loadIntent(now: Date = new Date()): TonightIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isTonightIntent(parsed)) return null;
    if (!isSameNight(parsed.setAt, now)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// The calendar day before a YYYY-MM-DD night date. Pure Date.UTC calendar
// math — a raw 24h-in-ms subtraction lands one local hour early on the
// spring-forward Sunday and can cross the 5am rollover (review finding),
// misreading "last night" for the 5:00–5:59am window that morning.
function previousNightDate(night: string): string {
  const [y, m, d] = night.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(prev.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

/**
 * Did LAST night involve going out? True when the stored intent belongs
 * to the previous night and was a commitment ('going' or 'here') —
 * 'maybe' and 'not-going' never count. nightPhase's morning branch uses this to pick
 * recap over planning (E0.3); the E4 Night object will replace it as
 * the source of truth.
 */
export function wasOutLastNight(now: Date = new Date()): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (!isTonightIntent(parsed)) return false;
    // Positive guard: only the two commitments count as a night out —
    // an allowlist can't silently admit future statuses ('not-going'
    // would have slipped through the old "non-maybe" check).
    if (parsed.status !== 'going' && parsed.status !== 'here') return false;
    return nightOf(parsed.setAt) === previousNightDate(nightOfDate(now));
  } catch {
    return false;
  }
}

export function setIntent(status: IntentStatus): void {
  if (typeof window === 'undefined') return;
  const intent: TonightIntent = {
    status,
    setAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    // Ignore quota / private-mode errors silently.
  }
  notifyChange();
}

export function clearIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
  notifyChange();
}
