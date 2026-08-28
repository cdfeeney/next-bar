import { describe, expect, it, vi } from 'vitest';

import {
  NIGHT_OUT_MEDIA_WINDOW_HOURS,
  describeNightOutMediaWindow,
  formatNightDate,
  isNightOutMediaLive,
  nightOutMediaExpiry,
  savedNightSummary,
} from '@/lib/nightOutMedia';
import {
  addNightOutMedia,
  archiveNightOut,
  fetchNightOutMedia,
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

describe('nightOutMediaExpiry (V8-R-NO-008)', () => {
  it('is the night 4:00 AM start plus 24 hours, in EDT', () => {
    // Night 2026-07-24 begins 2026-07-24 04:00 EDT = 08:00Z. Plus 24h.
    expect(nightOutMediaExpiry('2026-07-24')?.toISOString()).toBe(
      '2026-07-25T08:00:00.000Z',
    );
  });

  it('is the night 4:00 AM start plus 24 hours, in EST', () => {
    // Night 2026-01-23 begins 2026-01-23 04:00 EST = 09:00Z. Plus 24h.
    // The one-hour difference from the EDT case is the whole reason the offset
    // is measured rather than hardcoded.
    expect(nightOutMediaExpiry('2026-01-23')?.toISOString()).toBe(
      '2026-01-24T09:00:00.000Z',
    );
  });

  it('is exactly the requirement s number of hours after the start', () => {
    const expiry = nightOutMediaExpiry('2026-07-24');
    const start = Date.parse('2026-07-24T08:00:00.000Z');
    expect((expiry!.getTime() - start) / 3_600_000).toBe(
      NIGHT_OUT_MEDIA_WINDOW_HOURS,
    );
  });

  it('has no window for a night that is not a date', () => {
    expect(nightOutMediaExpiry('tonight')).toBeNull();
    expect(nightOutMediaExpiry('')).toBeNull();
    expect(nightOutMediaExpiry('2026-7-4')).toBeNull();
  });
});

describe('isNightOutMediaLive', () => {
  it('is open up to the instant before the boundary and closed at it', () => {
    const night = '2026-07-24';
    expect(
      isNightOutMediaLive(night, new Date('2026-07-25T07:59:59.999Z')),
    ).toBe(true);
    expect(isNightOutMediaLive(night, new Date('2026-07-25T08:00:00.000Z'))).toBe(
      false,
    );
  });

  it('is open during the night the plan is for', () => {
    // 11pm on the night itself — the moment people are actually out.
    expect(isNightOutMediaLive('2026-07-24', new Date('2026-07-25T03:00:00Z'))).toBe(
      true,
    );
  });

  it('treats an unreadable night as CLOSED, never as open forever', () => {
    // The dangerous direction is showing media the server has stopped serving.
    expect(isNightOutMediaLive('nonsense', new Date('2026-07-24T12:00:00Z'))).toBe(
      false,
    );
  });
});

describe('describeNightOutMediaWindow (the window in words)', () => {
  it('names the closing instant in New York time', () => {
    const words = describeNightOutMediaWindow('2026-07-24');
    expect(words).toContain('Saturday');
    expect(words).toContain('4:00');
  });

  it('says nothing at all when there is no window to state', () => {
    expect(describeNightOutMediaWindow('later')).toBeNull();
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
      await expect(fetchSavedNight(client, UUID_C)).resolves.toBeNull();
      await expect(fetchNightOutMedia(client, UUID_A)).resolves.toBeNull();
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
      id: UUID_C,
      title: 'Birthday',
      night: '2026-07-24',
      barCount: 2,
      archivedAt: '2026-07-25T05:00:00Z',
      photos: [
        { mediaId: UUID_A, storagePath: 'a/1.jpg' },
        { mediaId: UUID_B, storagePath: 'a/2.jpg' },
      ],
    });
  });

  it('returns the night with no photos rather than a ghost one', async () => {
    // The LEFT JOIN yields one all-null media half for a night whose photos
    // have all had their bytes removed. That night still exists.
    const { client } = rpcClient({
      data: [{ ...head, media_id: null, storage_path: null, sort_order: null }],
      error: null,
    });
    const night = await fetchSavedNight(client, UUID_C);
    expect(night?.id).toBe(UUID_C);
    expect(night?.photos).toEqual([]);
  });

  it('is null for a night this account cannot read, and on error', async () => {
    // Another account's id returns zero rows — the RPC filters on auth.uid().
    const other = rpcClient({ data: [], error: null });
    await expect(fetchSavedNight(other.client, UUID_C)).resolves.toBeNull();
    const failed = rpcClient({ data: null, error: { message: 'x' } });
    await expect(fetchSavedNight(failed.client, UUID_C)).resolves.toBeNull();
  });
});
