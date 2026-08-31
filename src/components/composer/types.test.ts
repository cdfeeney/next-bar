import { describe, expect, test } from 'vitest';

import type { TaggedPerson } from '@/components/story/storyStore';

import {
  COMPOSER_DESTINATIONS,
  MAX_COMPOSER_CAPTION,
  ctaLabel,
  missingDestinations,
  receiptFor,
  resolveStoryRecipients,
  storyAudienceLapsed,
  summaryLines,
} from './types';

/**
 * The composer's decisions, argued with directly rather than through a browser.
 *
 * Each block names the requirement it holds, so a later change has to argue
 * with the contract and not merely with a test.
 */

function person(id: string, name: string): TaggedPerson {
  return { id, handle: id, name, initials: name.slice(0, 2).toUpperCase() };
}

describe('V8-R-CMP-002 — exactly four destinations', () => {
  test('names Feed, Story, Night Out and Group, and nothing else', () => {
    expect([...COMPOSER_DESTINATIONS]).toEqual(['feed', 'story', 'night_out', 'group']);
  });
});

describe('V8-R-CMP-010 — the caption bound', () => {
  test('is 140 characters', () => {
    expect(MAX_COMPOSER_CAPTION).toBe(140);
  });
});

describe('V8-R-CMP-011 — exactly three receipts', () => {
  test('Feed alone reads "Posted to Feed" and offers View post', () => {
    const receipt = receiptFor(['feed']);
    expect(receipt.kind).toBe('feed');
    expect(receipt.headline).toBe('Posted to Feed');
    expect(receipt.primaryLabel).toBe('View post');
    expect(receipt.primaryAction).toBe('view-post');
  });

  test('Story alone reads "Added to your story" and offers View story', () => {
    const receipt = receiptFor(['story']);
    expect(receipt.kind).toBe('story');
    expect(receipt.headline).toBe('Added to your story');
    expect(receipt.primaryLabel).toBe('View story');
  });

  test('several destinations read "Shared to N places" and offer Done', () => {
    const receipt = receiptFor(['feed', 'story', 'group']);
    expect(receipt.kind).toBe('places');
    expect(receipt.headline).toBe('Shared to 3 places');
    expect(receipt.primaryLabel).toBe('Done');
  });

  test('a lone Night Out uses the counted receipt, singular — there is no fourth', () => {
    const receipt = receiptFor(['night_out']);
    expect(receipt.kind).toBe('places');
    expect(receipt.headline).toBe('Shared to 1 place');
  });
});

describe('V8-R-CMP-005 / D-C-37 — the story audience is intersected', () => {
  const mutuals = ['a', 'b'];

  test('Friends resolves to no explicit recipient list — the server owns that set', () => {
    expect(
      resolveStoryRecipients({ choice: 'friends', mutualIds: mutuals }),
    ).toEqual([]);
  });

  test('a named group drops the member who is not a mutual friend', () => {
    expect(
      resolveStoryRecipients({
        choice: 'group',
        mutualIds: mutuals,
        groupMemberIds: ['a', 'stranger', 'b'],
      }),
    ).toEqual(['a', 'b']);
  });

  test('a custom pick is intersected too — a stale id is not a recipient', () => {
    expect(
      resolveStoryRecipients({
        choice: 'custom',
        mutualIds: mutuals,
        customIds: ['b', 'departed'],
      }),
    ).toEqual(['b']);
  });

  test('a group of non-mutuals resolves to nobody rather than to the whole group', () => {
    expect(
      resolveStoryRecipients({
        choice: 'group',
        mutualIds: mutuals,
        groupMemberIds: ['x', 'y'],
      }),
    ).toEqual([]);
  });

  test('fails closed when the narrowing reaches nobody', () => {
    expect(
      storyAudienceLapsed({ choice: 'group', mutualsReady: true, resolved: [] }),
    ).toBe(true);
  });

  test('fails closed while the circle has not resolved, even with recipients held', () => {
    expect(
      storyAudienceLapsed({ choice: 'custom', mutualsReady: false, resolved: ['a'] }),
    ).toBe(true);
  });

  test('Friends never lapses — it needs no list', () => {
    expect(
      storyAudienceLapsed({ choice: 'friends', mutualsReady: false, resolved: [] }),
    ).toBe(false);
  });
});

describe('V8-R-CMP-014 — the pre-publish summary states everything in words', () => {
  const base = {
    storyAudience: 'friends' as const,
    storyRecipientCount: null,
    groupNames: [] as readonly string[],
    nightOutLabel: null,
    tagged: [] as readonly TaggedPerson[],
    barName: null,
  };

  test('names each selected destination with its audience and its lifetime', () => {
    const lines = summaryLines({
      ...base,
      destinations: ['feed', 'story', 'night_out', 'group'],
      storyAudience: 'group',
      storyRecipientCount: 3,
      groupNames: ['Bar Crew'],
      nightOutLabel: "Friday at The Fox",
    });
    expect(lines).toContain('Feed · your friends · stays until you delete it');
    expect(lines).toContain('Story · 3 people · 24 hours');
    expect(lines).toContain(
      'Night Out · everyone on Friday at The Fox · 24 hours from the night out start',
    );
    expect(lines).toContain('Group · Bar Crew · stays in the group thread');
  });

  test('restates who is tagged and the bar tag', () => {
    const lines = summaryLines({
      ...base,
      destinations: ['feed'],
      tagged: [person('a', 'Alex Ray'), person('b', 'Sam Poe')],
      barName: 'The Fox',
    });
    expect(lines).toContain('Tagged: Alex Ray, Sam Poe');
    expect(lines).toContain('Bar: The Fox');
  });

  test('an empty venue and an empty tag list are stated, not omitted', () => {
    const lines = summaryLines({ ...base, destinations: ['story'] });
    expect(lines).toContain('Nobody is tagged');
    expect(lines).toContain('No bar tagged');
  });

  test('always closes on the no-public-like-counts line', () => {
    const lines = summaryLines({ ...base, destinations: ['feed'] });
    expect(lines[lines.length - 1]).toBe('No public like counts');
  });

  test('says so when nothing is selected rather than rendering an empty gate', () => {
    const lines = summaryLines({ ...base, destinations: [] });
    expect(lines).toContain('Nowhere yet · pick at least one place');
  });
});

describe('V8-R-CMP-008 — the CTA names its effect', () => {
  test('one destination is named', () => {
    expect(ctaLabel(['feed'])).toBe('Share to Feed');
  });

  test('two destinations are both named', () => {
    expect(ctaLabel(['feed', 'story'])).toBe('Share to Feed and Story');
  });

  test('three or more are counted', () => {
    expect(ctaLabel(['feed', 'story', 'group'])).toBe('Share to 3 places');
  });

  test('an empty selection asks for one instead of offering to share', () => {
    expect(ctaLabel([])).toBe('Pick a place to share');
  });
});

describe('V8-R-CMP-002 — a partial publish is never silent', () => {
  test('reports what was selected but not delivered', () => {
    expect(missingDestinations(['feed', 'story', 'group'], ['feed'])).toEqual([
      'story',
      'group',
    ]);
  });

  test('reports nothing when everything landed', () => {
    expect(missingDestinations(['feed', 'story'], ['feed', 'story'])).toEqual([]);
  });
});
