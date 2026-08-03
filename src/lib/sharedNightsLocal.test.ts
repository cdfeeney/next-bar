import { beforeEach, describe, expect, it } from 'vitest';
import {
  SHARED_NIGHTS_STORAGE_KEY,
  forgetSharedNight,
  getSharedNightToken,
  recordSharedNight,
} from '@/lib/sharedNightsLocal';

describe('sharedNightsLocal', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('records and reads back a token per nightKey', () => {
    recordSharedNight('2026-08-01', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(getSharedNightToken('2026-08-01')).toBe(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
    expect(getSharedNightToken('2026-08-02')).toBeNull();
  });

  it('re-sharing the same night overwrites the record (server keeps one token per night)', () => {
    recordSharedNight('2026-08-01', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    recordSharedNight('2026-08-01', 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(getSharedNightToken('2026-08-01')).toBe(
      'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  });

  it('forgetSharedNight removes only that night', () => {
    recordSharedNight('2026-08-01', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    recordSharedNight('2026-08-02', 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    forgetSharedNight('2026-08-01');
    expect(getSharedNightToken('2026-08-01')).toBeNull();
    expect(getSharedNightToken('2026-08-02')).not.toBeNull();
  });

  it('corrupt storage reads as empty, never throws', () => {
    window.localStorage.setItem(SHARED_NIGHTS_STORAGE_KEY, '{oops');
    expect(getSharedNightToken('2026-08-01')).toBeNull();
    // And a write after corruption recovers the store.
    recordSharedNight('2026-08-01', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(getSharedNightToken('2026-08-01')).not.toBeNull();
  });

  it('rejects non-token values (defense against writing garbage into share links)', () => {
    recordSharedNight('2026-08-01', 'not-a-uuid');
    expect(getSharedNightToken('2026-08-01')).toBeNull();
  });
});
