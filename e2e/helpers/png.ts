/**
 * Minimal PNG decoder for icon assertions (no dependency): parses IHDR for
 * real dimensions and fully unfilters the image so tests can inspect actual
 * pixel values (alpha, brand colors). Supports what our icon routes emit —
 * 8-bit non-interlaced RGB (color type 2) and RGBA (color type 6).
 */

import * as zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RGBA_CHANNELS = 4;
const OPAQUE = 255;

export interface DecodedPng {
  width: number;
  height: number;
  /** 2 = RGB, 6 = RGBA (as declared by the file). */
  colorType: number;
  /** Unfiltered pixel data, always expanded to RGBA order. */
  pixels: Buffer;
}

export function decodePng(file: Buffer): DecodedPng {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG: bad signature');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length; // length + type + data + crc
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}); ` +
        'decoder handles 8-bit RGB/RGBA only',
    );
  }
  if (interlace !== 0) {
    throw new Error('unsupported PNG: interlaced');
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const expectedLength = height * (stride + 1);
  if (raw.length < expectedLength) {
    throw new Error(
      `truncated PNG data: ${raw.length} < ${expectedLength} bytes`,
    );
  }

  const unfiltered = unfilterScanlines(raw, width, height, channels);
  const pixels =
    channels === 4 ? unfiltered : expandRgbToRgba(unfiltered, width * height);
  return { width, height, colorType, pixels };
}

function unfilterScanlines(
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[rowStart - stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? out[rowStart - stride + x - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rowIn[x];
          break;
        case 1:
          value = rowIn[x] + left;
          break;
        case 2:
          value = rowIn[x] + up;
          break;
        case 3:
          value = rowIn[x] + Math.floor((left + up) / 2);
          break;
        case 4:
          value = rowIn[x] + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter} on row ${y}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function expandRgbToRgba(rgb: Buffer, pixelCount: number): Buffer {
  const out = Buffer.alloc(pixelCount * RGBA_CHANNELS);
  for (let i = 0; i < pixelCount; i += 1) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = OPAQUE;
  }
  return out;
}

export function pixelAt(
  png: DecodedPng,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const i = (y * png.width + x) * RGBA_CHANNELS;
  return {
    r: png.pixels[i],
    g: png.pixels[i + 1],
    b: png.pixels[i + 2],
    a: png.pixels[i + 3],
  };
}

/** Count pixels within +/-tolerance per channel of an opaque target color. */
export function countPixelsNear(
  png: DecodedPng,
  target: { r: number; g: number; b: number },
  tolerance: number,
): number {
  let count = 0;
  for (let i = 0; i < png.pixels.length; i += RGBA_CHANNELS) {
    if (
      png.pixels[i + 3] === OPAQUE &&
      Math.abs(png.pixels[i] - target.r) <= tolerance &&
      Math.abs(png.pixels[i + 1] - target.g) <= tolerance &&
      Math.abs(png.pixels[i + 2] - target.b) <= tolerance
    ) {
      count += 1;
    }
  }
  return count;
}

/** True if every pixel is fully opaque (the App Store no-alpha rule). */
export function isFullyOpaque(png: DecodedPng): boolean {
  for (let i = 3; i < png.pixels.length; i += RGBA_CHANNELS) {
    if (png.pixels[i] !== OPAQUE) return false;
  }
  return true;
}
