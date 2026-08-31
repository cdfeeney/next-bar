import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileToDataUrl } from './useCamera';

/**
 * The library path's re-encode is the ONLY thing in this build that strips
 * EXIF/GPS from a photo before it is uploaded: there is no server-side
 * re-encode, and migration 0065 records that as an open obligation rather than
 * claiming it exists.
 *
 * So the re-encode's failure paths are a privacy boundary, not a nicety. They
 * used to `return url` — the raw FileReader result, metadata intact — which
 * meant a canvas that would not give a 2d context, or a `toDataURL` that could
 * not produce a JPEG, silently published the original bytes with the
 * coordinates the photo was taken at, to the author's whole friends list.
 * Failing closed loses a photo; failing open leaks a location.
 *
 * jsdom is the right harness for exactly this: its canvas has no 2d context, so
 * the fallback branch is the DEFAULT here rather than something to simulate.
 */

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 800;
  height = 600;
  set src(_value: string) {
    // Decode "succeeds" — the point is what happens AFTER a successful decode
    // when the re-encode itself cannot be performed.
    queueMicrotask(() => this.onload?.());
  }
}

function pngFile(): File {
  return new File([new Uint8Array([137, 80, 78, 71])], 'holiday.png', { type: 'image/png' });
}

describe('fileToDataUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses a file that is not an image at all', async () => {
    const notAPhoto = new File(['#!/bin/sh'], 'run.sh', { type: 'application/x-sh' });
    await expect(fileToDataUrl(notAPhoto)).resolves.toBeNull();
  });

  it('returns null rather than the ORIGINAL bytes when the canvas cannot re-encode', async () => {
    vi.stubGlobal('Image', FakeImage);
    // jsdom's HTMLCanvasElement.getContext('2d') returns null without the
    // optional canvas package — the exact fallback branch under test.
    const result = await fileToDataUrl(pngFile());
    expect(result).toBeNull();
  });

  it('returns null when toDataURL cannot produce a JPEG', async () => {
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    // A tainted or zero-size canvas answers "data:,"; an engine without JPEG
    // support answers a PNG. Neither is the re-encode this path promises.
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
    await expect(fileToDataUrl(pngFile())).resolves.toBeNull();

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    await expect(fileToDataUrl(pngFile())).resolves.toBeNull();
  });

  it('returns the RE-ENCODED image when the round trip actually worked', async () => {
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,STRIPPED');

    const result = await fileToDataUrl(pngFile());
    // The re-encoded JPEG, never the PNG that was read off disk: the swap IS
    // the metadata strip.
    expect(result).toBe('data:image/jpeg;base64,STRIPPED');
  });
});
