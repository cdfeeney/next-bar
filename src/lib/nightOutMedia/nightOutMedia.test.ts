import { describe, expect, it, vi } from 'vitest';

import {
  describeNightOutMediaWindow,
  formatNightDate,
  savedNightSummary,
} from '@/lib/nightOutMedia';
import {
  addNightOutMedia,
  archiveNightOut,
  fetchNightOutMedia,
  fetchNightOutMediaWindow,
  fetchSavedNight,
  fetchSavedNights,
} from '@/lib/nightOutMedia/server';

/**
 * The rules worth testing here are the ones that show or hide somebody's photo:
 * where the 24-hour window falls in BOTH zones, that an unparseable night is
 * closed rather than open, and that a failed read is never reported as an empty
 * archive.
 */

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';

type RpcResult = { data: unknown; error: unknown };

function rpcClient(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as Parameters<typeof fetchSavedNights>[0],
    rpc,
  };
}

describe('fetchNightOutMediaWindow (V8-R-NO-008, the SERVER owns the window)', () => {
  it('reports the window the server computed, not one derived here', async () => {
    const { client, rpc } = rpcClient({
      data: [
        {
          opens_at: '2026-07-24T21:00:00.000Z',
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: true,
          state: 'open',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toEqual({
      opensAt: '2026-07-24T21:00:00.000Z',
      expiresAt: '2026-07-25T21:00:00.000Z',
      isOpen: true,
      state: 'open',
    });
    expect(rpc).toHaveBeenCalledWith('night_out_media_window', {
      p_night_out: UUID_A,
    });
  });

  it('carries a closed window through as closed', async () => {
    const { client } = rpcClient({
      data: [
        {
          opens_at: '2026-07-24T21:00:00.000Z',
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: false,
          state: 'closed',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toEqual({
      opensAt: '2026-07-24T21:00:00.000Z',
      expiresAt: '2026-07-25T21:00:00.000Z',
      isOpen: false,
      state: 'closed',
    });
  });

  /**
   * THE WINDOW HAS TWO ENDS (round-3 panel, Codex, HIGH), so a not-open window
   * is two different answers and the server names which. A client that could
   * only see `is_open: false` had to derive "not yet" from the device clock —
   * the arithmetic this whole type exists to delete.
   */
  it('carries a window that has NOT OPENED YET as its own state', async () => {
    const { client } = rpcClient({
      data: [
        {
          opens_at: '2026-07-24T21:00:00.000Z',
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: false,
          state: 'before',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toEqual({
      opensAt: '2026-07-24T21:00:00.000Z',
      expiresAt: '2026-07-25T21:00:00.000Z',
      isOpen: false,
      state: 'before',
    });
  });

  it('refuses a row with no opens_at rather than inventing the lower bound', async () => {
    const { client } = rpcClient({
      data: [
        {
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: true,
          state: 'open',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toBeNull();
  });

  /**
   * A CANCELLED PLAN IS ITS OWN ANSWER (round-5 panel, Claude gate).
   * `add_night_out_media` refuses one outright, so reporting the window as
   * merely "closed" blamed the clock for a decision somebody made — and, before
   * the server carried the state at all, reported it as OPEN and offered an
   * Add-a-photo whose upload was then thrown away.
   */
  it('carries a cancelled plan as its own state, not as a closed window', async () => {
    const { client } = rpcClient({
      data: [
        {
          opens_at: '2026-07-24T21:00:00.000Z',
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: false,
          state: 'cancelled',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toEqual({
      opensAt: '2026-07-24T21:00:00.000Z',
      expiresAt: '2026-07-25T21:00:00.000Z',
      isOpen: false,
      state: 'cancelled',
    });
  });

  it('refuses an unrecognised state rather than defaulting it', async () => {
    // A defaulted 'closed' would tell a member their window had ended.
    const { client } = rpcClient({
      data: [
        {
          opens_at: '2026-07-24T21:00:00.000Z',
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: true,
          state: 'maybe',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toBeNull();
  });

  it('is null — "could not check" — on a failed read, never a closed window', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'nope' } });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toBeNull();
  });

  it('is null for a non-member, who gets zero rows rather than a window', async () => {
    const { client } = rpcClient({ data: [], error: null });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toBeNull();
  });

  it('refuses a row whose is_open is not a boolean rather than coercing it', async () => {
    // Coercing here would gate two authorized controls on a guess.
    const { client } = rpcClient({
      data: [
        {
          opens_at: '2026-07-24T21:00:00.000Z',
          expires_at: '2026-07-25T21:00:00.000Z',
          is_open: 'yes',
          state: 'open',
        },
      ],
      error: null,
    });
    await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toBeNull();
  });

  it('never reaches the server for a malformed plan id', async () => {
    const { client, rpc } = rpcClient({ data: [], error: null });
    await expect(fetchNightOutMediaWindow(client, 'nope')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('describeNightOutMediaWindow (the window in words)', () => {
  it('names the server closing instant in New York time', () => {
    // 2026-07-25T21:00Z is 5:00 PM EDT on the Saturday.
    const words = describeNightOutMediaWindow('2026-07-25T21:00:00.000Z');
    expect(words).toContain('Saturday');
    expect(words).toContain('5:00');
  });

  it('states the 9:00 PM scheduled start plus 24 hours as 9:00 PM the next evening', () => {
    // V8-R-NO-002 defaults the start to 9:00 PM; V8-R-NO-008 gives it 24 hours.
    // 2026-07-24 21:00 EDT = 2026-07-25T01:00Z, plus 24h = 2026-07-26T01:00Z,
    // which is 9:00 PM EDT on the Saturday.
    const words = describeNightOutMediaWindow('2026-07-26T01:00:00.000Z');
    expect(words).toContain('Saturday');
    expect(words).toContain('9:00');
  });

  it('says nothing at all when the instant cannot be read', () => {
    expect(describeNightOutMediaWindow('later')).toBeNull();
    expect(describeNightOutMediaWindow('')).toBeNull();
  });
});

describe('savedNightSummary (V8-R-ACC-002 metadata line)', () => {
  it('is one line of date, bar count and photo count', () => {
    expect(
      savedNightSummary({
        title: 'Birthday',
        night: '2026-07-24',
        barCount: 3,
        photoCount: 12,
      }),
    ).toBe('Friday, July 24 · 3 bars · 12 photos');
  });

  it('is singular for one', () => {
    expect(
      savedNightSummary({
        title: null,
        night: '2026-07-24',
        barCount: 1,
        photoCount: 1,
      }),
    ).toBe('Friday, July 24 · 1 bar · 1 photo');
  });

  it('names an unparseable night by its key rather than by a placeholder', () => {
    expect(formatNightDate('whenever')).toBe('whenever');
  });
});

describe('never throws (the module contract)', () => {
  /**
   * A client whose `rpc` THROWS — an offline transport, or a partial double in
   * somebody else's test. Caught by the night-out page suites, which mount the
   * real component against a Supabase stub that has no `rpc` at all: every read
   * became an unhandled rejection, and in the browser that leaves the photo
   * section stuck on "Loading photos…" forever, the one state that never
   * resolves into an honest message.
   *
   * Reading only the `error` field is what let it escape. Every RPC in this
   * module goes through one wrapper now, and this is the test that holds the
   * whole module to it rather than the one function that was noticed.
   */
  const throwing = {
    rpc: () => {
      throw new TypeError('supabase.rpc is not a function');
    },
  } as unknown as Parameters<typeof fetchSavedNights>[0];

  const missing = {} as unknown as Parameters<typeof fetchSavedNights>[0];

  it('reports a thrown call as a failed read, on every entry point', async () => {
    for (const client of [throwing, missing]) {
      await expect(fetchSavedNights(client)).resolves.toBeNull();
      await expect(fetchSavedNight(client, UUID_C)).resolves.toEqual({
        kind: 'failed',
      });
      await expect(fetchNightOutMedia(client, UUID_A)).resolves.toBeNull();
      await expect(fetchNightOutMediaWindow(client, UUID_A)).resolves.toBeNull();
      await expect(archiveNightOut(client, UUID_A)).resolves.toBeNull();
      await expect(addNightOutMedia(client, UUID_A, UUID_B)).resolves.toBeNull();
    }
  });

  it('never reports a thrown read as an EMPTY one', async () => {
    // The distinction the whole module rests on: null is "could not read", []
    // is "nothing there". A throw is the former.
    await expect(fetchSavedNights(throwing)).resolves.not.toEqual([]);
    await expect(fetchNightOutMedia(throwing, UUID_A)).resolves.not.toEqual([]);
  });
});

describe('addNightOutMedia', () => {
  it('sends both ids and returns the destination', async () => {
    const { client, rpc } = rpcClient({ data: UUID_C, error: null });
    await expect(addNightOutMedia(client, UUID_A, UUID_B)).resolves.toBe(UUID_C);
    expect(rpc).toHaveBeenCalledWith('add_night_out_media', {
      p_night_out: UUID_A,
      p_media: UUID_B,
    });
  });

  it('is null on refusal, and spends no round trip on a malformed id', async () => {
    const refused = rpcClient({ data: null, error: { message: 'denied' } });
    await expect(
      addNightOutMedia(refused.client, UUID_A, UUID_B),
    ).resolves.toBeNull();

    const { client, rpc } = rpcClient({ data: UUID_C, error: null });
    await expect(addNightOutMedia(client, 'not-a-uuid', UUID_B)).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('fetchNightOutMedia', () => {
  const row = {
    destination_id: UUID_C,
    media_id: UUID_B,
    author_id: UUID_A,
    storage_path: `${UUID_A}/photo.jpg`,
    created_at: '2026-07-25T02:00:00Z',
    expires_at: '2026-07-25T08:00:00Z',
  };

  it('maps a well-formed row', async () => {
    const { client } = rpcClient({ data: [row], error: null });
    await expect(fetchNightOutMedia(client, UUID_A)).resolves.toEqual([
      {
        destinationId: UUID_C,
        mediaId: UUID_B,
        authorId: UUID_A,
        storagePath: `${UUID_A}/photo.jpg`,
        createdAt: '2026-07-25T02:00:00Z',
        expiresAt: '2026-07-25T08:00:00Z',
      },
    ]);
  });

  it('distinguishes "no photos" from "could not load"', async () => {
    const empty = rpcClient({ data: [], error: null });
    await expect(fetchNightOutMedia(empty.client, UUID_A)).resolves.toEqual([]);
    const failed = rpcClient({ data: null, error: { message: 'x' } });
    await expect(fetchNightOutMedia(failed.client, UUID_A)).resolves.toBeNull();
  });

  it('drops a row it cannot render rather than rendering a hole', async () => {
    const { client } = rpcClient({
      data: [
        { ...row, storage_path: '' },
        { ...row, media_id: 'nope' },
        { ...row, expires_at: null },
      ],
      error: null,
    });
    await expect(fetchNightOutMedia(client, UUID_A)).resolves.toEqual([]);
  });
});

describe('archiveNightOut (V8-R-NO-009)', () => {
  it('reports the saved night and its photo count', async () => {
    const { client, rpc } = rpcClient({
      data: [{ saved_night_id: UUID_C, photo_count: 4 }],
      error: null,
    });
    await expect(archiveNightOut(client, UUID_A)).resolves.toEqual({
      savedNightId: UUID_C,
      photoCount: 4,
    });
    expect(rpc).toHaveBeenCalledWith('archive_night_out', {
      p_night_out: UUID_A,
    });
  });

  it('never reports success for a refusal', async () => {
    const failed = rpcClient({ data: null, error: { message: 'denied' } });
    await expect(archiveNightOut(failed.client, UUID_A)).resolves.toBeNull();
    // A response with no saved night id is a refusal too, however it arrived.
    const hollow = rpcClient({ data: [{ photo_count: 3 }], error: null });
    await expect(archiveNightOut(hollow.client, UUID_A)).resolves.toBeNull();
  });

  it('keeps "archived nothing" apart from "did not archive"', async () => {
    // The window closed with no photos in it: the archive DID happen and the
    // surface must say so honestly rather than reporting a failure.
    const { client } = rpcClient({
      data: [{ saved_night_id: UUID_C, photo_count: 0 }],
      error: null,
    });
    await expect(archiveNightOut(client, UUID_A)).resolves.toEqual({
      savedNightId: UUID_C,
      photoCount: 0,
    });
  });
});

describe('fetchSavedNights (V8-R-ACC-002)', () => {
  it('maps cards and defaults their counts', async () => {
    const { client } = rpcClient({
      data: [
        {
          id: UUID_C,
          title: 'Birthday',
          night: '2026-07-24',
          bar_count: 3,
          photo_count: 12,
          archived_at: '2026-07-25T05:00:00Z',
          // A non-id entry is dropped rather than handed to the boundary route.
          cover_media_ids: [UUID_A, 'a/photo.jpg', '', null],
        },
      ],
      error: null,
    });
    await expect(fetchSavedNights(client)).resolves.toEqual([
      {
        id: UUID_C,
        title: 'Birthday',
        night: '2026-07-24',
        barCount: 3,
        photoCount: 12,
        archivedAt: '2026-07-25T05:00:00Z',
        coverMediaIds: [UUID_A],
      },
    ]);
  });

  it('distinguishes an empty archive from an unreadable one', async () => {
    const empty = rpcClient({ data: [], error: null });
    await expect(fetchSavedNights(empty.client)).resolves.toEqual([]);
    const failed = rpcClient({ data: null, error: { message: 'x' } });
    await expect(fetchSavedNights(failed.client)).resolves.toBeNull();
  });
});

describe('fetchSavedNight (V8-R-ACC-002)', () => {
  const head = {
    id: UUID_C,
    title: 'Birthday',
    night: '2026-07-24',
    bar_count: 2,
    archived_at: '2026-07-25T05:00:00Z',
  };

  it('collapses the joined rows into one night with its photos in order', async () => {
    const { client } = rpcClient({
      data: [
        { ...head, media_id: UUID_A, storage_path: 'a/1.jpg', sort_order: 1 },
        { ...head, media_id: UUID_B, storage_path: 'a/2.jpg', sort_order: 2 },
      ],
      error: null,
    });
    await expect(fetchSavedNight(client, UUID_C)).resolves.toEqual({
      kind: 'ok',
      night: {
        id: UUID_C,
        title: 'Birthday',
        night: '2026-07-24',
        barCount: 2,
        archivedAt: '2026-07-25T05:00:00Z',
        photos: [
          { mediaId: UUID_A, storagePath: 'a/1.jpg' },
          { mediaId: UUID_B, storagePath: 'a/2.jpg' },
        ],
      },
    });
  });

  it('returns the night with no photos rather than a ghost one', async () => {
    // The LEFT JOIN yields one all-null media half for a night whose photos
    // have all had their bytes removed. That night still exists.
    const { client } = rpcClient({
      data: [{ ...head, media_id: null, storage_path: null, sort_order: null }],
      error: null,
    });
    const read = await fetchSavedNight(client, UUID_C);
    expect(read.kind).toBe('ok');
    expect(read.kind === 'ok' && read.night.id).toBe(UUID_C);
    expect(read.kind === 'ok' && read.night.photos).toEqual([]);
  });

  /**
   * THE FAILURE CLAUSE, IN THE TYPE. V8-R-ACC-002: "a night that cannot be read
   * states so rather than rendering an empty archive." A failed read and an
   * absent night used to be the same `null`, and /nights/[id] told the owner
   * their night was not in their archive whenever the request threw.
   */
  it('keeps "not yours / no such night" apart from "the read failed"', async () => {
    // Another account's id returns zero rows — the RPC filters on auth.uid().
    const other = rpcClient({ data: [], error: null });
    await expect(fetchSavedNight(other.client, UUID_C)).resolves.toEqual({
      kind: 'missing',
    });
    const failed = rpcClient({ data: null, error: { message: 'x' } });
    await expect(fetchSavedNight(failed.client, UUID_C)).resolves.toEqual({
      kind: 'failed',
    });
  });

  it('treats a row it cannot parse as a failed read, not an absent night', async () => {
    const garbled = rpcClient({
      data: [{ ...head, id: 'not-a-uuid' }],
      error: null,
    });
    await expect(fetchSavedNight(garbled.client, UUID_C)).resolves.toEqual({
      kind: 'failed',
    });
  });

  it('answers a malformed id without a round trip', async () => {
    const { client, rpc } = rpcClient({ data: [], error: null });
    await expect(fetchSavedNight(client, 'nope')).resolves.toEqual({
      kind: 'missing',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
