'use client';

import { useEffect, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { fetchMyGroups, fetchGroupMembers, type Group, type GroupMember } from '@/lib/groups.server';

type Person = { id: string; label: string; initials: string; seed: string; ratings: readonly unknown[] };
const buttonClass = 'rounded-full border border-border bg-surface px-3 py-2 text-sm min-h-[44px] touch-manipulation';

export default function RecipientPicker({
  people, circleIds, selected, groupMembers, onToggle, onGroupChange, onBusy,
  userId, isServer, loading, failed,
}: {
  people: readonly Person[];
  circleIds: readonly string[];
  selected: ReadonlySet<string>;
  groupMembers: Record<string, GroupMember[]>;
  onToggle: (id: string) => void;
  onGroupChange: (id: string, members: GroupMember[] | null) => void;
  onBusy: (busy: boolean) => void;
  userId: string | null;
  isServer: boolean;
  loading: boolean;
  failed: boolean;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(isServer);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<{ group: Group; message: string } | null>(null);
  const [emptyGroup, setEmptyGroup] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!isServer || !userId) { setGroupsLoading(false); return; }
    let cancelled = false;
    const epoch = getCacheEpoch();
    setGroupsLoading(true);
    setGroupsError(null);
    void fetchMyGroups(getBrowserSupabase()).then((result) => {
      if (cancelled || epoch !== getCacheEpoch()) return;
      setGroupsLoading(false);
      if (result.ok) setGroups(result.value);
      else setGroupsError(result.message);
    });
    return () => { cancelled = true; };
  }, [isServer, userId, retry]);

  async function toggleGroup(group: Group) {
    if (pending) return;
    setMemberError(null);
    setEmptyGroup(null);
    if (groupMembers[group.id]) { onGroupChange(group.id, null); return; }
    const epoch = getCacheEpoch();
    setPending(group.id);
    onBusy(true);
    const result = await fetchGroupMembers(getBrowserSupabase(), group.id);
    if (!alive.current || epoch !== getCacheEpoch()) return;
    setPending(null);
    onBusy(false);
    if (!result.ok) { setMemberError({ group, message: result.message }); return; }
    const members = result.value.filter((p) => p.profileId !== userId);
    onGroupChange(group.id, members);
    if (!members.length) setEmptyGroup(group.name);
  }

  const term = query.trim().toLocaleLowerCase();
  const circleSet = new Set(circleIds);
  const circle = people.filter((p) => circleSet.has(p.id));
  const matches = circle.filter((p) => p.label.toLocaleLowerCase().includes(term)
    || p.seed.toLocaleLowerCase().includes(term.replace(/^@/, '')));
  const suggestions = term || showAll ? matches : matches.slice(0, 8);
  const recipients = people.filter((p) => selected.has(p.id));

  return (
    <div className="space-y-3 mb-4" role="group" aria-label="Choose recipients">
      <div>
        <label htmlFor="recipient-search" className="block text-sm text-muted mb-1">Search people</label>
        <input id="recipient-search" type="search" value={query}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 min-h-[44px] text-text"
          onChange={(event) => setQuery(event.target.value)} disabled={loading || failed}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            const exact = matches.filter((p) => p.label.toLocaleLowerCase() === term
              || p.seed.toLocaleLowerCase() === term.replace(/^@/, ''));
            if (term && exact.length === 1 && !selected.has(exact[0].id)) onToggle(exact[0].id);
          }} />
      </div>
      {loading ? <p role="status">Loading your circle…</p>
        : failed ? <div role="alert" className="text-sm text-red-400">
          Your circle could not be loaded. <button type="button" className={buttonClass}
            onClick={() => window.location.reload()}>Retry circle</button>
        </div>
        : circle.length === 0 ? <p className="text-sm text-muted">Follow people to add them to your circle.</p>
        : <>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((p) => <PersonChip key={p.id} label={p.label} initials={p.initials}
              seed={p.seed} selected={selected.has(p.id)} noPicks={p.ratings.length === 0}
              onClick={() => onToggle(p.id)} />)}
          </div>
          {term && matches.length === 0 ? <p className="text-sm text-muted">No matching people.</p> : null}
          {!term && circle.length > 8 ? <button type="button" className={buttonClass}
            aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show less' : `Show all (${circle.length})`}
          </button> : null}
        </>}
      <div role="group" aria-label="Groups" className="space-y-2">
        <p className="font-display text-sm">Groups</p>
        {groupsLoading ? <p role="status">Loading your groups…</p>
          : groupsError ? <div role="alert" className="text-sm text-red-400">{groupsError}{' '}
            <button type="button" className={buttonClass} onClick={() => setRetry(retry + 1)}>Retry groups</button>
          </div>
          : groups.length === 0 ? <p className="text-sm text-muted">You have no groups yet.</p>
          : <div className="flex flex-wrap gap-2">{groups.map((group) => (
            <button type="button" key={group.id} aria-label={group.name}
              aria-pressed={Boolean(groupMembers[group.id])} disabled={pending !== null || loading || failed}
              className={`${buttonClass} ${groupMembers[group.id] ? 'border-accent bg-accent/10 text-text' : 'text-muted'}`}
              onClick={() => void toggleGroup(group)}>{group.name}</button>
          ))}</div>}
        {pending ? <p role="status">Loading group members…</p> : null}
        {memberError ? <div role="alert" className="text-sm text-red-400">{memberError.message}{' '}
          <button type="button" className={buttonClass} disabled={pending !== null}
            onClick={() => void toggleGroup(memberError.group)}>Retry {memberError.group.name}</button>
        </div> : null}
        {emptyGroup ? <p role="status">{emptyGroup} has no other members to invite.</p> : null}
      </div>
      <div role="group" aria-label="Selected" className="space-y-2">
        <p className="font-display text-sm" aria-live="polite">Selected · {recipients.length} {recipients.length === 1 ? 'person' : 'people'}</p>
        <div className="flex flex-wrap gap-2">{recipients.map((p) => (
          <button type="button" key={p.id} aria-label={`Remove ${p.label}`} className={buttonClass}
            onClick={() => onToggle(p.id)}>{p.label} <span aria-hidden="true">×</span></button>
        ))}</div>
      </div>
    </div>
  );
}

export function PersonChip({
  label,
  initials,
  seed,
  selected,
  onClick,
  noPicks = false,
}: {
  label: string;
  initials: string;
  seed: string;
  selected: boolean;
  onClick: () => void;
  /**
   * This person has ranked nothing, so they sway no picks — but they are still
   * invitable, and hiding them was the defect. The marker exists so an empty
   * contribution reads as expected rather than broken, which is what the
   * original "inert chip reads as broken" comment was really about.
   */
  noPicks?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={noPicks ? `${label} — no ranked bars yet` : label}
      onClick={onClick}
      className={[
        'flex items-center gap-2 pl-1 pr-4 py-1 rounded-full border transition-colors min-h-[44px] touch-manipulation',
        selected
          ? 'border-accent bg-accent/10 text-text'
          : 'border-border bg-surface text-muted',
      ].join(' ')}
    >
      <Avatar initials={initials} seed={seed} size="sm" />
      <span className="font-display text-sm">{label}</span>
      {noPicks ? (
        <span className="text-[10px] uppercase tracking-wider text-muted">
          no picks
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={selected ? 'text-accent' : 'text-muted'}
      >
        {selected ? '✓' : '+'}
      </span>
    </button>
  );
}

