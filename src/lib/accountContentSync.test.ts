import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/accountContent.server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/accountContent.server')
  >('@/lib/accountContent.server');
  return {
    ...actual,
    fetchServerAccountContent: vi.fn(),
    fetchServerAccountContentKey: vi.fn(),
    upsertServerAccountContent: vi.fn(),
  };
});

import {
  fetchServerAccountContent,
  fetchServerAccountContentKey,
  upsertServerAccountContent,
} from '@/lib/accountContent.server';
import {
  readAccountContentOwner,
  readLocalAccountContent,
  stampLocalAccountContent,
  storageKeyForAccountContent,
  writeLocalAccountContent,
  type LocalAccountContent,
} from '@/lib/accountContent.local';
import {
  classifyAccountContent,
  readConfirmedAccountContentMeta,
} from '@/lib/accountContent.confirmed';
import { contentIdentity } from '@/lib/accountContent.digest';
import {
  readQuarantineStore,
  readQuarantinedAccountContent,
  updateQuarantinedEnvelope,
} from '@/lib/accountContent.quarantine';
import {
  listAccountContentTooLargeKeys,
  resetAccountContentCapability,
  wasAccountContentClockRejected,
} from '@/lib/accountContent.capability';
import { retryableOutcome } from '@/lib/accountContent.retry';
import {
  reconcileQuarantinedAccountContent,
  resolveAccountContentConflict,
  syncAccountContent,
  syncAccountContentKey,
} from '@/lib/accountContentSync';

const fetchAll = vi.mocked(fetchServerAccountContent);
const fetchKey = vi.mocked(fetchServerAccountContentKey);
const upsert = vi.mocked(upsertServerAccountContent);
const client = {} as SupabaseClient;
const T1 = '2026-08-01T20:00:00.000Z';
const T2 = '2026-08-02T20:00:00.000Z';
const T3 = '2026-08-03T20:00:00.000Z';
const USER = 'user-a';

function lists(at: string, barIds: string[]): LocalAccountContent {
  return {
    clientUpdatedAt: at,
    data: [{ id: 'want-to-go', name: 'Want to go', barIds, createdAt: T1, updatedAt: at }],
  };
}

function ok(value: LocalAccountContent | 'absent') {
  return { kind: 'ok' as const, value };
}

function seedLocal(value: LocalAccountContent): void {
  if (value.data !== null) {
    window.localStorage.setItem(storageKeyForAccountContent('lists'), JSON.stringify(value.data));
  }
  stampLocalAccountContent('lists', value.clientUpdatedAt);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  resetAccountContentCapability();
  fetchAll.mockResolvedValue({ kind: 'ok', content: new Map() });
  fetchKey.mockResolvedValue(ok('absent'));
  upsert.mockResolvedValue({ kind: 'ok' });
});

