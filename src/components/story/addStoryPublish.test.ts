import { describe, expect, test } from 'vitest';

import type { PublishInput } from '@/components/composer/types';

import { publishEverywhere, undoEverywhere, type PublishDeps, type UndoDeps } from './addStoryPublish';

const BLOB = new Blob(['x'], { type: 'image/jpeg' });

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    main: 'data:image/jpeg;base64,aaa',
    inset: null,
    destinations: ['story'],
    caption: null,
    barId: null,
    tagIds: [],
    storyAudience: 'friends',
    storyAudienceIds: [],
    groupIds: [],
    nightOutId: null,
    ...overrides,
  };
}

function deps(overrides: Partial<PublishDeps> = {}): PublishDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    toBlob: async () => BLOB,
    publishStory: async () => {
      calls.push('story');
      return { ok: true, value: 's1' };
    },
    upload: async () => {
      calls.push('upload');
      return { ok: true, value: 'm1' };
    },
    publishFeed: async () => {
      calls.push('feed');
      return { ok: true, value: 'p1' };
    },
    sendGroup: async (groupId) => {
      calls.push(`group:${groupId}`);
      return { ok: true, value: `msg-${groupId}` };
    },
    addNightOut: async () => {
      calls.push('night');
      return 'd1';
    },
    ...overrides,
  };
}

describe('publishEverywhere — one capture, every selected destination', () => {
  test('Story alone publishes through the story path and never uploads twice', async () => {
    const d = deps();
    const result = await publishEverywhere(d, input());
    expect(result).toEqual({
      ok: true,
      publishId: 'story:s1',
      delivered: ['story'],
      deliveredGroupIds: undefined,
      postId: null,
    });
    expect(d.calls).toEqual(['story']);
  });

  test('Feed + Night Out + Group share ONE upload and are keyed to its media id', async () => {
    const d = deps();
    const result = await publishEverywhere(
      d,
      input({ destinations: ['feed', 'night_out', 'group'], groupIds: ['g1', 'g2'], nightOutId: 'n1' }),
    );
    expect(d.calls.filter((c) => c === 'upload')).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delivered).toEqual(['feed', 'night_out', 'group']);
    expect(result.deliveredGroupIds).toEqual(['g1', 'g2']);
    expect(result.postId).toBe('p1');
    expect(result.publishId).toBe('feed:p1|night:m1:d1|group:g1:msg-g1|group:g2:msg-g2');
  });

  test('a custom story audience is passed through as custom with its resolved ids', async () => {
    let seen: Parameters<PublishDeps['publishStory']>[0] | null = null;
    const d = deps({
      publishStory: async (i) => {
        seen = i;
        return { ok: true, value: 's1' };
      },
    });
    await publishEverywhere(
      d,
      input({ storyAudience: 'custom', storyAudienceIds: ['alex'], tagIds: ['alex'] }),
    );
    expect(seen).toMatchObject({ audience: 'custom', audienceIds: ['alex'], tagIds: ['alex'] });
  });

  test('a PARTIAL publish names what landed and hands back an id to undo it', async () => {
    const d = deps({ publishFeed: async () => ({ ok: false, message: 'Feed refused.' }) });
    const result = await publishEverywhere(d, input({ destinations: ['feed', 'story'] }));
    expect(result).toEqual({
      ok: false,
      message: 'Feed refused.',
      delivered: ['story'],
      deliveredGroupIds: undefined,
      publishId: 'story:s1',
    });
  });

  test('a group publish that reaches only some threads is a partial, with the threads named', async () => {
    const d = deps({
      sendGroup: async (groupId) =>
        groupId === 'g2' ? { ok: false, message: 'g2 down' } : { ok: true, value: `msg-${groupId}` },
    });
    const result = await publishEverywhere(
      d,
      input({ destinations: ['group'], groupIds: ['g1', 'g2'] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.delivered).toEqual(['group']);
    expect(result.deliveredGroupIds).toEqual(['g1']);
    expect(result.publishId).toBe('group:g1:msg-g1');
  });

  test('a failed upload lands nowhere for the three media-id destinations', async () => {
    const d = deps({ upload: async () => ({ ok: false, message: 'too big' }) });
    const result = await publishEverywhere(d, input({ destinations: ['feed'] }));
    expect(result).toEqual({ ok: false, message: 'too big' });
  });

  test('an unreadable capture is refused before anything is published', async () => {
    const d = deps({ toBlob: async () => null });
    const result = await publishEverywhere(d, input({ destinations: ['feed', 'story'] }));
    expect(result.ok).toBe(false);
    expect(d.calls).toEqual([]);
  });
});

describe('undoEverywhere — author delete of everything that landed', () => {
  function undoDeps(overrides: Partial<UndoDeps> = {}): UndoDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      deleteStory: async (id) => {
        calls.push(`story:${id}`);
        return { ok: true };
      },
      deleteFeedPost: async (id) => {
        calls.push(`feed:${id}`);
        return { ok: true };
      },
      deleteGroupMessage: async (id) => {
        calls.push(`msg:${id}`);
        return { ok: true };
      },
      removeDestination: async (mediaId, destinationId) => {
        calls.push(`night:${mediaId}:${destinationId}`);
        return { ok: true };
      },
      ...overrides,
    };
  }

  test('removes every part the publishId records', async () => {
    const d = undoDeps();
    const result = await undoEverywhere(d, 'story:s1|feed:p1|group:g1:msg-g1|night:m1:d1');
    expect(result).toEqual({ ok: true });
    expect(d.calls).toEqual(['story:s1', 'feed:p1', 'msg:msg-g1', 'night:m1:d1']);
  });

  test('a part that will not go says which one is still live, and keeps going', async () => {
    const d = undoDeps({ deleteFeedPost: async () => ({ ok: false, message: 'nope' }) });
    const result = await undoEverywhere(d, 'story:s1|feed:p1');
    expect(result).toEqual({ ok: false, message: 'The Feed post could not be removed.' });
    expect(d.calls).toEqual(['story:s1']);
  });
});
