'use client';

/**
 * /lists — user-curated bar lists (blueprint A3, Letterboxd core).
 * Create a named list, add bars from the catalog, view/remove. Local-only
 * via useLists (localStorage); server sync joins the D1 Supabase pass.
 */

import { useState } from 'react';
import Link from 'next/link';
import BarPicker from '@/components/BarPicker';
import { useLists } from '@/hooks/useLists';
import type { BarList } from '@/lib/lists';
import { barById } from '@/lib/demo';

export default function ListsPage(): JSX.Element {
  const { lists, createList, deleteList, addBarToList, removeBarFromList } =
    useLists();
  const [draftName, setDraftName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const submitCreate = (): void => {
    const created = createList(draftName);
    if (!created) return;
    setDraftName('');
    setOpenId(created.id);
  };

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4">
        <Link
          href="/rankings"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Rankings
        </Link>
        <p className="text-accent uppercase tracking-[0.25em] text-xs mt-4 mb-2 text-center">
          Curate
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2 text-center">
          Your lists
        </h1>
        <p className="text-muted text-sm max-w-md mx-auto text-center">
          Date bars, rooftops, dives worth the trek — name a list and stack
          it with bars. Lists live on this device for now.
        </p>
      </header>

      <section className="max-w-md mx-auto px-6">
        <form
          className="flex gap-2 mb-8"
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
        >
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder='e.g. "Top 10 date bars"'
            aria-label="New list name"
            className="flex-1 min-w-0 bg-surface border border-border rounded-2xl px-4 py-3 focus:border-accent outline-none text-base"
          />
          <button
            type="submit"
            className="bg-accent text-bg font-display text-sm px-5 rounded-2xl min-h-[44px] touch-manipulation shrink-0"
          >
            Create
          </button>
        </form>

        {lists.length === 0 ? (
          <div className="bg-surface border border-border rounded-3xl p-6 text-center">
            <p className="font-display text-xl mb-2">No lists yet.</p>
            <p className="text-muted text-sm leading-relaxed">
              Start one above — &ldquo;Rooftops&rdquo;, &ldquo;First
              dates&rdquo;, &ldquo;Show a tourist&rdquo;. Anything worth
              keeping a shortlist for.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {lists.map((list) => (
              <ListCard
                key={list.id}
                list={list}
                open={openId === list.id}
                onToggle={() =>
                  setOpenId(openId === list.id ? null : list.id)
                }
                onDelete={() => deleteList(list.id)}
                onAddBar={(barId) => addBarToList(list.id, barId)}
                onRemoveBar={(barId) => removeBarFromList(list.id, barId)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ListCard({
  list,
  open,
  onToggle,
  onDelete,
  onAddBar,
  onRemoveBar,
}: {
  list: BarList;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onAddBar: (barId: string) => void;
  onRemoveBar: (barId: string) => void;
}): JSX.Element {
  const [picking, setPicking] = useState(false);

  return (
    <article className="bg-surface border border-border rounded-3xl overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-baseline justify-between gap-3 text-left p-5 touch-manipulation"
      >
        <span className="font-display text-xl leading-tight truncate">
          {list.name}
        </span>
        <span className="text-muted text-xs shrink-0">
          {list.barIds.length} {list.barIds.length === 1 ? 'bar' : 'bars'}
          <span aria-hidden="true" className="ml-2">
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>

      {open ? (
        <div className="px-5 pb-5">
          {list.barIds.length > 0 ? (
            <ul className="mb-4">
              {list.barIds.map((barId, i) => {
                const bar = barById(barId);
                if (!bar) return null;
                return (
                  <li
                    key={barId}
                    className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="font-display text-sm">
                        <span className="text-accent mr-2 tabular-nums">
                          {i + 1}.
                        </span>
                        {bar.name}
                      </span>
                      <span className="text-muted text-xs uppercase tracking-wider ml-2">
                        {bar.neighborhood}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${bar.name} from ${list.name}`}
                      onClick={() => onRemoveBar(barId)}
                      className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted text-sm mb-4">
              Empty so far — add the first bar.
            </p>
          )}

          {picking ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-display text-xs uppercase tracking-[0.25em] text-muted">
                  Add to {list.name}
                </p>
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                >
                  Done
                </button>
              </div>
              <BarPicker
                onPick={(bar) => {
                  onAddBar(bar.id);
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="bg-accent text-bg font-display text-sm px-5 py-2.5 rounded-full min-h-[44px] touch-manipulation"
              >
                + Add a bar
              </button>
              <button
                type="button"
                aria-label={`Delete list ${list.name}`}
                onClick={onDelete}
                className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
              >
                Delete list
              </button>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