describe('account content reconciliation', () => {
  it('uploads first-sign-in anonymous content and latches its owner', async () => {
    seedLocal(lists(T1, ['attaboy']));
    fetchKey.mockResolvedValue(ok(lists(T1, ['attaboy'])));
    const report = await syncAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(report.lists).toBe('uploaded');
    expect(upsert).toHaveBeenCalledWith(client, USER, 'lists', lists(T1, ['attaboy']));
    expect(readAccountContentOwner()).toBe(USER);
  });

  it('hydrates a second device without uploading empty local state', async () => {
    fetchAll.mockResolvedValue({
      kind: 'ok',
      content: new Map([['lists', lists(T2, ['attaboy', 'sisters'])]]),
    });
    const report = await syncAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(report.lists).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T2, ['attaboy', 'sisters']) });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('uses last-write-wins in both directions and lets server win a divergent tie', async () => {
    seedLocal(lists(T2, ['local']));
    fetchAll.mockResolvedValue({
      kind: 'ok',
      content: new Map([['lists', lists(T1, ['server-old'])]]),
    });
    fetchKey.mockResolvedValue(ok(lists(T2, ['local'])));
    expect((await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true })).lists).toBe('uploaded');

    window.localStorage.clear();
    seedLocal(lists(T1, ['local-old']));
    fetchAll.mockResolvedValue({
      kind: 'ok',
      content: new Map([['lists', lists(T2, ['server-new'])]]),
    });
    expect((await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true })).lists).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T2, ['server-new']) });

    writeLocalAccountContent('lists', lists(T2, ['losing-tie']));
    fetchAll.mockResolvedValue({
      kind: 'ok',
      content: new Map([['lists', lists(T2, ['server-tie'])]]),
    });
    expect((await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true })).lists).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T2, ['server-tie']) });
  });

  it('propagates a newer local deletion as an explicit tombstone', async () => {
    seedLocal(lists(T1, ['attaboy']));
    window.localStorage.removeItem(storageKeyForAccountContent('lists'));
    stampLocalAccountContent('lists', T3);
    fetchKey
      .mockResolvedValueOnce(ok(lists(T1, ['server-old'])))
      .mockResolvedValueOnce(ok({ data: null, clientUpdatedAt: T3 }));
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('uploaded');
    expect(upsert).toHaveBeenCalledWith(client, USER, 'lists', {
      data: null,
      clientUpdatedAt: T3,
    });
  });

  it('never clobbers a local edit made while an upload is in flight', async () => {
    seedLocal(lists(T2, ['captured']));
    fetchKey
      .mockResolvedValueOnce(ok(lists(T1, ['server-old'])))
      .mockResolvedValueOnce(ok(lists(T2, ['captured'])));
    upsert.mockImplementation(async () => {
      writeLocalAccountContent('lists', lists(T3, ['mid-flight']));
      return { kind: 'ok' };
    });
    expect(
      await syncAccountContentKey({
        supabase: client,
        userId: 'u',
        key: 'lists',
        stillCurrent: () => true,
      }),
    ).toBe('uploaded');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T3, ['mid-flight']) });
  });

  it('fails closed on fetch failure and abandons in-flight work after an epoch change', async () => {
    seedLocal(lists(T1, ['keep']));
    fetchAll.mockResolvedValue({ kind: 'failed' });
    const failed = await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true });
    expect(new Set(Object.values(failed))).toEqual(new Set(['fetch-failed']));
    expect(readAccountContentOwner()).toBeNull();
    expect(upsert).not.toHaveBeenCalled();

    fetchAll.mockResolvedValue({ kind: 'ok', content: new Map() });
    const aborted = await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => false });
    expect(new Set(Object.values(aborted))).toEqual(new Set(['aborted']));
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('server read-back confirmation (v2.1)', () => {
  it('an errorless upsert WITHOUT read-back is uploaded-unconfirmed and stays dirty', async () => {
    seedLocal(lists(T2, ['local']));
    fetchKey
      .mockResolvedValueOnce(ok('absent')) // pre-upload state
      .mockResolvedValueOnce({ kind: 'failed' }); // read-back fails
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('uploaded-unconfirmed');
    expect(readConfirmedAccountContentMeta('lists')).toBeNull();
    expect(classifyAccountContent('lists', USER)).toBe('dirty');
  });

  it('a MATCHING read-back confirms: confirmed metadata recorded, key classifies clean', async () => {
    seedLocal(lists(T2, ['local']));
    fetchKey
      .mockResolvedValueOnce(ok('absent'))
      .mockResolvedValueOnce(ok(lists(T2, ['local'])));
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('uploaded');
    const confirmed = readConfirmedAccountContentMeta('lists');
    expect(confirmed?.userId).toBe(USER);
    expect(confirmed?.clock).toBe(T2);
    expect(classifyAccountContent('lists', USER)).toBe('clean');
  });

  it('a DIVERGENT read-back (LWW rejected the write) hydrates the server value', async () => {
    seedLocal(lists(T2, ['local']));
    fetchKey
      .mockResolvedValueOnce(ok('absent'))
      .mockResolvedValueOnce(ok(lists(T3, ['server-won'])));
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({
      status: 'present',
      value: lists(T3, ['server-won']),
    });
    expect(classifyAccountContent('lists', USER)).toBe('clean');
  });

  it('an equal fetch (in-sync) is itself a read-back and confirms', async () => {
    seedLocal(lists(T2, ['same']));
    fetchAll.mockResolvedValue({
      kind: 'ok',
      content: new Map([['lists', lists(T2, ['same'])]]),
    });
    const report = await syncAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(report.lists).toBe('in-sync');
    expect(classifyAccountContent('lists', USER)).toBe('clean');
  });

  it('propagates unavailable / auth-rejected / too-large without retry-shaped lies', async () => {
    seedLocal(lists(T2, ['local']));
    fetchAll.mockResolvedValue({ kind: 'unavailable' });
    expect(
      (await syncAccountContent({ supabase: client, userId: USER, stillCurrent: () => true })).lists,
    ).toBe('unavailable');

    fetchAll.mockResolvedValue({ kind: 'auth-rejected' });
    expect(
      (await syncAccountContent({ supabase: client, userId: USER, stillCurrent: () => true })).lists,
    ).toBe('auth-rejected');

    fetchKey.mockResolvedValue(ok('absent'));
    upsert.mockResolvedValue({ kind: 'too-large' });
    expect(
      await syncAccountContentKey({ supabase: client, userId: USER, key: 'lists', stillCurrent: () => true }),
    ).toBe('too-large');
  });

  it('quarantines invalid raw text VERBATIM before hydrating over it', async () => {
    window.localStorage.setItem(storageKeyForAccountContent('lists'), '{broken');
    fetchKey.mockResolvedValue(ok(lists(T2, ['server'])));
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('hydrated');
    expect(readQuarantineStore().rawInvalid[USER]?.lists?.raw).toBe('{broken');
    expect(readLocalAccountContent('lists')).toEqual({
      status: 'present',
      value: lists(T2, ['server']),
    });
  });
});

