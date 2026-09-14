'use client';

import Link from 'next/link';
import type { Bar } from '@/types';
import type { PublicProfile } from '@/lib/follows.server';
import BarPicker from '@/components/BarPicker';
import { AUDIENCE_LABELS, type PresenceAudience } from '@/lib/presence';
import { FriendPicker, isAudienceHeld } from '@/lib/presence/PinDialogs';

/**
 * The pin sequence as PUSHED SCREENS (Social redesign README §4–§5; owner
 * decision 2026-09-14: as drawn, not as modals). Three steps share one chrome:
 * a 44px back "‹" and a title. `TonightPresence` owns every piece of state and
 * decides which step is on screen; these components only draw one step each.
 *
 *   You tonight  →  Where are you?  →  Pin your spot  →  (Pin it)  →  Social
 */

export type PinStep = 'status' | 'where' | 'audience';

export const STEP_TITLES: Readonly<Record<PinStep, string>> = {
  status: 'You tonight',
  where: 'Where are you?',
  audience: 'Pin your spot',
};

const AUDIENCE_ORDER: readonly PresenceAudience[] = ['friends', 'close', 'people'];

const backClass =
  'flex items-center justify-center min-w-[44px] min-h-[44px] rounded-2xl text-text text-lg touch-manipulation';

/** Pushed chrome. On the status step back is a Link to Social; deeper steps go back one step. */
export function StepHeader({ step, onBack }: { step: PinStep; onBack: () => void }): JSX.Element {
  return (
    <header className="max-w-md mx-auto w-full flex items-center gap-2 px-4 pt-2.5 pb-2">
      {step === 'status' ? (
        <Link href="/friends" aria-label="Back to Social" data-testid="tonight-back" className={backClass}>
          <span aria-hidden="true">‹</span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={onBack}
          aria-label={step === 'where' ? 'Back to You tonight' : 'Back to Where are you?'}
          data-testid="pin-step-back"
          className={backClass}
        >
          <span aria-hidden="true">‹</span>
        </button>
      )}
      <h1 className="font-display text-base font-bold min-w-0 flex-1">{STEP_TITLES[step]}</h1>
    </header>
  );
}

/**
 * V8-R-PRE-003 — "Search and select the bar you are at." `BarPicker` IS the
 * field and the list; this is the question around it. Tapping a result SELECTS
 * the bar and advances to the audience step; nothing is written here.
 */
export function WhereAreYouStep({
  chosen,
  busy,
  onPick,
}: {
  /** The bar already chosen when the user came BACK from the audience step. */
  chosen: Bar | null;
  busy: boolean;
  onPick: (bar: Bar) => void;
}): JSX.Element {
  return (
    <div data-testid="pin-where-step" className="space-y-4">
      {/* THE TRUST LINE STAYS IN PLACE THROUGHOUT (V8-R-PRE-001's accessibility
          clause), with README §5's consequence in words. */}
      <p className="text-muted text-[13px] leading-relaxed">
        Pick where you are. Only the audience you choose next can see it, and it clears at 4 AM.
        You choose the bar — Next Bar never tracks you automatically.
      </p>
      {chosen ? (
        <p data-testid="pin-where-chosen" className="text-sm">
          <span className="text-muted">Chosen: </span>
          <span className="font-display font-semibold text-accent">{chosen.name}</span>
        </p>
      ) : null}
      <div className={busy ? 'pointer-events-none opacity-60' : ''}>
        <BarPicker onPick={onPick} />
      </div>
    </div>
  );
}

/**
 * README §5 "Audience": the chosen bar as the heading, the three audience rows,
 * the friends picker INLINE under Custom, the count in words, then Pin it (held
 * while Custom has nobody) and Cancel. Nothing here is live until Pin it.
 */
export function PinYourSpotStep({
  bar,
  barId,
  audience,
  recipients,
  friends,
  friendsLoading,
  friendsFailed,
  busy,
  onAudience,
  onToggleRecipient,
  onConfirm,
  onCancel,
}: {
  bar: Bar | null;
  barId: string;
  audience: PresenceAudience;
  recipients: readonly string[];
  friends: readonly PublicProfile[];
  friendsLoading: boolean;
  friendsFailed: boolean;
  busy: boolean;
  onAudience: (audience: PresenceAudience) => void;
  onToggleRecipient: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const held = isAudienceHeld(audience, recipients.length);
  const rowClass = (on: boolean): string =>
    [
      'flex w-full items-center justify-between gap-3 min-h-[60px] px-[18px] rounded-[20px] border text-left touch-manipulation transition-colors',
      on ? 'border-accent bg-accent/[0.10] text-text' : 'border-border bg-surface text-text',
    ].join(' ');

  return (
    <section className="space-y-3" data-testid="pin-audience-step" aria-labelledby="pin-audience-heading">
      <h2 id="pin-audience-heading" className="font-display text-2xl font-bold leading-tight">
        {bar?.name ?? barId}
      </h2>
      <p className="text-[13px] text-muted">Nothing is shared until you pin it.</p>
      <p className="font-label text-xs font-bold uppercase tracking-[0.25em] text-muted pt-2">Who can see this</p>
      <div className="space-y-2.5" role="group" aria-label="Who can see this pin tonight?">
        {AUDIENCE_ORDER.map((value) => {
          const on = audience === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              disabled={busy}
              onClick={() => onAudience(value)}
              data-testid={`pin-pending-audience-${value}`}
              className={rowClass(on)}
            >
              <span className="text-[15px] font-semibold">{AUDIENCE_LABELS[value]}</span>
              {/* The ✓ is ABSENT, not dimmed, on the rows that are not chosen. */}
              {on ? (
                <span aria-hidden="true" className="text-accent font-bold shrink-0">✓</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {audience === 'people' ? (
        <>
          <FriendPicker
            friends={friends}
            friendsLoading={friendsLoading}
            friendsFailed={friendsFailed}
            selected={recipients}
            busy={busy}
            onToggle={onToggleRecipient}
          />
          {/* WHO, IN WORDS (README §5): the count beneath the list. */}
          <p className="text-xs text-muted" data-testid="pin-pending-audience-count">
            {recipients.length} {recipients.length === 1 ? 'person' : 'people'} will see this pin tonight.
          </p>
        </>
      ) : null}

      <button
        type="button"
        // Custom with nobody selected is refused server-side rather than
        // widened, so the confirmation is HELD (bg-held, never opacity).
        disabled={busy || held}
        aria-disabled={busy || held}
        onClick={onConfirm}
        data-testid="pin-confirm"
        data-held={held ? 'true' : 'false'}
        className={[
          'flex w-full items-center justify-center min-h-[52px] rounded-full font-display text-base font-bold touch-manipulation transition-colors',
          held ? 'bg-held text-muted' : 'bg-accent text-bg',
        ].join(' ')}
      >
        {busy ? 'Pinning…' : 'Pin it'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        data-testid="pin-cancel"
        className="flex w-full items-center justify-center min-h-[48px] rounded-full border border-border text-muted font-display text-[15px] font-semibold touch-manipulation hover:text-text transition-colors"
      >
        Cancel
      </button>
    </section>
  );
}
