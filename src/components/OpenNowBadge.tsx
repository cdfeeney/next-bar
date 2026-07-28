'use client';

import { useEffect, useState } from 'react';
import type { Bar } from '@/types';
import { hasTrustworthyHours, isOpenNow, todayHoursLine } from '@/lib/openNow';

export type OpenStatus = 'unknown' | 'open' | 'closed' | 'permanently-closed';

/** Pure status decision for a bar at `now` — exported for testing. */
export function barStatus(bar: Bar, now: Date): OpenStatus {
  if (bar.businessStatus === 'CLOSED_PERMANENTLY') return 'permanently-closed';

  const open = isOpenNow(bar.hours, now);
  if (open === null) return 'unknown'; // no hours at all — nothing to say

  // ASYMMETRIC on purpose, mirroring excludeClosedBars (operator decision
  // 2026-07-28). An earlier version gated the whole badge on
  // hasTrustworthyHours, which removed the open/closed signal from EVERY card,
  // since all 1,265 venues are Google-sourced — an unapproved UX regression,
  // and incoherent with the lightbox showing a full weekly table from the same
  // data.
  //
  // "Open" is safe to say on unverified hours: it is useful, and the worst case
  // is a user arriving somewhere that just shut. "Closed" is not, because
  // talking someone out of a bar that is probably open is the error we cannot
  // take back — the same reason unverified hours never CLOSE a bar in the
  // filter. So a closed-looking unverified bar renders no badge instead.
  if (open) return 'open';
  return hasTrustworthyHours(bar) ? 'closed' : 'unknown';
}

/**
 * Small live "Open now" / "Closed" pill. Computed entirely client-side from the
 * bar's stored hours (no API call), and only after mount — so it never causes a
 * hydration mismatch and shows nothing when hours are unknown. Re-checks each
 * minute so a long-open results page stays accurate across a close/open boundary.
 */
export default function OpenNowBadge({ bar }: { bar: Bar }) {
  const [status, setStatus] = useState<OpenStatus>('unknown');
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setStatus(barStatus(bar, now));
      // U2-1: the REAL hours line ("Open · until 2 AM" / "Opens 5 PM")
      // replaces the bare open/closed label whenever hours are known.
      setLine(todayHoursLine(bar.hours, now));
    };
    tick();
    if (bar.businessStatus === 'CLOSED_PERMANENTLY') return;
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [bar]);

  if (status === 'unknown') return null;

  const config = {
    open: { label: 'Open now', text: 'text-green-400', dot: 'bg-green-400' },
    closed: { label: 'Closed', text: 'text-muted', dot: 'bg-muted' },
    'permanently-closed': { label: 'Permanently closed', text: 'text-red-400', dot: 'bg-red-400' },
  }[status];

  const label =
    status === 'permanently-closed' ? config.label : line ?? config.label;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${config.text}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
