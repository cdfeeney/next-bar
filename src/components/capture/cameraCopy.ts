import type { CameraFailure, CameraStatus } from './useCamera';

/**
 * What the stage says when the camera is not live, by WHY (V9-06). Every
 * branch names the way forward — Settings for a denial, "Try again" when the
 * device is merely busy, the library row always — so the user is never left
 * with a dead shutter and a vague "an error occurred".
 *
 * Settings guidance is platform-honest: on iPhone the switch is under
 * Settings › Privacy & Security › Camera (the per-app entry moved under
 * Settings › Apps in iOS 18, the privacy list did not); in Safari it is the
 * aA menu › Website Settings. The copy names both because the same web build
 * serves both.
 */
export function noticeFor(status: CameraStatus, reason: CameraFailure | null): string {
  if (status === 'denied') {
    // iOS 18+ lists third-party apps under Settings › Apps; Privacy & Security ›
    // Camera lists them on every supported iOS, so name the stable path.
    return 'Camera access is off for Next Bar. On iPhone, turn it on in Settings › Privacy & Security › Camera › Next Bar (or, in Safari, the aA menu › Website Settings). Or use a photo you already have.';
  }
  if (status === 'unavailable') {
    switch (reason) {
      case 'busy':
        return 'The camera is in use by another app or tab, or could not start. Close it there and try again, or use a photo you already have.';
      case 'no-device':
        return 'No camera faces this way on this device. Try the other lens, or use a photo you already have.';
      case 'no-api':
        return 'This browser cannot open the camera here. Open Next Bar in Safari or the iPhone app, or use a photo you already have.';
      case 'ended':
        return 'The camera stopped — its access was turned off or another app took it. Try again, or use a photo you already have.';
      default:
        return 'No camera is available on this device. You can still use a photo you already have.';
    }
  }
  return 'Starting the camera…';
}