describe('santa round-1 hardening', () => {
  it('a same-clock DIFFERENT-data mid-flight edit is never overwritten by the read-back', async () => {
    seedLocal(lists(T2, ['captured']));
    fetchKey
      .mockResolvedValueOnce(ok('absent'))
      .mockResolvedValueOnce(ok(lists(T2, ['captured'])));
    upsert.mockImplementation(async () => {
      // Same clock, different data (a non-stamping writer slipped in).
      window.localStorage.setItem(
        storageKeyForAccountContent('lists'),
        JSON.stringify(lists(T2, ['replaced-no-bump']).data),
      );
      return { kind: 'ok' };
    });
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('uploaded-unconfirmed');
    expect(readLocalAccountContent('lists')).toEqual({
      status: 'present',
      value: lists(T2, ['replaced-no-bump']),
    });
  });

  it('a STALE same-digest confirmation never releases an envelope whose upload failed', async () => {
    // Envelope T2; confirmed-meta carries the same digest but clock T1
    // (recorded long ago). The upload fails — the fresh-confirmation check
    // must keep the envelope.
    const value = lists(T2, ['device']);
    const id = contentIdentity(value.data);
    updateQuarantinedEnvelope(USER, 'lists', {
      data: value.data,
      clientUpdatedAt: T2,
      digest: id.digest,
      byteLength: id.byteLength,
      quarantinedAt: T2,
      status: 'quarantined',
      confirmedAtCapture: null,
    });
    window.localStorage.setItem(
      'next-bar:account-content:confirmed:v2',
      JSON.stringify({
        lists: {
          version: 2,
          userId: USER,
          clock: T1,
          digest: id.digest,
          byteLength: id.byteLength,
          confirmedAt: T1,
        },
      }),
    );
    fetchKey.mockResolvedValue(ok('absent'));
    upsert.mockResolvedValue({ kind: 'failed' });

    const outcomes = await reconcileQuarantinedAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(outcomes.lists).toBe('kept-pending');
    expect(readQuarantinedAccountContent(USER).lists?.data).toEqual(value.data);
  });

  it('too-large is NOTED per key for the visible-failure surface and cleared on success', async () => {
    seedLocal(lists(T2, ['big']));
    fetchKey.mockResolvedValue(ok('absent'));
    upsert.mockResolvedValue({ kind: 'too-large' });
    await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(listAccountContentTooLargeKeys()).toContain('lists');

    upsert.mockResolvedValue({ kind: 'ok' });
    fetchKey
      .mockResolvedValueOnce(ok('absent'))
      .mockResolvedValueOnce(ok(lists(T2, ['big'])));
    await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(listAccountContentTooLargeKeys()).not.toContain('lists');
  });

  it('invalid-clock (22023) propagates as its own non-retryable surfaced outcome', async () => {
    seedLocal(lists(T2, ['skewed']));
    fetchKey.mockResolvedValue(ok('absent'));
    upsert.mockResolvedValue({ kind: 'invalid-clock' });
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: USER,
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('invalid-clock');
    expect(wasAccountContentClockRejected()).toBe(true);
    expect(retryableOutcome(outcome)).toBe(false);
  });
});

