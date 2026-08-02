import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const contentType = 'image/png';

/**
 * The manifest (src/app/manifest.ts) declares 192x192 and 512x512 PNG
 * entries. Each id here genuinely renders at its declared size — a
 * consumer selecting the 192 entry receives a real 192x192 image, not a
 * relabeled 512 (TESTFLIGHT-READINESS-2026-08-02 item 2 FAIL sub-item).
 * e2e/manifest-icons.spec.ts fetches every manifest entry and asserts the
 * decoded PNG dimensions match the declaration.
 */
export const ICON_SIZES = [192, 512] as const;

/** Brand glyph metrics at the 512 reference size; scaled per icon size. */
const REFERENCE_SIZE = 512;
const REFERENCE_FONT_SIZE = 340;

export function generateImageMetadata() {
  return ICON_SIZES.map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: 'image/png',
    alt: 'Next Bar',
  }));
}

export default function Icon({ id }: { id: string }) {
  // The id is untrusted route input: Next's dynamicParams default means an
  // unlisted id can still reach this function at request time. Fail closed
  // on anything but the two declared sizes — never render from a raw
  // number (santa: Claude — NaN dimensions / unbounded render size).
  const size = ICON_SIZES.find((declared) => String(declared) === id);
  if (size === undefined) {
    return new Response('Not Found', { status: 404 });
  }
  const fontSize = Math.round((REFERENCE_FONT_SIZE * size) / REFERENCE_SIZE);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          borderRadius: '15%',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff5b3a',
            fontFamily: 'Georgia, serif',
            fontSize,
            fontWeight: 700,
            fontStyle: 'italic',
            lineHeight: 1,
            letterSpacing: '-0.04em',
          }}
        >
          N
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
    },
  );
}
