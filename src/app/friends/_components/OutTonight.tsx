'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { getBarById } from '@/lib/catalog';
import { describePresence } from '@/lib/presence';
import type { usePinnedHandles } from './usePinnedHandles';

/**
 * Social · Tonight → OUT TONIGHT (Social redesign 2026-09-13, README §1.6):
 * rows of 36px avatar → bar (or person) → "<who> · <state>" → time, and a
 * dashed empty box with the invitation in words. Extracted from
 * TonightPresence.tsx in S-02 so that file stays under the 800-line cap; the
 * four states and their rules (V8-R-OPS-005) are unchanged.
 */

/** '2026-07-25T02:00:00Z' → '10:00 PM'. Empty string when unparseable. */
function timeLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(at);
}

/**
 * The four states, kept in one place so no caller can accidentally render the
 * empty state for a failed read — or for a visitor who has no circle to read.
 */
export default function OutTonightList({
  loading,
  rows,
  signedOut,
}: {
  loading: boolean;
  rows: ReturnType<typeof usePinnedHandles>['rows'];
  signedOut: boolean;
}): JSX.Element {
  if (loading) {
    return (
      <p className="text-muted text-sm" role="status">
        Checking who&apos;s out…
      </p>
    );
  }

  // SIGNED OUT IS ITS OWN STATE. usePinnedHandles hands back `[]` here, and its
  // own header says why that is not an empty circle: "there is simply no circle
  // to ask about". Rendering "No friends out yet tonight" at a visitor is the
  // same category of lie as rendering it on a failed read — a claim about
  // friends we never asked about, made to someone who has not told us who they
  // are (V8-R-OPS-005). The forward path differs too: a visitor cannot invite
  // anyone until they sign in.
  if (signedOut) {
    return (
      <div data-testid="presence-signed-out">
        <p className="text-muted text-sm mb-3">
          Sign in to see who&apos;s out and pin your own spot.
        </p>
        <Link
          href="/auth"
          className="inline-flex items-center min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  // Load FAILURE. Never "nobody is out" — that would be a claim about the
  // viewer's friends that we have no evidence for (V8-R-OPS-005).
  if (rows === null) {
    return (
      <p className="text-muted text-sm" role="status" data-testid="presence-error">
        Couldn&apos;t load tonight. Pull again in a moment.
      </p>
    );
  }

  // Genuinely nobody: offer the forward path rather than an empty box, and
  // show no story ring at all (V8-R-SOC-001, V8-R-OPS-005).
  if (rows.length === 0) {
    return (
      <div
          data-testid="presence-empty"
          className="rounded-3xl border border-dashed border-border px-4 py-5"
        >
        <p className="text-sm leading-relaxed mb-3.5">
          Nobody&apos;s out yet — invite the people you&apos;d actually go out with.
        </p>
        <Link
          href="/friends/following"
          className="inline-flex items-center min-h-[44px] px-[18px] rounded-full border border-border font-display text-sm font-bold touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Invite friends
        </Link>
      </div>
    );
  }

  return (
    <ul data-testid="presence-list">
      {rows.map((person) => {
        const { barId, note } = describePresence(person);
        const bar = barId ? getBarById(barId) : null;
        const who = person.displayName?.trim()
          ? person.displayName.trim()
          : `@${person.handle}`;
        const when = timeLabel(person.updatedAt);
        return (
          <li
            key={person.handle}
            className="flex items-center gap-3 py-3 border-b border-held"
          >
            <Avatar initials={initialsOf(who)} seed={person.userId} size="sm" />
            <span className="min-w-0 flex-1">
              {/* Lead with the bar. When there is none, lead with the person —
                  never with a venue nobody claimed. */}
              <span className="block text-[15px] font-semibold truncate">
                {bar ? bar.name : who}
              </span>
              <span className="block text-xs text-muted truncate mt-px">
                {bar ? `${who} · ${note}` : note}
              </span>
            </span>
            {when ? (
              <span className="shrink-0 text-[11px] text-muted">{when}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** "Claire R." → "CR"; "@handle" → "H". Never empty, never more than two. */
function initialsOf(name: string): string {
  const words = name.replace(/^@/, '').split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}
