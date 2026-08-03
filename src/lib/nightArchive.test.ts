import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ARCHIVED_NIGHTS,
  NIGHT_ARCHIVE_STORAGE_KEY,
  archiveNight,
  clearNightArchive,
  listArchivedNights,
} from '@/lib/nightArchive';
import { NIGHT_LOG_STORAGE_KEY, recordVisit } from '@/lib/nightLog';

describe('nightArchive', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty and ignores corrupt storage', () => {
    expect(listArchivedNights()).toEqual([]);
    window.localStorage.setItem(NIGHT_ARCHIVE_STORAGE_KEY, '{not json');
    expect(listArchivedNights()).toEqual([]);
  });

  it('archives a night and lists newest-first', () => {
    archiveNight({
      nightKey: '2026-07-30',
      visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
    });
    archiveNight({
      nightKey: '2026-08-01',
      visits: [{ barId: 'death-and-co', at: '2026-08-02T01:00:00.000Z' }],
    });
    const nights = listArchivedNights();
    expect(nights.map((n) => n.nightKey)).toEqual(['2026-08-01', '2026-07-30']);
    expect(nights[1].visits[0].barId).toBe('attaboy');
  });

  it('re-archiving the same nightKey replaces, never duplicates', () => {
    archiveNight({
      nightKey: '2026-08-01',
      visits: [{ barId: 'attaboy', at: '2026-08-02T01:00:00.000Z' }],
    });
    archiveNight({
      nightKey: '2026-08-01',
      visits: [
        { barId: 'attaboy', at: '2026-08-02T01:00:00.000Z' },
        { barId: 'death-and-co', at: '2026-08-02T02:00:00.000Z' },
      ],
    });
    const nights = listArchivedNights();
    expect(nights).toHaveLength(1);
    expect(nights[0].visits).toHaveLength(2);
  });

  it('ignores nights with no visits', () => {
    archiveNight({ nightKey: '2026-08-01', visits: [] });
    expect(listArchivedNights()).toEqual([]);
  });

  it('round-trips the ratings snapshot; entries without one stay snapshot-less', () => {
    archiveNight({
      nightKey: '2026-08-01',
      visits: [{ barId: 'attaboy', at: '2026-08-02T01:00:00.000Z' }],
      ratings: [
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-08-02T02:00:00.000Z' },
      ],
    });
    archiveNight({
      nightKey: '2026-07-30',
      visits: [{ barId: 'death-and-co', at: '2026-07-31T01:00:00.000Z' }],
    });
    const nights = listArchivedNights();
    expect(nights[0].ratings).toEqual([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-08-02T02:00:00.000Z' },
    ]);
    expect(nights[1].ratings).toBeUndefined();
  });

  it('caps the archive, dropping the OLDEST nights', () => {
    for (let i = 0; i < MAX_ARCHIVED_NIGHTS + 5; i++) {
      const day = String((i % 27) + 1).padStart(2, '0');
      const month = String(Math.floor(i / 27) + 1).padStart(2, '0');
      archiveNight({
        nightKey: `2026-${month}-${day}`,
        visits: [{ barId: 'attaboy', at: '2026-01-01T00:00:00.000Z' }],
      });
    }
    const nights = listArchivedNights();
    expect(nights).toHaveLength(MAX_ARCHIVED_NIGHTS);
    // Newest survive; the very first keys inserted are gone.
    expect(nights.some((n) => n.nightKey === '2026-01-01')).toBe(false);
  });

  it('clearNightArchive empties it', () => {
    archiveNight({
      nightKey: '2026-08-01',
      visits: [{ barId: 'attaboy', at: '2026-08-02T01:00:00.000Z' }],
    });
    clearNightArchive();
    expect(listArchivedNights()).toEqual([]);
  });
});

describe('nightLog rollover archives the displaced night', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("tonight's first visit archives last night's log instead of discarding it", () => {
    // Friday night visit…
    recordVisit('attaboy', new Date('2026-07-31T23:00:00-04:00'));
    recordVisit('death-and-co', new Date('2026-08-01T01:00:00-04:00'));
    // …then the first visit of Saturday night (after 6am rollover).
    recordVisit('employees-only', new Date('2026-08-01T22:00:00-04:00'));

    const archived = listArchivedNights();
    expect(archived).toHaveLength(1);
    expect(archived[0].nightKey).toBe('2026-07-31');
    expect(archived[0].visits.map((v) => v.barId)).toEqual([
      'attaboy',
      'death-and-co',
    ]);
    // The rollover writes a ratings SNAPSHOT (empty here — nothing was
    // rated) so archived nights never re-join mutable live ratings.
    expect(archived[0].ratings).toEqual([]);
    // The live log now holds ONLY the new night.
    const live = JSON.parse(
      window.localStorage.getItem(NIGHT_LOG_STORAGE_KEY) as string,
    );
    expect(live.night).toBe('2026-08-01');
  });

  it('same-night visits do NOT archive anything', () => {
    recordVisit('attaboy', new Date('2026-07-31T23:00:00-04:00'));
    recordVisit('death-and-co', new Date('2026-08-01T01:00:00-04:00'));
    expect(listArchivedNights()).toEqual([]);
  });
});
