import type { CameraFailure, CameraStatus } from './useCamera';

/**
 * What the stage says when the camera is not live, by WHY (V9-06). Every
 * branch names the way forward — Settings for a denial, "Try again" when the
 * device is merely busy, the library row always — so the user is never left
 * with a dead shutter and a vague "an error occurred".
 *
 * Settings guidance is platform-honest: on iOS 18 and later the app's own
 * switch is under Settings › Apps › Next Bar › Camera (V10-03, the path a
 * current iPhone shows first); iOS 17 and earlier keep it under Settings ›
 * Privacy & Security › Camera › Next Bar — both reach the same toggle; in
 * Safari it is the aA menu › Website Settings. The copy names all three
 * because the same web build serves both the app and the browser.
 */
export function noticeFor(status: CameraStatus, reason: CameraFailure | null): string {
  if (status === 'denied') {
    // iOS 18 path first (V10-03); the Privacy & Security path is the iOS 17
    // and earlier spelling, kept as the fallback sentence.
    return 'Camera access is off for Next Bar. On iPhone, turn it on in Settings › Apps › Next Bar › Camera (on iOS 17 and earlier: Settings › Privacy & Security › Camera › Next Bar; in Safari, the aA menu › Website Settings). Or use a photo you already have.';
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
