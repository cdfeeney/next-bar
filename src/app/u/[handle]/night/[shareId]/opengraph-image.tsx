import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Next Bar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Unfurl card for the RETIRED shared-night route (WP7, EC-04).
 *
 * The route itself now answers 404 (see page.tsx) and migration 0068 drops
 * `public.get_shared_night(uuid)`, which held a live **anon** EXECUTE grant
 * over another account's handle, display name and legacy `loved_bar_id` tier.
 *
 * This file reads NOTHING. It previously fetched that RPC directly and
 * rendered the person's name and route into the unfurl card, which made the
 * image its own anonymous read of the same private data — a second copy of the
 * surface being retired. It is kept only so an already-circulating link
 * unfurls as a plain brand card instead of erroring, and it takes no token,
 * makes no request and names no account.
 */
export default function RetiredSharedNightImage() {
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
          Next Bar
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 88,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            Next Bar
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
            Your next NYC night, picked for you.
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
          The night wrote itself — Next Bar.
        </div>
      </div>
    ),
    { ...size },
  );
}
