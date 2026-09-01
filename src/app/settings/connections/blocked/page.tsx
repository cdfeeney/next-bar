'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { listBlockedProfiles, unblockProfile } from '@/lib/moderation/blocks';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { OperationalState } from '@/components/states/OperationalState';
import { useOperationalLoad } from '@/components/states/useOperationalLoad';
import { Group, StackHeader } from '../../_ui';

/**
 * Settings · Connections · Blocked & muted (V8-R-ACC-009).
 *
 * A RELATIONSHIP surface under Connections, not a sharing default — which is
 * the whole reason the requirement names where it lives. The list is the
 * caller's own `profile_blocks` rows, read through the same client the insert
 * policy pins to `auth.uid()`, so this can only ever show your own blocks.
 *
 * WHY THE ROWS CARRY NO USERNAME. `listBlockedProfiles` returns profile ids,
 * and this repo has exactly one profile-resolution RPC —
 * `get_profile_by_handle` — which runs the other way. There is deliberately NO
 * table-level public SELECT on `profiles` (the enumeration guard migration
 * 0006 exists for), so a client cannot turn an id back into a handle, and
 * inventing a placeholder name here would be a fabricated identity on a
 * moderation surface. The rows say what is true and offer the action that
 * works.
 *
 * Every non-list state on this page goes through the shared `OperationalState`
 * component, including its retry policy: three silent attempts, then the user
 * is asked (V8-R-OPS-001, V8-R-OPS-007).
 */
export default function BlockedAndMutedPage(): JSX.Element {
  const auth = useAuth();

  return (
    <main className="min-h-screen">
      <StackHeader title="Blocked & muted" backHref="/settings/preferences" />

      <div className="max-w-md mx-auto px-4 py-5 space-y-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {auth.status === 'signed-in' ? (
          // Keyed on the account: signing in as someone else must re-read the
          // list rather than keep the previous owner's on screen.
          <BlockedList key={auth.user.id} />
        ) : (
          <OperationalState
            kind="denied"
            message="Sign in to see the accounts you've blocked."
          />
        )}
      </div>
    </main>
  );
}

function BlockedList(): JSX.Element {
  const load = useCallback(async (): Promise<string[] | null> => {
    const result = await listBlockedProfiles(getBrowserSupabase());
    return result.ok ? result.value : null;
  }, []);
  const blocks = useOperationalLoad(load);

  // Locally lifted blocks. The server response is authoritative — a failed
  // unblock is never added here, so the row stays and the failure says so.
  const [lifted, setLifted] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  if (blocks.state === 'loading') {
    return (
      <OperationalState
        kind="loading"
        message="Loading the accounts you've blocked."
      />
    );
  }

  if (blocks.state === 'failed') {
    return (
      <OperationalState
        kind="failed"
        message="Your blocked list could not be loaded."
        recovery={{ label: 'Retry', onAction: blocks.retry }}
      />
    );
  }

  const lift = async (id: string): Promise<void> => {
    setFailure(null);
    const result = await unblockProfile(getBrowserSupabase(), id);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setLifted((current) => [...current, id]);
  };

  const visible = (blocks.value ?? []).filter((id) => !lifted.includes(id));

  const list =
    visible.length === 0 ? (
      <OperationalState
        kind="empty"
        message="You haven't blocked anyone. Blocking hides you and the other account from each other, in both directions."
      />
    ) : (
      <Group
        label="Blocked"
        footnote="Blocking works in both directions and is enforced by the server. Usernames are not shown here: this build cannot turn a blocked account's id back into a handle."
      >
        {visible.map((id) => (
          <div
            key={id}
            className="w-full flex items-center gap-3 px-4 min-h-[48px] py-3"
          >
            <span className="text-sm flex-1 min-w-0 truncate">
              Blocked account
              <span className="block text-xs text-muted font-mono truncate">
                {id}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void lift(id)}
              className="shrink-0 min-h-[44px] px-4 rounded-full border border-border text-sm touch-manipulation"
            >
              Unblock
            </button>
          </div>
        ))}
      </Group>
    );

  // A failed lift is reported OVER the list it did not change — the row is
  // still there, which is the honest picture (V8-R-OPS-001).
  if (failure !== null) {
    return (
      <OperationalState kind="failed" message={failure}>
        {list}
      </OperationalState>
    );
  }

  // `stale` keeps the list on screen under its label rather than blanking it.
  if (blocks.state === 'stale') {
    return (
      <OperationalState
        kind="stale"
        message="This list could not be refreshed, so it may be out of date."
        recovery={{ label: 'Refresh', onAction: blocks.retry }}
      >
        {list}
      </OperationalState>
    );
  }

  return list;
}
