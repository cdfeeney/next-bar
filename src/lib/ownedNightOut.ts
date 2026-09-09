/**
 * The plan THIS account created tonight — a durable client record for V9-03.
 *
 * Why a second record exists beside StartNightOutButton's parked plan: that one
 * is a create-recovery guard and is SPENT the moment the owner opens the plan
 * (the plan page forgets it so Start cannot re-arm into a duplicate). V9-03
 * needs the opposite lifetime: remembered for the whole night, so the owner
 * can find their plan again from Plans after leaving, reloading or reopening
 * the app on this device. `get_my_night_outs` excludes owned plans (0059:296),
 * so without this the creator has no way back.
 *
 * Keyed by account id and stamped with the night key; entries for other nights
 * are pruned on every write, so the record can never outlive the night it
 * describes. localStorage, with an in-memory fallback when storage is blocked.
 */
const OWNED_KEY = 'next-bar:owned-night-out:v1';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OwnedNightOut = { planId: string; nightKey: string };
type OwnedByUser = Record<string, OwnedNightOut>;

let memory: OwnedByUser = {};

function readAll(): OwnedByUser {
  if (typeof window === 'undefined') return memory;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(OWNED_KEY);
  } catch {
    return memory;
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: OwnedByUser = {};
    for (const [userId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!UUID_RE.test(userId) || typeof value !== 'object' || value === null) continue;
      const { planId, nightKey } = value as Record<string, unknown>;
      if (typeof planId !== 'string' || !UUID_RE.test(planId)) continue;
      if (typeof nightKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nightKey)) continue;
      out[userId] = { planId, nightKey };
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(next: OwnedByUser): void {
  memory = next;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OWNED_KEY, JSON.stringify(next));
  } catch {
    // storage blocked — the in-memory copy still serves this tab
  }
}

function onlyNight(all: OwnedByUser, nightKey: string): OwnedByUser {
  return Object.fromEntries(
    Object.entries(all).filter(([, record]) => record.nightKey === nightKey),
  );
}

/** Record the plan this account created for `nightKey`, replacing any earlier one. */
export function rememberOwnedNightOut(userId: string, record: OwnedNightOut): void {
  if (!UUID_RE.test(userId) || !UUID_RE.test(record.planId)) return;
  writeAll({ ...onlyNight(readAll(), record.nightKey), [userId]: record });
}

/** The plan this account created for `nightKey`, or null. Other nights never answer. */
export function recallOwnedNightOut(userId: string, nightKey: string): OwnedNightOut | null {
  const record = readAll()[userId];
  return record !== undefined && record.nightKey === nightKey ? record : null;
}

/** Drop the record for exactly this plan (cancelled, or gone on the server). */
export function forgetOwnedNightOut(userId: string, planId: string): void {
  const all = readAll();
  const mine = all[userId];
  if (mine === undefined || mine.planId !== planId) return;
  const { [userId]: _drop, ...rest } = all;
  writeAll(rest);
}
