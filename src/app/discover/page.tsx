'use client';

/**
 * /discover — Tinder-style swipe surface for DISCOVERING new bars (QA5-S3).
 *
 * Deliberately NOT on the home (Next Bar?) page: home answers "where next,
 * right now"; this page is idle-time browsing. Pool = full catalog minus
 * bars the user has already rated minus bars already on the want-to-go
 * list, ordered by the same suggestion ranking the map uses (via
 * useSuggestions with a large maxResults), with any leftover catalog bars
 * appended so the stack never runs dry just because matching filtered.
 *
 * Swipe RIGHT (or tap ♥) = save to want-to-go. Swipe LEFT (or tap ✕) =
 * skip for this session only. Buttons are the accessible/e2e path;
 * pointer-event drag is the fun path. No new dependencies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Bar } from '@/types';
import { barImageUrls } from '@/lib/barVisual';
import { useBars } from '@/lib/useBars';
import { useRatings } from '@/hooks/useRatings';
import { useSuggestions } from '@/hooks/useSuggestions';
import BarVisualTile from '@/components/BarVisualTile';
import OpenNowBadge from '@/components/OpenNowBadge';

// ---------------------------------------------------------------------------
// Want-to-go storage helper — LOCAL to this module by design.
//
// STORAGE CONTRACT (shared with the lists slice, which owns the future
// shared lib): localStorage `next-bar:list:want-to-go:v1` holds a JSON
// array of { barId: string, addedAt: string }. Corrupt data degrades to
// [], writes dedup by barId, and every write dispatches a synthesized
// `storage` event (src/lib/intent.ts notifyChange pattern) so other
// mounted consumers refresh. Integration swaps this for the shared lib.
// ---------------------------------------------------------------------------

type WantToGoEntry = {
  barId: string;
  addedAt: string; // ISO timestamp
};

const WANT_TO_GO_KEY = 'next-bar:list:want-to-go:v1';

function isWantToGoEntry(value: unknown): value is WantToGoEntry {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.barId === 'string' && typeof obj.addedAt === 'string';
}

function loadWantToGo(): WantToGoEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WANT_TO_GO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isWantToGoEntry)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function notifyWantToGoChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: WANT_TO_GO_KEY }));
  } catch {
    // Some environments lack the StorageEvent constructor — non-fatal.
  }
}

/** Append (deduped by barId). Idempotent: re-saving an entry is a no-op. */
function addToWantToGo(barId: string): void {
  if (typeof window === 'undefined') return;
  const current = loadWantToGo();
  if (current.some((e) => e.barId === barId)) return;
  const updated: WantToGoEntry[] = [
    ...current,
    { barId, addedAt: new Date().toISOString() },
  ];
  try {
    window.localStorage.setItem(WANT_TO_GO_KEY, JSON.stringify(updated));
  } catch {
    // Quota / private-mode errors — silently drop, matching ratings.ts.
  }
  notifyWantToGoChange();
}

// ---------------------------------------------------------------------------
// Swipe card
// ---------------------------------------------------------------------------

/** Horizontal travel (px) past which lifting the pointer commits a swipe. */
const SWIPE_COMMIT_PX = 100;

type DiscoverCardProps = {
  bar: Bar;
  onSave: () => void;
  onSkip: () => void;
};

/**
 * The top card of the stack. Mounted with key={bar.id} so drag + photo
 * state reset per bar. Drag is raw pointer events (no library): translate
 * + slight rotate while dragging; releasing past ±SWIPE_COMMIT_PX commits
 * (right = save, left = skip), anything less springs back.
 */
