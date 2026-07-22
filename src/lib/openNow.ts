import type { WeeklyHours } from '@/types';

/**
 * Compute whether a bar is open at `now`, entirely client-side, from its stored
 * weekly hours + the current time in America/New_York. This is what keeps the
 * Places API bill at $0: hours are fetched once per weekly refresh and stored;
 * "open now" is derived here on every render — never a live API call.
 *
 * Returns `null` when hours are unknown (the UI should show nothing rather than
 * a misleading "closed").
 */
export function isOpenNow(hours: WeeklyHours | undefined, now: Date): boolean | null {
  if (!hours) return null;

  const { day, minutes } = nycNow(now);
  const yesterday = (day + 6) % 7;

  // A window on `day` that closes after it opens is same-day; one that closes
  // before it opens runs past midnight, so its evening portion counts today.
  for (const r of hours[day] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close > open) {
      if (minutes >= open && minutes < close) return true;
    } else if (minutes >= open) {
      return true; // overnight window, evening portion
    }
  }

  // Yesterday's overnight window can still be open in the early morning today.
  for (const r of hours[yesterday] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close <= open && minutes < close) return true; // overnight window, morning portion
  }

  return false;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

/** Day-of-week (0=Sun) and minutes-since-midnight in America/New_York for `now`. */
function nycNow(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(get('hour'), 10) % 24; // some engines emit "24" at midnight
  const minute = parseInt(get('minute'), 10);
  return { day: DAYS[get('weekday')] ?? 0, minutes: hour * 60 + minute };
}
