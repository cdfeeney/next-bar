'use client';

/**
 * TonightSection — blueprint B2 live-intent signals on /friends.
 * Your own "going / maybe / here now" toggle (localStorage, expires with
 * the night — see src/lib/intent.ts) plus your circle's signals (seeded
 * demo intents until D1 syncs real ones). Friends-only, never public.
 */

import Avatar from '@/components/Avatar';
import { useIntent } from '@/hooks/useIntent';
import type { IntentStatus } from '@/lib/intent';
import { demoIntentFor, type DemoFriend } from '@/lib/demo';

const STATUS_OPTIONS: ReadonlyArray<{
  value: IntentStatus;
  label: string;
}> = [
  { value: 'going', label: 'Going out' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'here', label: 'Out now' },
];

const FRIEND_STATUS_LINE: Record<IntentStatus, string> = {
  going: 'is going out tonight',
  maybe: 'might be out later',
  here: 'is out right now',
};

export default function TonightSection({
  friends,
}: {
  /** The circle — only followed friends' signals show. */
  friends: DemoFriend[];
}): JSX.Element {
  const { intent, toggleIntent } = useIntent();

  const signals = friends
    .map((f) => ({ friend: f, status: demoIntentFor(f.handle) }))
    .filter(
      (s): s is { friend: DemoFriend; status: IntentStatus } =>
        s.status !== null,
    );

  return (
    <div>
      <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
        Tonight
      </h2>
      <div className="bg-surface border border-border rounded-3xl p-5">
        <p className="text-sm mb-3">You out tonight?</p>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Your plans tonight"
        >
          {STATUS_OPTIONS.map((opt) => {
            const isActive = intent?.status === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => toggleIntent(opt.value)}
                className={[
                  'min-h-[44px] touch-manipulation px-4 py-2 rounded-full',
                  'font-display text-sm border transition-colors',
                  isActive
                    ? 'bg-accent text-bg border-accent'
                    : 'bg-bg border-border text-muted hover:text-text',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-muted text-xs mt-3">
          Only your circle sees this — it resets every night.
        </p>

        {signals.length > 0 ? (
          <ul className="mt-4 pt-4 border-t border-border space-y-2">
            {signals.map(({ friend, status }) => (
              <li key={friend.handle} className="flex items-center gap-2.5">
                <Avatar
                  initials={friend.initials}
                  seed={friend.handle}
                  size="sm"
                />
                <span className="text-sm">
                  <span className="font-display">
                    {friend.displayName.split(' ')[0]}
                  </span>{' '}
                  <span className="text-muted">
                    {FRIEND_STATUS_LINE[status]}
                  </span>
                  {status === 'here' ? (
                    <span
                      aria-hidden="true"
                      className="ml-1.5 inline-block w-2 h-2 rounded-full bg-accent align-middle"
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
