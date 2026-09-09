import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetAllOwnedNightOut,
  forgetOwnedNightOut,
  recallOwnedNightOut,
  rememberOwnedNightOut,
} from './ownedNightOut';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PLAN = '33333333-3333-4333-8333-333333333333';
const PLAN_B = '44444444-4444-4444-8444-444444444444';

describe('ownedNightOut', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('remembers the plan created tonight and recalls it for the same night only', () => {
    rememberOwnedNightOut(USER, { planId: PLAN, nightKey: '2026-07-24' });
    expect(recallOwnedNightOut(USER, '2026-07-24')).toEqual({ planId: PLAN, nightKey: '2026-07-24' });
    expect(recallOwnedNightOut(USER, '2026-07-25')).toBeNull();
    expect(recallOwnedNightOut(OTHER, '2026-07-24')).toBeNull();
  });

  it('prunes other nights on write, so a record never outlives its night', () => {
    rememberOwnedNightOut(USER, { planId: PLAN, nightKey: '2026-07-24' });
    rememberOwnedNightOut(OTHER, { planId: PLAN_B, nightKey: '2026-07-25' });
    expect(recallOwnedNightOut(USER, '2026-07-24')).toBeNull();
    expect(recallOwnedNightOut(OTHER, '2026-07-25')).toEqual({ planId: PLAN_B, nightKey: '2026-07-25' });
  });

  it('forgets exactly the named plan and leaves a different one alone', () => {
    rememberOwnedNightOut(USER, { planId: PLAN, nightKey: '2026-07-24' });
    forgetOwnedNightOut(USER, PLAN_B);
    expect(recallOwnedNightOut(USER, '2026-07-24')).not.toBeNull();
    forgetOwnedNightOut(USER, PLAN);
    expect(recallOwnedNightOut(USER, '2026-07-24')).toBeNull();
  });

  it('the deletion sweep drops only that account, removes the key when nothing is left, and erases what it cannot parse', () => {
    const KEY = 'next-bar:owned-night-out:v1';
    rememberOwnedNightOut(USER, { planId: PLAN, nightKey: '2026-07-24' });
    rememberOwnedNightOut(OTHER, { planId: PLAN_B, nightKey: '2026-07-24' });
    forgetAllOwnedNightOut(USER);
    expect(recallOwnedNightOut(USER, '2026-07-24')).toBeNull();
    expect(recallOwnedNightOut(OTHER, '2026-07-24')).not.toBeNull();
    forgetAllOwnedNightOut(OTHER);
    expect(window.localStorage.getItem(KEY)).toBeNull();

    // A malformed value cannot be handled selectively: it goes whole.
    window.localStorage.setItem(KEY, `{"${USER}":{"planId":"${PLAN}","nightKey":"2026-08-1`);
    forgetAllOwnedNightOut(USER);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // A valid map with an unreadable entry for this account still loses that entry.
    window.localStorage.setItem(KEY, JSON.stringify({ [USER]: { planId: PLAN, nightKey: 'bad' }, [OTHER]: { planId: PLAN_B, nightKey: '2026-07-24' } }));
    forgetAllOwnedNightOut(USER);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toEqual({ [OTHER]: { planId: PLAN_B, nightKey: '2026-07-24' } });
  });

  it('ignores malformed ids and corrupt storage', () => {
    rememberOwnedNightOut('not-a-uuid', { planId: PLAN, nightKey: '2026-07-24' });
    expect(window.localStorage.getItem('next-bar:owned-night-out:v1')).toBeNull();
    window.localStorage.setItem('next-bar:owned-night-out:v1', '{not json');
    expect(recallOwnedNightOut(USER, '2026-07-24')).toBeNull();
  });
});
