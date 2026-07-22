'use client';

import { useEffect, useState } from 'react';
import type { Bar } from '@/types';
import { isOpenNow } from '@/lib/openNow';

export type OpenStatus = 'unknown' | 'open' | 'closed' | 'permanently-closed';

/** Pure status decision for a bar at `now` — exported for testing. */
export function barStatus(bar: Bar, now: Date): OpenStatus {
  if (bar.businessStatus === 'CLOSED_PERMANENTLY') return 'permanently-closed';
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

  useEffect(() => {
    setStatus(barStatus(bar, new Date()));
    if (bar.businessStatus === 'CLOSED_PERMANENTLY') return;
    const t = setInterval(() => setStatus(barStatus(bar, new Date())), 60_000);
    return () => clearInterval(t);
  }, [bar]);

  if (status === 'unknown') return null;

  const config = {
    open: { label: 'Open now', text: 'text-green-400', dot: 'bg-green-400' },
    closed: { label: 'Closed', text: 'text-muted', dot: 'bg-muted' },
    'permanently-closed': { label: 'Permanently closed', text: 'text-red-400', dot: 'bg-red-400' },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${config.text}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}
