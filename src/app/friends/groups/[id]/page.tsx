'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import GroupThread, { type AddableFriend } from '../../_components/GroupThread';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
import { fetchMyGroups } from '@/lib/groups.server';
import { getBrowserSupabase } from '@/lib/supabase/client';

/**
 * /friends/groups/[id] — a group thread on its OWN pushed screen.
 *
 * It used to expand inline under the follower counts and search on
 * /friends/people: a second Back pill, a message box in the middle of the
 * page, and the admin panel below it (iOS UI pass 2026-09-23, bug 5). A
 * pushed route gets the back gesture, hides the tab bar (BottomNav), and
 * gives a message a URL.
 */
const PEOPLE = '/friends/people';

export default function GroupPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuth();
  const { circle, followers } = useFollows();
  const client = useMemo(() => getBrowserSupabase(), []);
  const [name, setName] = useState<string | null>(null);
  /**
   * FAILED IS ITS OWN STATE, and it never displaces a live thread. Round 1
   * (Fable HIGH, Codex MEDIUM): a transient groups-read failure rendered
   * "That group isn't available", and because load() re-runs after every
   * send, delete, rename and mark-read, a blip mid-conversation unmounted the
   * thread under the member. Missing is claimed only from a SUCCESSFUL read.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');

  const viewerId = auth.status === 'signed-in' ? auth.user.id : null;
  const accessToken = auth.status === 'signed-in' ? auth.session.access_token : null;

  // Mutual friends, for the administrator's add control (V8-R-GRP-005): the
  // same circle ∩ followers rule GroupsAndPeople applied when it owned the thread.
  const addable = useMemo<AddableFriend[]>(() => {
    const followerIds = new Set(followers.map((f) => f.id));
    return circle
      .filter((f) => followerIds.has(f.id))
      .map((f) => ({ id: f.id, handle: f.handle, displayName: f.displayName }));
  }, [circle, followers]);

  const load = useCallback(async (): Promise<void> => {
    if (viewerId === null) return;
    const mine = await fetchMyGroups(client);
    if (!mine.ok) {
      // A thread already on screen stays; only a first load shows the failure.
      setStatus((current) => (current === 'ready' ? current : 'failed'));
      return;
    }
    const group = mine.value.find((g) => g.id === params.id) ?? null;
    if (group === null) {
      // Left, deleted, or never yours: an honest missing state, not a blank thread.
      setStatus('missing');
      return;
    }
    setName(group.name);
    setStatus('ready');
  }, [client, params.id, viewerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // POP the pushed screen when there is one to pop (Codex round 1); a
  // deep link with no history still lands on Groups & people.
  const back = (): void => {
    if (window.history.length > 1) router.back();
    else router.push(PEOPLE);
  };

  if (auth.status === 'loading') {
    return (
      <main className="min-h-screen px-6 pt-8">
        <p className="text-muted text-sm" role="status">
          Loading…
        </p>
      </main>
    );
  }

  if (viewerId === null) {
    return (
      <main className="min-h-screen px-6 pt-8 max-w-md mx-auto">
        <p className="text-sm leading-relaxed">Sign in to open a group.</p>
        <Link
          href="/auth"
          className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-full bg-accent text-bg font-display text-sm touch-manipulation"
        >
          Sign in
        </Link>
      </main>
    );
  }

  if (status === 'failed') {
    return (
      <main className="min-h-screen px-6 pt-8 max-w-md mx-auto">
        <p data-testid="group-load-failed" role="status" className="text-sm leading-relaxed">
          That group could not be loaded.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          data-testid="group-load-retry"
          className="mt-4 min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation"
        >
          Try again
        </button>
        <div>
          <Link
            href={PEOPLE}
            className="mt-4 inline-flex items-center min-h-[44px] text-accent text-sm underline-offset-4 hover:underline touch-manipulation"
          >
            ‹ Groups &amp; people
          </Link>
        </div>
      </main>
    );
  }

  if (status === 'missing') {
    return (
      <main className="min-h-screen px-6 pt-8 max-w-md mx-auto">
        <p data-testid="group-missing" className="text-sm leading-relaxed">
          That group isn&apos;t available.
        </p>
        <Link
          href={PEOPLE}
          className="mt-4 inline-flex items-center min-h-[44px] text-accent text-sm underline-offset-4 hover:underline touch-manipulation"
        >
          ‹ Groups &amp; people
        </Link>
      </main>
    );
  }

  if (status !== 'ready' || name === null) {
    return (
      <main className="min-h-screen px-6 pt-8">
        <p className="text-muted text-sm" role="status">
          Loading group…
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-6">
      <div className="max-w-md mx-auto px-6 pt-2">
        <GroupThread
          client={client}
          accessToken={accessToken}
          groupId={params.id}
          groupName={name}
          viewerId={viewerId}
          addable={addable}
          onClose={back}
          onChanged={() => void load()}
        />
      </div>
    </main>
  );
}
