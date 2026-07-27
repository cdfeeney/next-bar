import { ImageResponse } from 'next/og';
// SLIM import only (edge 1MB limit): the full catalog drags the Places
// sidecar into this bundle — see catalog.slim.ts.
import { getBarCard } from '@/lib/catalog.slim';

export const runtime = 'edge';
export const alt = "Tonight's pick — Next Bar";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ID_RE = /^[a-z0-9-]{1,60}$/;

/**
 * Imported bars aren't in the slim bundle, so their unfurls used to fall
 * back to the generic card. Direct PostgREST fetch (not the SDK — this is
 * the edge 1MB bundle) for just the three fields the card renders.
 */
async function cardFromTable(
  id: string,
): Promise<{ name: string; neighborhood: string; priceTier: number } | null> {
  if (!ID_RE.test(id)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/bars?id=eq.${id}&select=name,neighborhood,price_tier&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.name || typeof row.price_tier !== 'number') return null;
    return {
      name: row.name,
      neighborhood: row.neighborhood ?? '',
      priceTier: row.price_tier,
    };
  } catch {
    return null;
  }
}

// Per-bar unfurl card for shared picks (blueprint B3) — same brand system
// as the root opengraph-image.tsx, with the bar as the headline.
export default async function SharePickImage({
  params,
}: {
  params: { barId: string };
}) {
  const id = decodeURIComponent(params.barId);
  const bar = getBarCard(id) ?? (await cardFromTable(id));
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
