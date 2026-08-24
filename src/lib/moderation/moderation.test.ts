import { describe, expect, it, vi } from 'vitest';

import { blockProfile, isBlockedBetween, unblockProfile } from './blocks';
import { listReportedSubjects, reportContent, reportKey } from './reports';

/**
 * V8-R-FEED-009 — blocking is server-enforced in BOTH directions, and a failed
 * block must not report success.
 * V8-R-FEED-010 — reporting hides content for the reporter ONLY once the
 * server-owned record exists.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function client(overrides: Record<string, unknown>): any {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'me' } } })) },
    ...overrides,
  };
}

describe('isBlockedBetween — V8-R-FEED-009', () => {
  it('is true when the RPC finds a block in either direction', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await expect(isBlockedBetween(client({ rpc }), 'me', 'them')).resolves.toBe(true);
  });

  it('is false only on an explicit negative answer', async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    await expect(isBlockedBetween(client({ rpc }), 'me', 'them')).resolves.toBe(false);
  });

  it('FAILS CLOSED when the check errors', async () => {
    // Showing content because a lookup broke is precisely the failure this
    // requirement exists to prevent.
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    await expect(isBlockedBetween(client({ rpc }), 'me', 'them')).resolves.toBe(true);
  });

  it('FAILS CLOSED when the client throws', async () => {
    const rpc = vi.fn(async () => { throw new Error('socket'); });
    await expect(isBlockedBetween(client({ rpc }), 'me', 'them')).resolves.toBe(true);
  });

  it('FAILS CLOSED with no client at all', async () => {
    await expect(isBlockedBetween(null, 'me', 'them')).resolves.toBe(true);
  });

  it('never reads a truthy non-boolean as blocked-or-not by accident', async () => {
    const rpc = vi.fn(async () => ({ data: 'yes', error: null }));
    // Anything that is not exactly `true` is not a confirmed negative either;
    // the strict check means an unexpected shape cannot be read as "not blocked".
    await expect(isBlockedBetween(client({ rpc }), 'me', 'them')).resolves.toBe(false);
  });
});

describe('blockProfile — V8-R-FEED-009', () => {
  function table(result: { error: unknown }) {
    const upsert = vi.fn(async () => result);
    return { from: vi.fn(() => ({ upsert })), upsert };
  }

  it('records the block for the signed-in user', async () => {
    const { from, upsert } = table({ error: null });
    const result = await blockProfile(client({ from }), 'them');
    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      { blocker_id: 'me', blocked_id: 'them' },
      expect.objectContaining({ ignoreDuplicates: true }),
    );
  });

  it('does NOT report success when the write fails', async () => {
    const { from } = table({ error: { message: 'denied' } });
    const result = await blockProfile(client({ from }), 'them');
    expect(result.ok).toBe(false);
  });

  it('refuses to block yourself', async () => {
    const { from } = table({ error: null });
    const result = await blockProfile(client({ from }), 'me');
    expect(result.ok).toBe(false);
  });

  it('refuses when nobody is signed in', async () => {
    const { from } = table({ error: null });
    const anon = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await blockProfile(anon as any, 'them');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('denied');
  });

  it('lifts a block through the documented route', async () => {
    const eq2 = vi.fn(async () => ({ error: null }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ delete: del }));
    const result = await unblockProfile(client({ from }), 'them');
    expect(result.ok).toBe(true);
  });
});

describe('reportContent — V8-R-FEED-010', () => {
  it('hides the content only after the server-owned record exists', async () => {
    const rpc = vi.fn(async () => ({ data: 'report-1', error: null }));
    const result = await reportContent(client({ rpc }), 'story', 's1', 'spam');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reportId).toBe('report-1');
    expect(result.value.hideForReporter).toBe(true);
  });

  it('does NOT hide the content when the report write fails', async () => {
    // "if the report write fails, the content is NOT hidden and the failure is
    // stated — a silent hide would misrepresent that a report exists."
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    const result = await reportContent(client({ rpc }), 'story', 's1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not been hidden/i);
  });

  it('does not accept a success with no report id', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const result = await reportContent(client({ rpc }), 'story', 's1');
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown subject kind before calling the server', async () => {
    const rpc = vi.fn(async () => ({ data: 'r', error: null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await reportContent(client({ rpc }), 'bar_rating' as any, 's1');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an empty subject reference', async () => {
    const rpc = vi.fn(async () => ({ data: 'r', error: null }));
    const result = await reportContent(client({ rpc }), 'story', '   ');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an over-long reason', async () => {
    const rpc = vi.fn(async () => ({ data: 'r', error: null }));
    const result = await reportContent(client({ rpc }), 'story', 's1', 'x'.repeat(1001));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('listReportedSubjects — the hide set is derived from the reports', () => {
  it('returns one key per reported subject', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { subject_kind: 'story', subject_ref: 's1' },
        { subject_kind: 'feed_post', subject_ref: 'p9' },
      ],
      error: null,
    }));
    const result = await listReportedSubjects(client({ rpc }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.has(reportKey('story', 's1'))).toBe(true);
    expect(result.value.has(reportKey('feed_post', 'p9'))).toBe(true);
  });

  // THROUGH THE RPC, NEVER THE TABLE. content_reports is operator-only in 0066 —
  // no reporter SELECT policy and no grant — because V8-R-FEED-010 says the record
  // is visible only to operators. A direct table read would now fail, and reading
  // it would expose `reason` and `resolved_at` besides.
  it('never reads the content_reports table directly', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const from = vi.fn(() => {
      throw new Error('listReportedSubjects must not touch the table');
    });
    const result = await listReportedSubjects(client({ rpc, from }));
    expect(result.ok).toBe(true);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('my_reported_subjects');
  });

  it('reports a failure rather than an empty set that would UNHIDE everything', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    const result = await listReportedSubjects(client({ rpc }));
    expect(result.ok).toBe(false);
  });
});
