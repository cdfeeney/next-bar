'use client';

import { useEffect, useState } from 'react';
import type { Bar } from '@/types';
import { hasTrustworthyHours, isOpenNow, todayHoursLine } from '@/lib/openNow';

export type OpenStatus = 'unknown' | 'open' | 'closed' | 'permanently-closed';

/** Pure status decision for a bar at `now` — exported for testing. */
export function barStatus(bar: Bar, now: Date): OpenStatus {
  if (bar.businessStatus === 'CLOSED_PERMANENTLY') return 'permanently-closed';
  // Consistency with the filter (2026-07-27): if unverified hours are not
  // good enough to EXCLUDE a bar from results, they are not good enough to
  // badge it "Closed" either. Asserting a closed state we cannot stand
  // behind is worse than saying nothing — it talks users out of a bar that
  // is probably open. 'unknown' renders no badge at all.
  if (!hasTrustworthyHours(bar)) return 'unknown';
  const open = isOpenNow(bar.hours, now);
  return open === null ? 'unknown' : open ? 'open' : 'closed';
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
