import { ImageResponse } from 'next/og';
import { bars } from '@/lib/bars';

export const runtime = 'edge';
export const alt = "Tonight's pick — Next Bar";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Per-bar unfurl card for shared picks (blueprint B3) — same brand system
// as the root opengraph-image.tsx, with the bar as the headline.
export default function SharePickImage({
  params,
}: {
  params: { barId: string };
}) {
  const bar = bars.find((b) => b.id === decodeURIComponent(params.barId));
  const name = bar?.name ?? 'Next Bar';
  const sub = bar
    ? `${bar.neighborhood} · ${'$'.repeat(bar.priceTier)}`
    : 'Your next NYC night, picked for you.';

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
          Tonight&apos;s pick
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 88,
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            {name}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 34,
              marginTop: 24,
              color: '#8a8a85',
              fontFamily: 'Arial, sans-serif',
            }}
          >
            {sub}
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
          Settled on Next Bar — the group-pick app.
        </div>
      </div>
    ),
    { ...size },
  );
}
