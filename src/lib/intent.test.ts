import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearIntent,
  isSameNight,
  loadIntent,
  nightOf,
  setIntent,
  wasOutLastNight,
} from '@/lib/intent';

const KEY = 'next-bar:intent:v1';

// Local-time strings (no Z) so assertions don't depend on the runner's TZ.
const FRI_10PM = '2026-07-24T22:00:00';
const SAT_1AM = '2026-07-25T01:00:00';
const SAT_5AM = '2026-07-25T05:00:00';
const SAT_9PM = '2026-07-25T21:00:00';

describe('nightOf', () => {
  it('maps an evening to its own date', () => {
    expect(nightOf(FRI_10PM)).toBe('2026-07-24');
  });

  it('rolls the small hours back to the previous night', () => {
    expect(nightOf(SAT_1AM)).toBe('2026-07-24');
  });

  it('starts a fresh night at 5am', () => {
    expect(nightOf(SAT_5AM)).toBe('2026-07-25');
  });
});

describe('isSameNight', () => {
  it('treats Friday 10pm and Saturday 1am as one night out', () => {
    expect(isSameNight(FRI_10PM, new Date(SAT_1AM))).toBe(true);
  });

  it('treats Friday night and Saturday night as different nights', () => {
    expect(isSameNight(FRI_10PM, new Date(SAT_9PM))).toBe(false);
  });
});

describe('intent storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty, round-trips a status, and clears', () => {
    expect(loadIntent()).toBeNull();
    setIntent('going');
    expect(loadIntent()?.status).toBe('going');
    setIntent('maybe');
    expect(loadIntent()?.status).toBe('maybe');
    clearIntent();
    expect(loadIntent()).toBeNull();
  });

  it('expires an intent from a previous night', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'going', setAt: FRI_10PM }),
    );
    // Still same night at 1am…
    expect(loadIntent(new Date(SAT_1AM))?.status).toBe('going');
    // …gone by the next evening.
    expect(loadIntent(new Date(SAT_9PM))).toBeNull();
  });

  it('expires exactly at the 5am boundary mid-session (F5 rollover)', () => {
    // Set in the small hours (still Friday night)…
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'going', setAt: '2026-07-25T04:30:00' }),
    );
    // …still visible one second before the rollover…
    expect(
      loadIntent(new Date('2026-07-25T04:59:59'))?.status,
    ).toBe('going');
    // …and gone the moment the clock hits 5am, without any write.
    expect(loadIntent(new Date('2026-07-25T05:00:00'))).toBeNull();
  });

  it('returns null on corrupted or unknown-status storage', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadIntent()).toBeNull();
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'raving', setAt: FRI_10PM }),
    );
    expect(loadIntent()).toBeNull();
  });
});

describe('wasOutLastNight (E2.4 nightPhase input)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const SAT_9AM = new Date('2026-07-25T09:00:00');
  const SUN_9AM = new Date('2026-07-26T09:00:00');

  it('true the morning after a committed night (here / going)', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: FRI_10PM }),
    );
    expect(wasOutLastNight(SAT_9AM)).toBe(true);
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'going', setAt: FRI_10PM }),
    );
    expect(wasOutLastNight(SAT_9AM)).toBe(true);
  });

  it("small-hours intents count toward the night they belong to", () => {
    // Set at Sat 1am = Friday's night — Saturday morning is "the morning after".
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: SAT_1AM }),
    );
    expect(wasOutLastNight(SAT_9AM)).toBe(true);
  });

  it("'maybe' is not a night out", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'maybe', setAt: FRI_10PM }),
    );
    expect(wasOutLastNight(SAT_9AM)).toBe(false);
  });

  it('false when the intent is older than last night, unset, or corrupt', () => {
    expect(wasOutLastNight(SAT_9AM)).toBe(false);
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: FRI_10PM }),
    );
    expect(wasOutLastNight(SUN_9AM)).toBe(false); // two mornings later
    window.localStorage.setItem(KEY, '{not json');
    expect(wasOutLastNight(SAT_9AM)).toBe(false);
  });

  it('crosses month and year boundaries with calendar math', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: '2026-07-31T23:00:00' }),
    );
    expect(wasOutLastNight(new Date('2026-08-01T09:00:00'))).toBe(true);
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: '2026-12-31T23:00:00' }),
    );
    expect(wasOutLastNight(new Date('2027-01-01T09:00:00'))).toBe(true);
  });

  // DST regression (review finding): the 24h-in-ms subtraction this
  // replaced lands an hour early on the spring-forward Sunday and crosses
  // the 5am rollover for the 5:00–5:59am window. Only reproducible on a
  // runner whose local zone observes US DST, so gate on that.
  const observesUsDst =
    new Date('2026-03-08T05:30:00').getTime() -
      new Date('2026-03-07T05:30:00').getTime() ===
    23 * 60 * 60 * 1000;
  it.runIf(observesUsDst)(
    'spring-forward Sunday 5am hour still sees last night (DST regression)',
    () => {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ status: 'here', setAt: '2026-03-07T23:00:00' }),
      );
      expect(wasOutLastNight(new Date('2026-03-08T05:30:00'))).toBe(true);
    },
  );

  it("tonight's own intent does not read as LAST night", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: FRI_10PM }),
    );
    // Still Friday night (1am): the intent is TONIGHT's, not last night's.
    expect(wasOutLastNight(new Date(SAT_1AM))).toBe(false);
  });
});
