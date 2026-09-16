import type { Page } from '@playwright/test';

/**
 * A fake camera that works in BOTH gate engines.
 *
 * The iPhone 13 project runs on WebKit, so Chromium's
 * `--use-fake-device-for-media-stream` cannot be the answer. `getUserMedia` is
 * replaced instead (the same init-script seam the denied-permission test uses)
 * with a stub that records the `facingMode` each call asked for on
 * `window.__gumCalls`, so a test can prove the dual shot asked for the rear
 * camera first and the front camera second, and then hands back a stream:
 *
 *   - Where `HTMLCanvasElement.prototype.captureStream` exists (Chromium), a
 *     REAL `MediaStream` from a canvas that repaints every 100ms — the <video>
 *     gets frames, `videoWidth` becomes non-zero, and the shutter's canvas grab
 *     produces a JPEG exactly as it would on a phone.
 *   - Where it does not (Playwright's WebKit — measured 2026-09-16:
 *     `canvas.captureStream is not a function`), a fake stream object plus two
 *     prototype patches: `srcObject` accepts it, and `videoWidth`/`videoHeight`
 *     report 480×640 while it is attached. `drawImage` of a frameless video is
 *     a no-op, so the shutter still yields a (black) JPEG and the flow proceeds.
 *
 * Nothing else in the capture pipeline is stubbed: review, composition,
 * re-encode and publish all run for real against the stubbed Supabase.
 */
export async function stubCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __gumCalls: string[] }).__gumCalls = calls;

    const facingOf = (constraints?: MediaStreamConstraints): string => {
      const video = constraints?.video;
      return typeof video === 'object' && video !== null && 'facingMode' in video
        ? String((video as MediaTrackConstraints).facingMode ?? '')
        : '';
    };

    const hasCaptureStream =
      typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream === 'function';

    let getUserMedia: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;

    if (hasCaptureStream) {
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
      getUserMedia = (constraints) => {
        calls.push(facingOf(constraints));
        return Promise.resolve(canvas.captureStream(10));
      };
    } else {
      // WebKit path: a stream-shaped object the hook can drive end to end.
      const attached = new WeakSet<object>();
      const fakeStream = (facing: string): MediaStream => {
        const listeners = new Set<() => void>();
        const track = {
          kind: 'video',
          readyState: 'live',
          addEventListener: (_type: string, fn: () => void) => { listeners.add(fn); },
          removeEventListener: (_type: string, fn: () => void) => { listeners.delete(fn); },
          stop: () => undefined,
          getSettings: () => (facing === 'user' || facing === 'environment' ? { facingMode: facing } : {}),
        };
        const stream = {
          __fake: true,
          getTracks: () => [track],
          getVideoTracks: () => [track],
          getAudioTracks: () => [],
        };
        return stream as unknown as MediaStream;
      };
      const media = HTMLMediaElement.prototype;
      const srcObject = Object.getOwnPropertyDescriptor(media, 'srcObject');
      Object.defineProperty(media, 'srcObject', {
        configurable: true,
        get() {
          return srcObject?.get?.call(this) ?? null;
        },
        set(value: unknown) {
          if (value !== null && typeof value === 'object' && (value as { __fake?: boolean }).__fake) {
            attached.add(this as object);
            return;
          }
          attached.delete(this as object);
          srcObject?.set?.call(this, value);
        },
      });
      const video = HTMLVideoElement.prototype;
      for (const [prop, size] of [['videoWidth', 480], ['videoHeight', 640]] as const) {
        const original = Object.getOwnPropertyDescriptor(video, prop);
        Object.defineProperty(video, prop, {
          configurable: true,
          get() {
            return attached.has(this as object) ? size : (original?.get?.call(this) ?? 0);
          },
        });
      }
      getUserMedia = (constraints) => {
        const facing = facingOf(constraints);
        calls.push(facing);
        return Promise.resolve(fakeStream(facing));
      };
    }

    const devices = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { ...devices, getUserMedia },
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
 * The stage is live AND the preview reports a frame size. `status: 'live'` is
 * set the moment the stream resolves, a beat before the video has dimensions;
 * a shutter pressed in that beat grabs nothing. Waiting on `videoWidth` is
 * what a user's thumb does implicitly.
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
