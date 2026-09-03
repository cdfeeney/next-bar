import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORIES_SEEN_STORAGE_KEY, ageLabel, initialsFor, taggedLabel } from './storyStore';

/**
 * The pure helpers that survived the move to a server-backed store.
 *
 * This file used to test the local-first store itself — own items in
 * `localStorage`, seeded groups, seeded feed, quota refusal, the local untag
 * record. All of that is deleted, not moved: migration 0065 made the database
 * authoritative, so those behaviours are proven in
 * `src/lib/stories.server.test.ts` (client contract) and
 * `src/lib/storiesRls.live.test.ts` (authorisation, two identities, needs a
 * database and does not run in this gate).
 */

/**
 * THE CLIENT THIS STORE HANDS TO THE STORIES MODULE — pinned at the source.
 *
 * A source assertion rather than a behavioural one, deliberately, because the
 * invariant IS an import choice and nothing observable distinguishes the two
 * clients until a real session exists. The defect it guards (Codex independent
 * review, 2026-09-02, CRITICAL) was exactly this: the store passed the plain
 * `@/lib/supabase` singleton — `createClient`, session in localStorage — while
 * the app signs in through `getBrowserSupabase()`, a `createBrowserClient` whose
 * session lives in COOKIES. The operation then ran across TWO identities: bytes
 * uploaded under the browser session, `publish_story` executed on a client with
 * none. Three green gates could not see it, and a cross-client token fallback
 * made the symptom disappear while leaving the split in place.
 *
 * So the thing worth pinning is that this file never again reaches for the
 * session-less singleton.
 */
describe('the Supabase client the story store passes down', () => {
  const source = readFileSync(path.join(__dirname, 'storyStore.ts'), 'utf8');

  it('is the browser client that holds the session', () => {
    expect(source).toContain("from '@/lib/supabase/client'");
    expect(source).toContain('getBrowserSupabase');
  });

  it('is never the plain singleton, whose session lives somewhere else', () => {
    // Matches `from '@/lib/supabase'` exactly — not the `/client` subpath.
    expect(source).not.toMatch(/from '@\/lib\/supabase'/);
  });

  it('hands the SAME client to every call, so one operation is one identity', () => {
    // Upload, mint, RPC and removal must not be split across clients again.
    const calls = source.match(
      /(fetchVisibleStories|publishStory|deleteStory|removeMyStoryTag)\(\s*([A-Za-z0-9_().]+)/g,
    ) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call).toContain('getBrowserSupabase()');
  });
});

describe('the surviving story storage key', () => {
  it('is the per-device read state and nothing else', () => {
    expect(STORIES_SEEN_STORAGE_KEY).toBe('next-bar:stories-seen:v1');
  });
});

describe('ageLabel', () => {
  const now = Date.parse('2026-08-22T12:00:00.000Z');
  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it('reads "now" under a minute', () => {
    expect(ageLabel(ago(30_000), now)).toBe('now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(ageLabel(ago(8 * 60_000), now)).toBe('8m');
    expect(ageLabel(ago(3 * 3_600_000), now)).toBe('3h');
    expect(ageLabel(ago(2 * 86_400_000), now)).toBe('2d');
  });

  it('never renders a negative age from a clock that is behind', () => {
    expect(ageLabel(new Date(now + 60_000).toISOString(), now)).toBe('now');
  });
});

describe('initialsFor', () => {
  it('takes the first and last initial of a full name', () => {
    expect(initialsFor('Claire Dunphy')).toBe('CD');
  });

  it('takes two letters of a single name', () => {
    expect(initialsFor('sasha')).toBe('SA');
  });

  it('degrades to a neutral mark rather than throwing on empty input', () => {
    expect(initialsFor(null)).toBe('··');
    expect(initialsFor('   ')).toBe('··');
  });
});

describe('taggedLabel', () => {
  const person = (name: string) => ({ id: name, handle: name, name, initials: 'XX' });

  it('is null when nobody is tagged', () => {
    expect(taggedLabel([])).toBeNull();
  });

  it('names one person, and collapses the rest into +N', () => {
    expect(taggedLabel([person('Claire Dunphy')])).toBe('Claire');
    expect(taggedLabel([person('Claire D'), person('Dev P'), person('Sasha R')]))
      .toBe('Claire +2');
  });
});
