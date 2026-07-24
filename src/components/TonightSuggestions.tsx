'use client';

/**
 * TonightSuggestions — "Where should we go?" nominations (migration 0011).
 *
 * Members of your circle can SUGGEST specific bars for tonight, alongside
 * the algorithmic consensus. Night-scoped (NYC 6am rollover via
 * nycNightKey); suggesters render as the identity pair (name or @handle —
 * never email). Server-mode only: the consensus page mounts this for
 * signed-in users with a real circle.
 *
 * Cap UX: suggest_bar declines past 3/night — surfaced as an inline
 * message, not a silent no-op.
 */

import { useCallback, useEffect, useState } from 'react';
import BarPicker from '@/components/BarPicker';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBarById } from '@/lib/catalog';
import { nycNightKey } from '@/lib/nightKey';
import {
  fetchCircleSuggestions,
  suggestBar,
  unsuggestBar,
  type CircleSuggestion,
} from '@/lib/suggestions.server';
import type { Bar } from '@/types';

type Grouped = {
  bar: Bar;
  suggesters: Array<{ userId: string; label: string; isYou: boolean }>;
};

export default function TonightSuggestions(): JSX.Element | null {
  const auth = useAuth();
  const [suggestions, setSuggestions] = useState<CircleSuggestion[] | null>(
    null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const night = nycNightKey();

  const refresh = useCallback(async () => {
    if (auth.status !== 'signed-in') return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const epoch = getCacheEpoch();
    const rows = await fetchCircleSuggestions(supabase, night);
    if (getCacheEpoch() !== epoch) return;
    if (rows === null) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setSuggestions(rows);
  }, [auth.status, night]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (auth.status !== 'signed-in') return null;

  const you = auth.user.id;
  const grouped: Grouped[] = [];
  for (const s of suggestions ?? []) {
    const bar = getBarById(s.barId);
    if (!bar) continue; // unknown/retired catalog id — never render
    const label =
      s.userId === you ? 'You' : (s.displayName ?? (s.handle ? `@${s.handle}` : 'A friend'));
    const existing = grouped.find((g) => g.bar.id === s.barId);
    const suggester = { userId: s.userId, label, isYou: s.userId === you };
    if (existing) existing.suggesters.push(suggester);
    else grouped.push({ bar, suggesters: [suggester] });
  }
  // Most-backed suggestions first.
  grouped.sort((a, b) => b.suggesters.length - a.suggesters.length);
  const ownCount = (suggestions ?? []).filter((s) => s.userId === you).length;

  const handlePick = async (bar: Bar): Promise<void> => {
    setPickerOpen(false);
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    const ok = await suggestBar(supabase, bar.id, night);
    setBusy(false);
    if (!ok) {
      setNotice(
        ownCount >= 3
          ? "You've already suggested 3 bars tonight — remove one to swap."
          : "Couldn't save that suggestion — try again in a moment.",
      );
      return;
    }
    await refresh();
  };

  const handleRemove = async (barId: string): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    const ok = await unsuggestBar(supabase, you, barId, night);
    setBusy(false);
    if (!ok) {
      setNotice("Couldn't remove that — try again in a moment.");
      return;
    }
    await refresh();
  };

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted">
          Tonight&apos;s suggestions
        </h2>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-50"
        >
          + Suggest a bar
        </button>
      </div>

      {loadFailed ? (
        <p className="text-muted text-xs leading-relaxed">
          Couldn&apos;t load tonight&apos;s suggestions — pull to refresh or
          try again in a moment.
        </p>
      ) : grouped.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">
          Nobody&apos;s pitched a spot for tonight yet. Know where you wanna
          go? Suggest it and your circle will see it here.
        </p>
      ) : (
        <ul className="space-y-3">
          {grouped.map(({ bar, suggesters }) => (
            <li
              key={bar.id}
              className="bg-surface border border-border rounded-3xl p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-display text-base truncate">{bar.name}</p>
                <p className="text-muted text-xs mt-0.5 truncate">
                  {bar.neighborhood} · suggested by{' '}
                  {suggesters.map((s) => s.label).join(', ')}
                </p>
              </div>
              {suggesters.some((s) => s.isYou) ? (
                <button
                  type="button"
                  onClick={() => void handleRemove(bar.id)}
                  disabled={busy}
                  aria-label={`Remove your suggestion of ${bar.name}`}
                  className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0 disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {notice ? (
        <p className="text-accent text-xs mt-3" role="status">
          {notice}
        </p>
      ) : null}

      {pickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Suggest a bar"
          className="fixed inset-0 z-[1100] flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
        >
          <div className="relative flex flex-1 flex-col max-w-2xl w-full mx-auto px-6 pt-8 pb-8 min-h-0">
            <header className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-display text-2xl leading-tight">
                Suggest a bar
              </h2>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
              >
                Close
              </button>
            </header>
            <div className="flex-1 overflow-y-auto min-h-0">
              <BarPicker onPick={(bar) => void handlePick(bar)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
