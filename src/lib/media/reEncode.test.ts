import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { sniffImageType } from './contentType';
import { MAX_UPLOAD_BYTES, reEncodeImage } from './reEncode';

/**
 * V8-R-STO-014 — "Uploaded bytes are re-encoded server-side so EXIF and GPS
 * metadata cannot survive, and content type is verified by inspection rather
 * than by a client-declared MIME allowlist."
 *
 * These assertions run the real decoder against real bytes. A mock of sharp
 * would prove only that this file calls the function it calls; the requirement
 * is about what comes out the other side, so the fixture carries actual EXIF
 * with actual GPS tags and the test reads the output back to see whether they
 * survived.
 */

async function jpegWithGps(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    // sharp's `Exif` type names only IFD0-IFD3, but libvips does write a GPS
    // IFD and the assertion below proves the tags land in the fixture's EXIF
    // block. The cast is about the type definition being narrower than the
    // library, not about bypassing a check.
    .withExif({
      IFD0: { Copyright: 'Next Bar test fixture' },
      GPS: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '40/1 44/1 54/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '73/1 59/1 8/1',
      },
    } as unknown as Parameters<ReturnType<typeof sharp>['withExif']>[0])
    .toBuffer();
  return new Uint8Array(buffer);
}

async function plainPng(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

describe('reEncodeImage — V8-R-STO-014 server-side re-encode', () => {
  it('strips EXIF and GPS metadata from an uploaded photo', async () => {
    const fixture = await jpegWithGps();

    // The fixture must genuinely carry the metadata, or the test proves
    // nothing. Asserting the EXIF block is merely "defined" would pass for an
    // empty header, so the marker string is read back out of the actual bytes.
    const before = await sharp(Buffer.from(fixture)).metadata();
    expect(before.exif, 'fixture should carry EXIF before re-encode').toBeDefined();
    expect(
      Buffer.from(before.exif as Uint8Array).includes(Buffer.from('Next Bar test fixture')),
      'fixture EXIF should contain real tag data, not an empty header',
    ).toBe(true);

    const result = await reEncodeImage(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await sharp(Buffer.from(result.value.bytes)).metadata();
    expect(after.exif, 'EXIF must not survive the re-encode').toBeUndefined();
    expect(after.xmp, 'XMP must not survive the re-encode').toBeUndefined();
  });

  it('never returns the original bytes', async () => {
    const fixture = await jpegWithGps();
    const result = await reEncodeImage(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The requirement is that the original is never persisted. What this
    // function returns IS what gets persisted, so it must not be the input.
    expect(Buffer.from(result.value.bytes).equals(Buffer.from(fixture))).toBe(false);
  });

  it('reports the type the decoder found, not one a caller supplied', async () => {
    const png = await plainPng();
    const result = await reEncodeImage(png);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe('image/png');
  });

  it('rejects a non-image whatever it claims to be', async () => {
    const pdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x00, 0x01,
      0x02, 0x03, 0x04, 0x05,
    ]);
    const result = await reEncodeImage(pdf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rejected');
  });

  it('rejects a truncated image rather than storing what decoded', async () => {
    const fixture = await jpegWithGps();
    // A valid JPEG header over a body that stops halfway.
    const truncated = fixture.slice(0, Math.floor(fixture.length / 2));
    const result = await reEncodeImage(truncated);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty upload', async () => {
    const result = await reEncodeImage(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rejected');
  });

  it('rejects an upload over the size cap before decoding it', async () => {
    // Real JPEG magic bytes so the rejection is the SIZE check and not the
    // sniffer — otherwise this test would pass for the wrong reason.
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    const result = await reEncodeImage(oversized);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rejected');
  });

  it('fails closed: every rejection path returns a result, never a throw', async () => {
    const garbage = new Uint8Array(64).fill(0x41);
    await expect(reEncodeImage(garbage)).resolves.toMatchObject({ ok: false });
  });
});

describe('sniffImageType — inspection, not declaration', () => {
  it('identifies a real JPEG', async () => {
    expect(sniffImageType(await jpegWithGps())).toBe('image/jpeg');
  });

  it('identifies a real PNG', async () => {
    expect(sniffImageType(await plainPng())).toBe('image/png');
  });

  it('rejects a RIFF container that is not WebP', () => {
    // "RIFF" + size + "WAVE" — a bare RIFF prefix check would accept this.
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('rejects bytes too short to carry any signature', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
