import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STORIES_STORAGE_KEY,
  STORY_REPLIES_STORAGE_KEY,
  loadOwnItems,
  loadReplies,
  saveOwnItems,
  saveReply,
  seededFeed,
  seededGroups,
  type StoryItem,
} from './storyStore';

/**
 * The two rules that cannot be read off the surface: what happens when the
 * device store REFUSES a write, and who the seed is allowed to include.
 */

function item(id: string, bytes = 8): StoryItem {
  return {
    id,
    postedAt: new Date().toISOString(),
    barId: null,
    caption: null,
    tagged: [],
    photo: { kind: 'single', main: 'x'.repeat(bytes), inset: null },
    audience: 'friends',
    audienceHandles: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('saveOwnItems', () => {
  it('reports success and stores the items when the quota allows it', () => {
    expect(saveOwnItems([item('a'), item('b')])).toBe(true);
    expect(loadOwnItems().map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest item and retries when the write overflows the quota', () => {
    const real = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string, value: string) => {
        // Anything holding more than one item is "too big" for this device.
        if (key === STORIES_STORAGE_KEY && value.includes('"id":"a"')) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        real(key, value);
      },
    );

    expect(saveOwnItems([item('a'), item('b')])).toBe(true);
    expect(loadOwnItems().map((entry) => entry.id)).toEqual(['b']);
  });

  it('reports failure when even the newest item will not fit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string) => {
        if (key === STORIES_STORAGE_KEY) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
      },
    );

    // The caller confirms the share off this boolean, so a swallowed failure
    // here is a story the user was told is live and that is gone on reload.
    expect(saveOwnItems([item('a')])).toBe(false);
  });
});

describe('saveReply', () => {
  it('stores the reply and reports success', () => {
    expect(saveReply('item-1', 'see you there')).toBe(true);
    expect(loadReplies().map((entry) => entry.text)).toEqual(['see you there']);
  });

  it('reports failure when the device refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === STORY_REPLIES_STORAGE_KEY) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
    });

    // The viewer clears the field and announces "Reply sent" off this
    // boolean. Swallowing the failure threw the message away and said it
    // arrived.
    expect(saveReply('item-1', 'see you there')).toBe(false);
  });
});

describe('the seed is friends-only', () => {
  const now = Date.parse('2026-08-22T02:00:00.000Z');

  it('includes only the handles in the circle, in catalogue order', () => {
    const groups = seededGroups(now, ['sasha', 'claire']);
    expect(groups.map((group) => group.handle)).toEqual(['claire', 'sasha']);
  });

  it('leaves the rail and the Feed empty for an empty circle', () => {
    expect(seededGroups(now, [])).toEqual([]);
    expect(seededFeed(now, [])).toEqual([]);
  });

  it('never seeds a memory from someone outside the circle', () => {
    const handles = seededFeed(now, ['claire']).map((entry) =>
      entry.kind === 'memory' ? entry.memory.handle : entry.event.handle,
    );
    expect(new Set(handles)).toEqual(new Set(['claire']));
  });
});
