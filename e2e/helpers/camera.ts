import type { Page } from '@playwright/test';

/**
 * A fake camera that works in BOTH gate engines. The iPhone 13 project runs
 * on WebKit, so Chromium's `--use-fake-device-for-media-stream` cannot be the
 * answer; instead `getUserMedia` is replaced (the same init-script seam the
 * denied-permission test uses) with a stub that
 *
 *   1. records the `facingMode` each call asked for on `window.__gumCalls`, so a
 *      test can prove the dual shot asked for the rear camera first and the
 *      front camera second, and
 *   2. resolves a REAL `MediaStream` from a canvas that repaints every 100ms,
 *      so the `<video>` gets frames, `videoWidth` becomes non-zero, and the
 *      shutter's canvas grab produces a JPEG exactly as it would on a phone.
 *
 * Nothing else in the capture pipeline is stubbed: review, composition,
 * re-encode and publish all run for real against the stubbed Supabase.
 */
export async function stubCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __gumCalls: string[] }).__gumCalls = calls;

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    let tick = 0;
    window.setInterval(() => {
      if (context === null) return;
      context.fillStyle = tick++ % 2 === 0 ? '#141414' : '#ff5b3a';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }, 100);

    const getUserMedia = (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
      const video = constraints?.video;
      const facing =
        typeof video === 'object' && video !== null && 'facingMode' in video
          ? String((video as MediaTrackConstraints).facingMode ?? '')
          : '';
      calls.push(facing);
      return Promise.resolve(canvas.captureStream(10));
    };

    const media = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { ...media, getUserMedia },
    });
  });
}

/** Every `facingMode` the page has asked the camera for, in order. */
export async function cameraCalls(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __gumCalls?: string[] }).__gumCalls ?? [],
  );
}

/**
 * The stage is live AND the preview has a frame. `status: 'live'` is set the
 * moment the stream resolves, a beat before the video has dimensions; a
 * shutter pressed in that beat grabs nothing. Waiting on `videoWidth` is what
 * a user's thumb does implicitly.
 */
export async function waitForCameraFrame(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const stage = document.querySelector('[data-testid="camera-stage"]');
    const video = stage?.querySelector('video') as HTMLVideoElement | null;
    return (
      stage?.getAttribute('data-camera-status') === 'live' &&
      video !== null &&
      video.videoWidth > 0
    );
  });
}
