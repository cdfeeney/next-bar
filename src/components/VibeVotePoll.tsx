'use client';

import type { VibeTag } from '@/types';
import { displayTag } from '@/lib/tagDisplay';
import { VOTE_OPTIONS } from '@/lib/vibeVotes';
import type { UseVibeVotesReturn } from '@/hooks/useVibeVotes';

/**
 * UX-E "Tonight's vibe" poll (design: docs/UXE-VIBE-VOTE-DESIGN.md).
 * Presentational — state lives in useVibeVotes so the page can seed
 * Group Favorites with the winner. Renders NOTHING while dark
 * (migration 0017 unapplied / load error): votes === null.
 *
 * One tap = your vote (moves your previous one); tapping your own choice
 * again rescinds. Active = OUTLINED accent (R2).
 */
export default function VibeVotePoll({
  votes,
  myTag,
  winner,
  counts,
  busy,
  failed,
  toggleVote,
}: UseVibeVotesReturn): JSX.Element | null {
  if (votes === null) return null;

  return (
    <div className="mb-10" data-testid="vibe-vote-poll">
      <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-1">
        Tonight&apos;s vibe
      </h2>
      {/* Copy deliberately avoids the literal phrase "Group Favorites" —
          suggestions.spec locates that section by text. */}
      <p className="text-muted text-xs mb-3">
        One tap — the winning vibe bumps the group&apos;s picks.
      </p>
      <div
        role="group"
        aria-label="Vote for tonight's vibe"
        className="flex flex-wrap gap-2"
      >
        {VOTE_OPTIONS.map((tag: VibeTag) => {
          const isMine = myTag === tag;
          const count = counts.get(tag) ?? 0;
          const isWinner = winner === tag && count > 0;
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={isMine}
              disabled={busy}
              onClick={() => void toggleVote(tag)}
              className={[
                'min-h-[44px] px-4 rounded-full border font-display text-sm touch-manipulation transition-colors disabled:opacity-60',
                isMine
                  ? 'border-accent bg-accent/10 text-text'
                  : 'border-border bg-surface text-text hover:border-accent',
              ].join(' ')}
            >
              {displayTag(tag)}
              {count > 0 ? (
                <span
                  data-testid={`vibe-count-${tag}`}
                  className={[
                    'ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px]',
                    isWinner ? 'bg-accent text-bg' : 'bg-bg text-muted',
                  ].join(' ')}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* Review MED: a tap that didn't land must say so — a silently
          un-pressing button reads as broken. */}
      {failed ? (
        <p role="status" className="text-muted text-xs mt-2">
          That didn&apos;t go through — try again.
        </p>
      ) : null}
    </div>
  );
}
