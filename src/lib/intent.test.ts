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

// ABSOLUTE instants (Z), never local-time strings: the rollover is defined in
// America/New_York, so a bare timestamp means a different NYC wall clock on
// every runner. July is EDT (UTC-4) — NYC wall clock + 4h = the Z value.
const FRI_10PM = '2026-07-25T02:00:00Z'; // Fri 10pm NYC
const SAT_1AM = '2026-07-25T05:00:00Z'; // Sat 1am NYC — still Friday night
const SAT_6AM = '2026-07-25T10:00:00Z'; // Sat 6am NYC — the rollover instant
const SAT_9PM = '2026-07-26T01:00:00Z'; // Sat 9pm NYC

describe('nightOf', () => {
  it('maps an evening to its own date', () => {
    expect(nightOf(FRI_10PM)).toBe('2026-07-24');
  });

  it('rolls the small hours back to the previous night', () => {
    expect(nightOf(SAT_1AM)).toBe('2026-07-24');
  });

  it('starts a fresh night at 6am NYC', () => {
    expect(nightOf(SAT_6AM)).toBe('2026-07-25');
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

  it("round-trips 'not-going' (QA4 third pill)", () => {
    setIntent('not-going');
    expect(loadIntent()?.status).toBe('not-going');
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

  it('expires exactly at the 6am NYC boundary mid-session (F5 rollover)', () => {
    // Set in the small hours, 4:30am NYC (still Friday night)…
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'going', setAt: '2026-07-25T08:30:00Z' }),
    );
    // …still visible one second before the rollover (5:59:59am NYC)…
    expect(
      loadIntent(new Date('2026-07-25T09:59:59Z'))?.status,
    ).toBe('going');
    // …and gone the moment the clock hits 6am NYC, without any write.
    expect(loadIntent(new Date('2026-07-25T10:00:00Z'))).toBeNull();
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

  // Absolute instants like the rest of this file: July is EDT (UTC-4), so
  // 9am NYC is 13:00Z. Bare local strings made these assertions depend on the
  // runner's zone once the rollover moved to America/New_York.
  const SAT_9AM = new Date('2026-07-25T13:00:00Z'); // Sat 9am NYC
  const SUN_9AM = new Date('2026-07-26T13:00:00Z'); // Sun 9am NYC

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

  it("'not-going' is not a night out (guard allowlists going/here)", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'not-going', setAt: FRI_10PM }),
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
      // Fri 2026-07-31 11pm NYC (EDT, UTC-4) — July's last night.
      JSON.stringify({ status: 'here', setAt: '2026-08-01T03:00:00Z' }),
    );
    // Sat 2026-08-01 9am NYC — the morning after, one month later.
    expect(wasOutLastNight(new Date('2026-08-01T13:00:00Z'))).toBe(true);
    window.localStorage.setItem(
      KEY,
      // Thu 2026-12-31 11pm NYC (EST, UTC-5) — the year's last night.
      JSON.stringify({ status: 'here', setAt: '2027-01-01T04:00:00Z' }),
    );
    // Fri 2027-01-01 9am NYC (EST) — the morning after, one year later.
    expect(wasOutLastNight(new Date('2027-01-01T14:00:00Z'))).toBe(true);
  });

  // DST regression (review finding): a raw 24h-in-ms subtraction lands an hour
  // early on the spring-forward Sunday and crosses the rollover, misreading
  // "last night" for the first morning hour. 2026-03-08 is the US spring
  // forward (2am EST → 3am EDT), so this Sunday is a 23-hour day.
  //
  // No longer gated on the runner's zone: every instant here is absolute and
  // the rollover is resolved in NYC by Intl, so this reproduces everywhere.
  it('spring-forward Sunday morning still sees last night (DST regression)', () => {
    window.localStorage.setItem(
      KEY,
      // Sat 2026-03-07 11pm NYC (EST, UTC-5) — Saturday night.
      JSON.stringify({ status: 'here', setAt: '2026-03-08T04:00:00Z' }),
    );
    // Sun 6:30am NYC (EDT, UTC-4) — past the rollover, so Saturday is now
    // LAST night. Crossing that day boundary is what the DST bug got wrong.
    expect(wasOutLastNight(new Date('2026-03-08T10:30:00Z'))).toBe(true);
  });

  it("tonight's own intent does not read as LAST night", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ status: 'here', setAt: FRI_10PM }),
    );
    // Still Friday night (1am): the intent is TONIGHT's, not last night's.
    expect(wasOutLastNight(new Date(SAT_1AM))).toBe(false);
  });
});