describe('quarantine restore reconciliation (v2.1)', () => {
  function envelopeFor(
    value: LocalAccountContent,
    extra?: Partial<import('@/lib/accountContent.quarantine').QuarantineEnvelope>,
  ): void {
    const id = contentIdentity(value.data);
    updateQuarantinedEnvelope(USER, 'lists', {
      data: value.data,
      clientUpdatedAt: value.clientUpdatedAt,
      digest: id.digest,
      byteLength: id.byteLength,
      quarantinedAt: T2,
      status: 'quarantined',
      confirmedAtCapture: null,
      ...extra,
    });
  }

  it('equal digest resolves cleanly — envelope released, nothing uploaded', async () => {
    envelopeFor(lists(T2, ['same']));
    // Same DATA (equal digest), later server clock: presence is proven.
    fetchKey.mockResolvedValue(
      ok({ data: lists(T2, ['same']).data, clientUpdatedAt: T3 }),
    );
    const outcomes = await reconcileQuarantinedAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(outcomes.lists).toBe('released-equal');
    expect(readQuarantinedAccountContent(USER)).toEqual({});
    expect(upsert).not.toHaveBeenCalled();
  });

  it('an envelope that wins LWW is uploaded with confirmation, then released', async () => {
    envelopeFor(lists(T3, ['device-newer']));
    fetchKey
      .mockResolvedValueOnce(ok(lists(T1, ['server-old'])))
      .mockResolvedValueOnce(ok(lists(T3, ['device-newer'])));
    const outcomes = await reconcileQuarantinedAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(outcomes.lists).toBe('restored-uploaded');
    expect(readQuarantinedAccountContent(USER)).toEqual({});
    expect(upsert).toHaveBeenCalledWith(client, USER, 'lists', {
      data: lists(T3, ['device-newer']).data,
      clientUpdatedAt: T3,
    });
  });

  it('a LOSING envelope that was server-confirmed at capture is released (presence was proven)', async () => {
    envelopeFor(lists(T1, ['old-confirmed']), {
      confirmedAtCapture: { clock: T1 },
    });
    fetchKey.mockResolvedValue(ok(lists(T3, ['server-newer'])));
    const outcomes = await reconcileQuarantinedAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(outcomes.lists).toBe('released-confirmed-stale');
    expect(readQuarantinedAccountContent(USER)).toEqual({});
  });

  it('a LOSING unconfirmed envelope is RETAINED as a conflict, never deleted', async () => {
    envelopeFor(lists(T1, ['device-unconfirmed']));
    fetchKey.mockResolvedValue(ok(lists(T3, ['server-newer'])));
    const outcomes = await reconcileQuarantinedAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(outcomes.lists).toBe('conflict-retained');
    const envelope = readQuarantinedAccountContent(USER).lists;
    expect(envelope?.status).toBe('conflict');
    expect(envelope?.data).toEqual(lists(T1, ['device-unconfirmed']).data);
  });

  it('fetch failure keeps the envelope pending — retry later, no loss', async () => {
    envelopeFor(lists(T2, ['kept']));
    fetchKey.mockResolvedValue({ kind: 'failed' });
    const outcomes = await reconcileQuarantinedAccountContent({
      supabase: client,
      userId: USER,
      stillCurrent: () => true,
    });
    expect(outcomes.lists).toBe('kept-pending');
    expect(readQuarantinedAccountContent(USER).lists).toBeDefined();
  });
});

describe('conflict resolution choices', () => {
  function conflictEnvelope(value: LocalAccountContent): void {
    const id = contentIdentity(value.data);
    updateQuarantinedEnvelope(USER, 'lists', {
      data: value.data,
      clientUpdatedAt: value.clientUpdatedAt,
      digest: id.digest,
      byteLength: id.byteLength,
      quarantinedAt: T2,
      status: 'conflict',
      confirmedAtCapture: null,
    });
  }

  it('use-device restamps, uploads with confirmation, hydrates, and releases', async () => {
    conflictEnvelope(lists(T1, ['device']));
    const NOW = new Date('2026-08-04T00:00:00.000Z');
    fetchKey.mockResolvedValue(
      ok({ data: lists(T1, ['device']).data, clientUpdatedAt: NOW.toISOString() }),
    );
    const outcome = await resolveAccountContentConflict({
      supabase: client,
      userId: USER,
      key: 'lists',
      choice: 'use-device',
      stillCurrent: () => true,
      now: () => NOW,
    });
    expect(outcome).toBe('used-device');
    expect(readQuarantinedAccountContent(USER)).toEqual({});
    expect(readLocalAccountContent('lists')?.status).toBe('present');
  });

  it('keep-account is the explicit discard — envelope released, no upload', async () => {
    conflictEnvelope(lists(T1, ['device']));
    const outcome = await resolveAccountContentConflict({
      supabase: client,
      userId: USER,
      key: 'lists',
      choice: 'keep-account',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('kept-account');
    expect(readQuarantinedAccountContent(USER)).toEqual({});
    expect(upsert).not.toHaveBeenCalled();
  });

  it('later defers — the conflict envelope survives untouched', async () => {
    conflictEnvelope(lists(T1, ['device']));
    const outcome = await resolveAccountContentConflict({
      supabase: client,
      userId: USER,
      key: 'lists',
      choice: 'later',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('deferred');
    expect(readQuarantinedAccountContent(USER).lists?.status).toBe('conflict');
  });
});
