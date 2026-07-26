import { ImageResponse } from 'next/og';
// SLIM import only (edge 1MB limit — the PR #10 deploy failure): the full
// catalog drags the Places sidecar into this bundle. See catalog.slim.ts.
import { getBarCard } from '@/lib/catalog.slim';

export const runtime = 'edge';
export const alt = 'A night out — Next Bar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type NightRow = {
  handle: string;
  display_name: string | null;
  night: string;
  bar_ids: string[];
  loved_bar_id: string | null;
};

/**
 * Unfurl card for a shared night (E4.3). Raw fetch to the token-keyed RPC
 * — no supabase-js import (bundle weight) — and every failure path falls
 * back to the brand card rather than erroring the unfurl.
 */
async function loadNight(token: string): Promise<NightRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_shared_night`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as NightRow[];
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

function nightDateLabel(nightKey: string): string {
  const [y, m, d] = (nightKey ?? '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default async function SharedNightImage({
  params,
}: {
  params: { handle: string; shareId: string };
}) {
  const night = await loadNight(decodeURIComponent(params.shareId));
  const who = night
    ? (night.display_name?.trim() || `@${night.handle}`)
    : 'A night out';
  const stops = night?.bar_ids?.length ?? 0;
  const barNames = (night?.bar_ids ?? [])
    .slice(0, 3)
    .map((id) => getBarCard(id)?.name)
    .filter((n): n is string => Boolean(n));
  const sub = night
    ? `${nightDateLabel(night.night)} · ${stops === 1 ? 'one stop' : `${stops} stops`}`
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
          {night ? `${who}'s night out` : 'Next Bar'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: barNames.length > 0 ? 64 : 88,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {barNames.length > 0
              ? barNames.join(' → ') + (stops > barNames.length ? ' → …' : '')
              : who}
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
          The night wrote itself — Next Bar.
        </div>
      </div>
    ),
    { ...size },
  );
}
