import { beforeEach, describe, expect, test } from 'vitest';

import {
  AGE_ACK_KEY,
  clearAgeAck,
  readAgeAck,
  readAgeAnswer,
  writeAgeAck,
  writeAgeDenial,
} from './_ageAck';

/**
 * One key, three states. The screens that use it are mocked in their own
 * suites, so this is the only place the REAL storage contract is pinned — and
 * the contract is the thing the 2026-09-01 ruling changed: a refusal is now an
 * answer, not the absence of one.
 */
beforeEach(() => {
  window.localStorage.clear();
});

describe('the device age answer', () => {
  test('an untouched device has answered nothing', () => {
    expect(readAgeAnswer()).toBeNull();
    expect(readAgeAck()).toBe(false);
  });

  test('21+ is recorded as before, and readAgeAck still means exactly that', () => {
    writeAgeAck();

    expect(readAgeAnswer()).toBe('yes');
    expect(readAgeAck()).toBe(true);
    // The stored value is unchanged, so an already-acknowledged device carried
    // over from an earlier build is not re-asked by this change.
    expect(window.localStorage.getItem(AGE_ACK_KEY)).toBe('1');
  });

  test('under-21 is a RECORDED answer, distinguishable from never asked', () => {
    // The regression: the exit used to clear the key, and a cleared key reads
    // identically to a fresh device — so the gate asked again and offered
    // one-tap admission to the visitor who had just declined.
    writeAgeDenial();

    expect(readAgeAnswer()).toBe('no');
    // …and it is emphatically not an acknowledgement.
    expect(readAgeAck()).toBe(false);
  });

  test('a refusal replaces an earlier 21+ answer', () => {
    // The most recent answer from the person at the keyboard is the one that
    // counts. Two keys would allow "confirmed and declined" at once.
    writeAgeAck();
    writeAgeDenial();

    expect(readAgeAnswer()).toBe('no');
    expect(readAgeAck()).toBe(false);
  });

  test('clearing returns the device to unanswered — not to 21+', () => {
    // This is the mistap remedy, and it must put the QUESTION back rather than
    // admit anyone.
    writeAgeDenial();
    clearAgeAck();

    expect(readAgeAnswer()).toBeNull();
    expect(readAgeAck()).toBe(false);
  });

  test('an unrecognised stored value reads as unanswered, not as consent', () => {
    // Corruption, a hand-edited store, a future value written by a newer
    // build: every one of them fails toward ASKING.
    window.localStorage.setItem(AGE_ACK_KEY, 'true');

    expect(readAgeAnswer()).toBeNull();
    expect(readAgeAck()).toBe(false);
  });
});
