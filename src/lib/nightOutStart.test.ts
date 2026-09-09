import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteToNightOut } from '@/lib/nightOuts.server';
import { inviteAll, startOutcome } from '@/lib/nightOutStart';

vi.mock('@/lib/nightOuts.server', () => ({ inviteToNightOut: vi.fn() }));

const supabase = {} as SupabaseClient;
const planId = '00000000-0000-0000-0000-000000000001';
const first = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
const second = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const invite = vi.mocked(inviteToNightOut);

beforeEach(() => vi.resetAllMocks());

describe('inviteAll', () => {
  it('filters non-UUIDs and records each result in input order, including duplicates', async () => {
    invite.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(inviteAll(supabase, planId, ['you', first, '@demo', second, '', first]))
      .resolves.toEqual({ invited: [first, first], failed: [second] });
    expect(invite.mock.calls).toEqual([
      [supabase, planId, first],
      [supabase, planId, second],
      [supabase, planId, first],
    ]);
  });

  it('waits for each invitation before calling the next', async () => {
    let resolveFirst!: (value: boolean) => void;
    invite.mockReturnValueOnce(new Promise<boolean>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(false);

    const result = inviteAll(supabase, planId, [first, second]);
    expect(invite.mock.calls).toEqual([[supabase, planId, first]]);
    resolveFirst(true);
    await expect(result).resolves.toEqual({ invited: [first], failed: [second] });
    expect(invite.mock.calls).toEqual([[supabase, planId, first], [supabase, planId, second]]);
  });

  it('returns empty results without calling invite when no UUIDs remain', async () => {
    await expect(inviteAll(supabase, planId, ['you', 'demo']))
      .resolves.toEqual({ invited: [], failed: [] });
    expect(invite).not.toHaveBeenCalled();
  });
});

describe('startOutcome', () => {
  const clear = {
    refusedEdits: [],
    failedInvites: 0,
    nightMoved: null,
    editsTimedOut: false,
  };

  it('navigates when no trigger is present', () => {
    expect(startOutcome(clear)).toBe('navigate');
  });

  it.each([
    { refusedEdits: ['time'] },
    { failedInvites: 1 },
    { nightMoved: '2026-09-09' },
    { nightMoved: '' },
    { editsTimedOut: true },
  ])('holds for an individual trigger: %j', (trigger) => {
    expect(startOutcome({ ...clear, ...trigger })).toBe('hold');
  });
});
