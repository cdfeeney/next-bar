import { describe, expect, it } from 'vitest';
import { classifyCameraError, type CameraFailure } from './useCamera';
import { noticeFor } from './cameraCopy';

describe('classifyCameraError — getUserMedia rejection → state (V9-06)', () => {
  it.each([
    ['NotAllowedError', 'denied', 'denied'],
    ['SecurityError', 'denied', 'denied'],
    ['PermissionDeniedError', 'denied', 'denied'],
    ['NotFoundError', 'unavailable', 'no-device'],
    ['DevicesNotFoundError', 'unavailable', 'no-device'],
    ['OverconstrainedError', 'unavailable', 'no-device'],
    ['NotReadableError', 'unavailable', 'busy'],
    ['TrackStartError', 'unavailable', 'busy'],
    ['AbortError', 'unavailable', 'busy'],
    ['TypeError', 'unavailable', 'unknown'],
    ['', 'unavailable', 'unknown'],
  ] as const)('%s → %s / %s', (name, status, reason) => {
    expect(classifyCameraError(name)).toEqual({ status, reason });
  });
});

describe('noticeFor — every non-live state names its way forward', () => {
  const reasons: CameraFailure[] = ['denied', 'no-api', 'no-device', 'busy', 'ended', 'unknown'];

  it('a denial points at Settings, on the phone and in Safari', () => {
    const copy = noticeFor('denied', 'denied');
    expect(copy).toMatch(/Settings › Privacy & Security › Camera › Next Bar/);
    expect(copy).toMatch(/Safari/);
    expect(copy).toMatch(/photo you already have/);
  });

  it('busy, missing-lens, no-API and ended are told apart', () => {
    const texts = reasons.filter((r) => r !== 'denied').map((r) => noticeFor('unavailable', r));
    expect(new Set(texts).size).toBe(texts.length);
    expect(noticeFor('unavailable', 'busy')).toMatch(/in use by another app/);
    expect(noticeFor('unavailable', 'no-device')).toMatch(/No camera faces this way/);
    expect(noticeFor('unavailable', 'no-api')).toMatch(/cannot open the camera here/);
    expect(noticeFor('unavailable', 'ended')).toMatch(/camera stopped/);
  });

  it('never says a vague "an error occurred", and always offers the library', () => {
    for (const r of reasons) {
      for (const status of ['denied', 'unavailable'] as const) {
        const copy = noticeFor(status, r);
        expect(copy).not.toMatch(/an error occurred|something went wrong/i);
        expect(copy).toMatch(/photo you already have/);
      }
    }
  });

  it('a null reason (before anything failed) is the generic unavailable copy, and starting is starting', () => {
    expect(noticeFor('unavailable', null)).toMatch(/No camera is available/);
    expect(noticeFor('starting', null)).toBe('Starting the camera…');
  });
});
