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
  const [missing, setMissing] = useState(false);

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
      setMissing(true);
      return;
    }
    const group = mine.value.find((g) => g.id === params.id) ?? null;
    if (group === null) {
      // Left, deleted, or never yours: an honest missing state, not a blank thread.
      setMissing(true);
      return;
    }
    setMissing(false);
    setName(group.name);
  }, [client, params.id, viewerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = (): void => router.push(PEOPLE);

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

  if (missing) {
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

  if (name === null) {
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
