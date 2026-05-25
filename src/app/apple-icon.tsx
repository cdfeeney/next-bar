import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff5b3a',
            fontFamily: 'Georgia, serif',
            fontSize: 124,
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
      ...size,
    },
  );
}
