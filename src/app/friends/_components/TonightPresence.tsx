'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getBarById } from '@/lib/catalog';
import { useBars } from '@/lib/useBars';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  PRESENCE_LABELS,
  describePresence,
  type MyPresence,
  type PresenceAudience,
  type PresenceStatus,
} from '@/lib/presence';
import {
  clearPresence,
  fetchMyPresence,
  setPresence,
} from '@/lib/presence/server';
import { usePinnedHandles, announcePresenceChanged } from './usePinnedHandles';

/**
 * Social · Tonight — current awareness (V8-R-SOC-001, V8-R-PRE-001..005).
 *
 * Two parts, in the approved order: the compact pin row for YOUR status, then
 * who else is out. Both obey the same rules:
 *
 *  * Manual and attributed to a person. Every line names who set it. There is
 *    no device signal anywhere in this component and nothing derives presence
 *    from location.
 *  * Presence LEADS WITH THE BAR, and the state is carried in WORDS on the
 *    line beneath — never by colour alone (V8-R-SOC-001, accessibility).
 *  * Nobody is described by an invented venue. `describePresence` is the one
 *    place that decides this, and it drops a bar that contradicts the status
 *    rather than rendering it.
 *  * A pin sets Going out (V8-R-PRE-004) and expires at 4:00 AM
 *    America/New_York (V8-R-PRE-005) — structurally, because every read is
 *    scoped to `nycNightKey()`.
 *
 * The three-state read matters: "still loading", "nobody is out" and "could not
 * load" render differently. Showing the empty state on a failed fetch would
 * tell the viewer their friends are staying in (V8-R-OPS-005).
 */

const STATUS_ORDER: readonly PresenceStatus[] = ['going', 'maybe', 'not-going'];

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

export default function TonightPresence(): JSX.Element {
  // 0019 swap-day rule: this component renders getBarById lookups, so it
  // subscribes to a live server-catalog swap.
  useBars();
  const auth = useAuth();
  const { loading, rows, night, refresh } = usePinnedHandles();
  const [mine, setMine] = useState<MyPresence | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const userId = auth.status === 'signed-in' ? auth.user.id : null;

  const reloadMine = useCallback(async (): Promise<void> => {
    if (!userId) {
      setMine(null);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setMine(await fetchMyPresence(supabase));
  }, [userId, night]);

  useEffect(() => {
    void reloadMine();
  }, [reloadMine]);

  /**
   * One tap sets a status; tapping the lit one clears it (V8-R-PRE-005:
   * "tapping the pinned row again to change or clear it").
   *
   * Failure is REPORTED, never assumed away: if the write does not land, the
   * row says so and the previous state stands. Optimistically flipping the
   * pill would tell the user their friends can see a pin that was never
   * written.
   */
  const choose = useCallback(
    async (status: PresenceStatus): Promise<void> => {
      if (busy) return;
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setFailed(true);
        return;
      }
      setBusy(true);
      setFailed(false);
      const clearing = mine?.status === status;
      const ok = clearing
        ? await clearPresence(supabase)
        : await setPresence(supabase, {
            status,
            // Changing the STATUS never silently keeps a bar that no longer
            // applies: only 'going' may carry one, and re-picking the bar is
            // the separate step below.
            barId: status === 'going' ? (mine?.barId ?? null) : null,
            audience: mine?.audience ?? 'friends',
          });
      if (ok) {
        await reloadMine();
        refresh();
        // Tell every other reader of this row — the Stories rail's own-pin badge is a
        // separate consumer and would otherwise sit a whole night behind this write.
        announcePresenceChanged();
      } else {
        setFailed(true);
      }
      setBusy(false);
    },
    [busy, mine, reloadMine, refresh],
  );

  const chooseAudience = useCallback(
    async (audience: PresenceAudience): Promise<void> => {
      if (busy || !mine) return;
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setFailed(true);
        return;
      }
      setBusy(true);
      setFailed(false);
      const ok = await setPresence(supabase, {
        status: mine.status,
        barId: mine.barId,
        audience,
      });
      if (ok) await reloadMine();
      else setFailed(true);
      setBusy(false);
    },
    [busy, mine, reloadMine],
  );

  const myPin = mine ? describePresence(mine) : null;
  const myBar = myPin?.barId ? getBarById(myPin.barId) : null;

  return (
    <div className="space-y-8" data-testid="social-tonight">
      {/* Your status — the compact pin row directly under the stories rail
          (V8-R-PRE-001 entry point). */}
      <section>
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
          You tonight
        </h2>
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label="Your status tonight"
        >
          {STATUS_ORDER.map((status) => {
            const active = mine?.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => void choose(status)}
                className={[
                  'min-h-[44px] touch-manipulation px-5 rounded-full font-display text-sm border transition-colors disabled:opacity-60',
                  active
                    ? 'bg-transparent border-accent text-accent'
                    : 'bg-transparent border-border text-muted hover:text-text',
                ].join(' ')}
              >
                {PRESENCE_LABELS[status]}
              </button>
            );
          })}
        </div>

        {mine ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted" data-testid="my-pin">
              {myBar ? (
                <>
                  <span className="text-text font-display">{myBar.name}</span>
                  {' · Pinned now'}
                </>
              ) : (
                `${PRESENCE_LABELS[mine.status]} · no bar pinned`
              )}
            </p>
            {/* Who can see my pin tonight? (V8-R-PRE-002 / D-C-37.) */}
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="Who can see my pin tonight?"
            >
              {(
                [
                  ['friends', 'Friends'],
                  ['close', 'Close friends'],
                ] as ReadonlyArray<readonly [PresenceAudience, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mine.audience === value}
                  disabled={busy}
                  onClick={() => void chooseAudience(value)}
                  className={[
                    'min-h-[44px] touch-manipulation px-4 rounded-full text-xs font-display border transition-colors disabled:opacity-60',
                    mine.audience === value
                      ? 'border-accent text-accent'
                      : 'border-border text-muted hover:text-text',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {failed ? (
          <p className="text-xs text-muted mt-2" role="status">
            That didn&apos;t save — try again in a moment.
          </p>
        ) : null}
      </section>

      {/* Who else is out. */}
      <section>
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
          Out tonight
        </h2>
        <CircleList
          loading={loading}
          rows={rows}
          signedOut={auth.status !== 'loading' && auth.status !== 'signed-in'}
        />
      </section>
    </div>
  );
}

/**
 * The four states, kept in one place so no caller can accidentally render the
 * empty state for a failed read — or for a visitor who has no circle to read.
 */
function CircleList({
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
      <div data-testid="presence-empty">
        <p className="text-muted text-sm mb-3">No friends out yet tonight.</p>
        <Link
          href="/friends/following"
          className="inline-flex items-center min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Invite friends
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="presence-list">
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
            className="bg-surface border border-border rounded-2xl px-4 py-3"
          >
            {/* Lead with the bar. When there is none, lead with the person —
                never with a venue nobody claimed. */}
            <p className="font-display text-sm truncate">
              {bar ? bar.name : who}
            </p>
            <p className="text-muted text-xs truncate">
              {bar ? `${who} · ${note}` : note}
              {when ? ` · ${when}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
