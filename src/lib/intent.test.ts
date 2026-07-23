import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearIntent,
  isSameNight,
  loadIntent,
  nightOf,
  setIntent,
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
