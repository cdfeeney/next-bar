'use client';

import { useEffect, useRef, useState } from 'react';
import type { Recap } from '@/lib/recap';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchOwnProfile } from '@/lib/profile.server';
import { shareNight } from '@/lib/nights.server';
import { buildNightPath, isShareAbort, shareNightText } from '@/lib/share';
import { trackEvent } from '@/lib/analytics';

const COPIED_MS = 2000;

type ShareState = 'idle' | 'busy' | 'copied' | 'failed';

/**
 * "Share last night" on the recap card (E4.4). Publishing IS the consent:
 * the tap upserts the night server-side (share_night mints/keeps the
 * bearer token) and only then opens the share sheet with the
 * /u/[handle]/night/[token] link. Renders nothing when signed out or
 * handle-less — a control that cannot work must not exist (R5, no dead
 * controls). Busy holds through the whole async chain (R12) and the
 * ShareButton dismiss≠consent clipboard rule applies verbatim.
 *
 * iOS note: navigator.share must run inside transient user activation;
 * the RPC roundtrip usually fits the activation window, and when it
 * doesn't the failure lands in the clipboard fallback (which fails
 * closed to the honest "Couldn't share" state).
 */
export default function ShareNightButton({ recap }: { recap: Recap }) {
  const auth = useAuth();
  const [handle, setHandle] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [state, setState] = useState<ShareState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (auth.status !== 'signed-in') {
      setHandle(null);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const profile = await fetchOwnProfile(supabase);
      if (cancelled) return;
      setHandle(profile?.handle ?? null);
      setDisplayName(profile?.displayName ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (auth.status !== 'signed-in' || !handle) return null;

  const share = async (): Promise<void> => {
    if (state === 'busy') return;
    setState('busy');
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setState('failed');
        return;
      }
      const token = await shareNight(supabase, {
        nightKey: recap.nightKey,
        barIds: recap.bars.map((b) => b.id),
        lovedBarId: recap.loved?.id ?? null,
      });
      if (!token) {
        setState('failed');
        return;
      }
      const url = `${window.location.origin}${buildNightPath(handle, token)}`;
      const text = shareNightText(handle, displayName, recap.bars.length);

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: text, text, url });
          // Dark analytics (g-ee6c250d): completed share only — the abort
          // branch below never reaches this.
          trackEvent('share');
          setState('idle');
          return;
        } catch (err) {
          if (isShareAbort(err)) {
            // Dismissed the sheet — the night stays shared server-side
            // (re-tapping re-opens the sheet with the SAME link).
            setState('idle');
            return;
          }
          // Genuine failure — fall through to clipboard.
        }
      }
      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        trackEvent('share');
        setState('copied');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), COPIED_MS);
      } catch {
        setState('failed');
      }
    } finally {
      setState((s) => (s === 'busy' ? 'idle' : s));
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={() => void share()}
        aria-label={
          state === 'copied' ? 'Link copied to clipboard' : 'Share last night'
        }
        className="inline-flex items-center min-h-[56px] px-6 rounded-full border border-border text-text font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors disabled:opacity-60"
      >
        {state === 'busy'
          ? 'Sharing…'
          : state === 'copied'
            ? 'Copied ✓'
            : 'Share last night'}
      </button>
      {state === 'failed' ? (
        <p className="text-xs text-muted" role="status">
          Couldn&apos;t share — try again in a moment.
        </p>
      ) : null}
    </div>
  );
}
