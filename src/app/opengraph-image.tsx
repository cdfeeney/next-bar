import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Next Bar — your next NYC bar, picked for you';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Branded social-share card. Rendered at build/request time by next/og so the
// deployed link preview (iMessage, Slack, X, etc.) looks like a real product.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#0a0a0a',
          backgroundImage:
            'radial-gradient(circle at 80% 0%, rgba(255,91,58,0.32), transparent 55%), radial-gradient(circle at 0% 100%, rgba(122,92,255,0.18), transparent 55%)',
          color: '#f5f5f0',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            letterSpacing: 10,
            textTransform: 'uppercase',
            color: '#ff5b3a',
            fontWeight: 700,
          }}
        >
          Next Bar · Manhattan
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 92,
              lineHeight: 1.02,
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            Stop going to the
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 92,
              lineHeight: 1.05,
              fontStyle: 'italic',
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            same three bars.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 34,
              marginTop: 28,
              color: '#8a8a85',
              fontFamily: 'Arial, sans-serif',
            }}
          >
            Take the vibe quiz · find your spot · agree as a group.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 28,
            fontFamily: 'Arial, sans-serif',
            color: '#8a8a85',
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 56,
              height: 56,
              borderRadius: 999,
              background: '#ff5b3a',
              color: '#0a0a0a',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontFamily: 'Georgia, serif',
            }}
          >
            NB
          </div>
          Beli for bars — your next NYC night, picked for you.
        </div>
      </div>
    ),
    { ...size },
  );
}