function DiscoverCard({ bar, onSave, onSkip }: DiscoverCardProps) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);

  const photo = barImageUrls(bar)[0] ?? null;
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = photo !== null && !photoFailed;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Primary pointer only; ignore a second touch mid-drag.
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    setDx(e.clientX - startXRef.current);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    setDragging(false);
    const travel = e.clientX - startXRef.current;
    setDx(0);
    if (!commit) return;
    if (travel > SWIPE_COMMIT_PX) onSave();
    else if (travel < -SWIPE_COMMIT_PX) onSkip();
  };

  return (
    <div
      data-testid="discover-card"
      data-bar-id={bar.id}
      className="absolute inset-0 rounded-3xl overflow-hidden border border-border bg-surface select-none touch-none cursor-grab active:cursor-grabbing"
      style={{
        transform: `translateX(${dx}px) rotate(${dx * 0.05}deg)`,
        transition: dragging ? 'none' : 'transform 200ms ease',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        // Glyph fallback: BarVisualTile centered on the card surface.
        <div className="absolute inset-0 flex items-center justify-center">
          <BarVisualTile bar={bar} size={56} photoDisabled={photoFailed} />
        </div>
      )}

      {/* Bottom overlay — name never truncates (wraps instead). */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-5 pt-16 pb-5 pointer-events-none">
        <h2
          data-testid="discover-card-heading"
          className="font-display text-2xl leading-tight text-white break-words"
        >
          {bar.name}
        </h2>
        <p className="text-white/80 text-sm mt-1">
          {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
        </p>
        <div className="mt-1">
          <OpenNowBadge bar={bar} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Big enough to rank the entire catalog (≈400 bars today). */
const DISCOVER_POOL_MAX = 1000;

export default function DiscoverPage(): JSX.Element {
  const bars = useBars();
  const { ratings } = useRatings();
  // Same ranking pipeline as /map, uncapped — no coords (this surface is
  // about browsing, not "near me right now").
  const { suggestedIds, profileChecked } = useSuggestions(
    null,
    DISCOVER_POOL_MAX,
  );

  // null = localStorage not read yet (SSR-safe hydration gate).
  const [wantedIds, setWantedIds] = useState<string[] | null>(null);
  // Session-only skip list — deliberately NOT persisted: a skipped bar may
  // come back tomorrow, a saved one never re-appears.
  const [skippedIds, setSkippedIds] = useState<string[]>([]);

  useEffect(() => {
    const refresh = () =>
      setWantedIds(loadWantToGo().map((e) => e.barId));
    refresh();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WANT_TO_GO_KEY || event.key === null) refresh();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const pool = useMemo((): Bar[] => {
    if (wantedIds === null || !profileChecked) return [];
    const excluded = new Set<string>([
      ...ratings.map((r) => r.barId),
      ...wantedIds,
      ...skippedIds,
    ]);
    const byId = new Map(bars.map((b) => [b.id, b]));
    const ranked: Bar[] = [];
    for (const id of suggestedIds) {
      const bar = byId.get(id);
      if (bar && !excluded.has(id)) ranked.push(bar);
    }
    // Matching filters (neighborhood prefs, staleness) can drop bars the
    // user could still discover — append the remainder in catalog order.
    const inRanked = new Set(suggestedIds);
    const rest = bars.filter(
      (b) =>
        !inRanked.has(b.id) &&
        !excluded.has(b.id) &&
        b.businessStatus !== 'CLOSED_PERMANENTLY',
    );
    return [...ranked, ...rest];
  }, [bars, ratings, suggestedIds, profileChecked, wantedIds, skippedIds]);

  const current = pool[0] ?? null;
  const upNext = pool.length - 1;
  const isReady = wantedIds !== null && profileChecked;

  const handleSave = useCallback((barId: string) => {
    addToWantToGo(barId);
    // The synthesized storage event refreshes state too — this direct set
    // just guarantees advance even if the event constructor threw.
    setWantedIds(loadWantToGo().map((e) => e.barId));
  }, []);

  const handleSkip = useCallback((barId: string) => {
    setSkippedIds((prev) =>
      prev.includes(barId) ? prev : [...prev, barId],
    );
  }, []);

  return (
    <main className="min-h-screen px-6 pt-8 pb-24 max-w-md mx-auto flex flex-col">
      <header className="text-center mb-4">
        <h1 className="font-display text-3xl md:text-4xl">Discover</h1>
        <p className="text-muted text-sm mt-1">
          Swipe right to save it for later. Left to pass.
        </p>
      </header>

      {!isReady ? (
        <div
          className="relative w-full aspect-[3/4] max-h-[60vh] rounded-3xl border border-border bg-surface"
          aria-hidden="true"
        />
      ) : current ? (
        <>
          <div className="relative w-full aspect-[3/4] max-h-[60vh]">
            {/* Static backdrop hints at the stack without duplicating
                headings/buttons for assistive tech. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 translate-y-2 scale-[0.97] rounded-3xl border border-border bg-surface"
            />
            <DiscoverCard
              key={current.id}
              bar={current}
              onSave={() => handleSave(current.id)}
              onSkip={() => handleSkip(current.id)}
            />
          </div>

          <div className="mt-5 flex items-center justify-center gap-8">
            <button
              type="button"
              aria-label={`Skip ${current.name}`}
              onClick={() => handleSkip(current.id)}
              className="min-h-[56px] min-w-[56px] rounded-full border border-border bg-surface text-muted text-2xl font-display touch-manipulation flex items-center justify-center hover:border-muted transition-colors"
            >
              ✕
            </button>
            <button
              type="button"
              aria-label={`Save ${current.name}`}
              onClick={() => handleSave(current.id)}
              className="min-h-[56px] min-w-[56px] rounded-full bg-accent text-bg text-2xl font-display touch-manipulation flex items-center justify-center"
            >
              ♥
            </button>
          </div>

          <p className="text-muted text-xs text-center mt-4">
            {upNext === 0
              ? 'Last one in the stack.'
              : `${upNext} more in the stack`}
          </p>
        </>
      ) : (
        <div className="text-center mt-12">
          <h2 className="font-display text-xl">That&apos;s the lot</h2>
          <p className="text-muted text-sm mt-2">
            You&apos;ve seen every bar we know about — rated, saved, or
            skipped. Check the map for what&apos;s near you.
          </p>
          <Link
            href="/map"
            className="inline-flex items-center min-h-[44px] mt-4 text-accent font-display touch-manipulation hover:underline underline-offset-4"
          >
            Open the map →
          </Link>
        </div>
      )}
    </main>
  );
}
