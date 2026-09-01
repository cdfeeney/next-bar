import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { StoryPhoto, TaggedPerson } from '@/components/story/storyStore';

import GlobalComposer from './GlobalComposer';
import type { ComposerGroup, PublishInput, PublishResult } from './types';

/**
 * The global composer driven through its real screens (WP4).
 *
 * WHY THESE ARE COMPONENT TESTS AND NOT PLAYWRIGHT SPECS. The composer's
 * exclusive write scope in this lane is `src/components/composer/` — the entry
 * point that would mount it lives on `/friends` (`src/app/friends/page.tsx`),
 * which belongs to another lane. There is therefore no route to `page.goto()`
 * yet, and an e2e spec asserting an unreachable surface would be a green test
 * proving nothing. These tests drive the same production components a browser
 * would, in a DOM, and the browser spec is owed at integration once the mount
 * point exists. That gap is recorded rather than papered over.
 */

const ALEX: TaggedPerson = { id: 'alex', handle: 'alex', name: 'Alex Ray', initials: 'AR' };
const SAM: TaggedPerson = { id: 'sam', handle: 'sam', name: 'Sam Poe', initials: 'SP' };
const FRIENDS: readonly TaggedPerson[] = [ALEX, SAM];

const PHOTO: StoryPhoto = { kind: 'single', main: 'data:image/jpeg;base64,aaa', state: 'ok' };

/** Bar Crew holds one mutual friend and one stranger — the D-C-37 intersection. */
const GROUPS: readonly ComposerGroup[] = [
  { id: 'crew', name: 'Bar Crew', memberIds: ['alex', 'stranger'] },
  { id: 'uni', name: 'Uni', memberIds: ['sam'] },
];

let published: PublishInput[] = [];
let publishResult: PublishResult = { ok: true, publishId: 'p1', delivered: ['feed'] };
let undoResult: { ok: true } | { ok: false; message: string } = { ok: true };
let exits = 0;

beforeEach(() => {
  published = [];
  publishResult = { ok: true, publishId: 'p1', delivered: ['feed'] };
  undoResult = { ok: true };
  exits = 0;
});

function mount(
  overrides: Partial<React.ComponentProps<typeof GlobalComposer>> = {},
): void {
  render(
    <GlobalComposer
      photo={PHOTO}
      main="data:image/jpeg;base64,aaa"
      friends={FRIENDS}
      friendsReady
      groups={GROUPS}
      nightOut={{ id: 'no1', label: 'Friday at The Fox' }}
      onPublish={async (input) => {
        published.push(input);
        return publishResult;
      }}
      onUndo={async () => undoResult}
      onExit={() => {
        exits += 1;
      }}
      onViewPost={vi.fn()}
      onViewStory={vi.fn()}
      {...overrides}
    />,
  );
}

/** Compose → Destinations. The only route between the two steps. */
async function toDestinations(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('composer-next'));
  await screen.findByTestId('composer-destinations');
}

describe('V8-R-CMP-001 — three steps, and Bar/People are branches not steps', () => {
  test('opens on Compose carrying exactly the Bar and People metadata rows', () => {
    mount();
    expect(screen.getByTestId('composer-compose')).toBeTruthy();
    expect(screen.getByTestId('composer-bar')).toBeTruthy();
    expect(screen.getByTestId('composer-people')).toBeTruthy();
  });

  test('the People picker is a sheet over Compose and returns straight to it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('composer-people'));
    const sheet = await screen.findByTestId('story-people-sheet');
    // Compose is still mounted underneath — a sheet, not a further step.
    expect(screen.getByTestId('composer-compose')).toBeTruthy();
    await user.click(within(sheet).getByText('Alex Ray'));
    await user.click(within(sheet).getByLabelText('Close tag friends'));
    await waitFor(() => expect(screen.queryByTestId('story-people-sheet')).toBeNull());
    expect(screen.getByTestId('composer-people').getAttribute('data-value')).toBe('Alex');
  });

  test('there is no review page between Destinations and Shared', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['feed'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(screen.queryByTestId('composer-destinations')).toBeNull();
  });

  test('a publish that lands nowhere returns to Compose with the draft intact', async () => {
    const user = userEvent.setup();
    publishResult = { ok: false, message: 'That photo could not be uploaded.' };
    mount();
    await user.type(screen.getByTestId('composer-caption'), 'pints');
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));

    const failure = await screen.findByTestId('composer-publish-failed');
    expect(failure.textContent).toContain('That photo could not be uploaded.');
    expect(screen.getByTestId('composer-compose')).toBeTruthy();
    expect((screen.getByTestId('composer-caption') as HTMLTextAreaElement).value).toBe('pints');
  });
});

describe('V8-R-CMP-002 — four destinations and no fifth', () => {
  test('the destination screen offers exactly Feed, Story, Night Out and Group', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    const rows = screen.getAllByTestId(/^composer-destination-(feed|story|night_out|group)$/);
    expect(rows.map((row) => row.getAttribute('data-destination'))).toEqual([
      'feed',
      'story',
      'night_out',
      'group',
    ]);
  });

  test('a partial publish names what did not go through', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['feed'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));

    const partial = await screen.findByTestId('composer-receipt-partial');
    expect(partial.textContent).toContain('Story did not go through');
  });
});

describe('V8-R-CMP-003 — Story alone never implies Feed; one media object', () => {
  test('selecting Story alone does not publish to Feed', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['story'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');

    expect(published).toHaveLength(1);
    expect([...published[0].destinations]).toEqual(['story']);
  });

  test('Feed and Story publish ONE media object in ONE call, never one per destination', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['feed', 'story'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');

    expect(published).toHaveLength(1);
    expect([...published[0].destinations]).toEqual(['feed', 'story']);
    expect(published[0].main).toBe('data:image/jpeg;base64,aaa');
  });

  /**
   * The duplicate-publish path a partial failure opens. Feed is already live;
   * re-sending the original selection would give it the same capture twice.
   */
  test('a partial failure that identifies itself goes to the receipt, not back to the CTA', async () => {
    const user = userEvent.setup();
    publishResult = {
      ok: false,
      message: 'Story did not send.',
      delivered: ['feed'],
      publishId: 'p-partial',
    };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));

    // The live half is stated, the dead half is named, and Undo can withdraw
    // what landed — none of which is reachable from the destination screen.
    const receipt = await screen.findByTestId('composer-receipt');
    expect(
      within(receipt).getByTestId('composer-receipt-partial').textContent,
    ).toContain('Story did not go through');
    expect(within(receipt).getByTestId('composer-receipt-undo')).toBeTruthy();
    // The CTA is gone, so the whole selection cannot be re-sent.
    expect(screen.queryByTestId('composer-share')).toBeNull();
    expect(published).toHaveLength(1);
  });

  test('a partial failure with nothing to undo drops what landed, so a retry cannot duplicate it', async () => {
    const user = userEvent.setup();
    publishResult = { ok: false, message: 'Story did not send.', delivered: ['feed'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));

    const failed = await screen.findByTestId('composer-destinations-failed');
    expect(failed.textContent).toContain('Feed already went through');
    // Feed is deselected, so the obvious retry re-sends only what is missing.
    expect(screen.getByTestId('composer-destination-feed').getAttribute('aria-pressed')).toBe(
      'false',
    );

    publishResult = { ok: true, publishId: 'p2', delivered: ['story'] };
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');

    expect(published).toHaveLength(2);
    expect([...published[1].destinations]).toEqual(['story']);
  });

  test('a rejected publish returns to Compose with the draft rather than wedging on "Sharing…"', async () => {
    const user = userEvent.setup();
    mount({
      onPublish: async () => {
        throw new Error('upload blew up');
      },
    });
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));

    const compose = await screen.findByTestId('composer-compose');
    expect(
      within(compose).getByTestId('composer-publish-failed').textContent,
    ).toContain('Your draft is still here');
    // And the composer is usable again — not stuck disabled reading "Sharing…".
    expect(
      (within(compose).getByTestId('composer-next') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('V8-R-CMP-004 — the Feed row', () => {
  test('is a one-tap row with a labelled indicator, off by default', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    const row = screen.getByTestId('composer-destination-feed');
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('composer-destination-feed-indicator').textContent).toBe('Off');

    await user.click(row);
    expect(screen.getByTestId('composer-destination-feed').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('composer-destination-feed-indicator').textContent).toBe('On');
  });

  test('states that the Feed post persists and carries comments', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    expect(screen.getByTestId('composer-destination-feed').textContent).toContain(
      'Stays until you delete it',
    );
  });
});

describe('V8-R-CMP-005 — the Story audience subrow', () => {
  test('appears only once Story is selected, joined to that row', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    expect(screen.queryByTestId('composer-story-audience')).toBeNull();
    await user.click(screen.getByTestId('composer-destination-story'));
    expect(screen.getByTestId('composer-story-audience')).toBeTruthy();
  });

  test('opens as a sheet over the destination screen, never a fourth frame', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-story-audience'));
    await screen.findByTestId('composer-audience-sheet');
    expect(screen.getByTestId('composer-destinations')).toBeTruthy();
  });

  test('a named group is intersected with mutual friends before it publishes', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['story'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-story-audience'));
    const sheet = await screen.findByTestId('composer-audience-sheet');
    await user.click(within(sheet).getByText('A group'));
    await user.click(await within(sheet).findByText('Bar Crew'));
    // Bar Crew holds alex (mutual) and stranger (not). One recipient, not two.
    expect(screen.getByTestId('composer-audience-count').textContent).toBe(
      '1 person will see this story',
    );
    await user.click(screen.getByTestId('composer-audience-done'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');

    expect([...published[0].storyAudienceIds]).toEqual(['alex']);
    expect(published[0].storyAudienceGroupId).toBe('crew');
  });

  test('fails closed: the sheet will not commit a narrowing that reaches nobody', async () => {
    const user = userEvent.setup();
    mount({ groups: [{ id: 'none', name: 'Strangers', memberIds: ['nobody'] }] });
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-story-audience'));
    const sheet = await screen.findByTestId('composer-audience-sheet');
    await user.click(within(sheet).getByText('A group'));
    await user.click(await within(sheet).findByText('Strangers'));
    // Done is unavailable, so the narrowing can never be committed at all.
    expect(
      (screen.getByTestId('composer-audience-done') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  /**
   * The SHEET-side gate above is not the requirement. V8-R-CMP-005 fails closed
   * at the moment of PUBLISHING, because an audience that resolved when it was
   * chosen can reach nobody by the time Share is tapped — an Account default
   * that never resolved here, or a circle that changed underneath. That branch
   * lives in `publish()` and had no test: deleting it left the suite green.
   */
  test('fails closed: publishing with a lapsed audience is refused, not widened', async () => {
    const user = userEvent.setup();
    // The Account default narrows to a custom set that has not been picked in
    // this composer, so the audience resolves to nobody without the sheet ever
    // having been opened.
    mount({ defaultStoryAudience: 'custom' });
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));

    // Refused: nothing was published, and it was NOT quietly widened to Friends
    // — which would have delivered broader than the screen said.
    expect(published).toHaveLength(0);
    const alert = await screen.findByTestId('composer-audience-lapsed');
    expect(alert.textContent).toContain('Nothing was shared');
    expect(screen.getByTestId('composer-audience-sheet')).toBeTruthy();
  });

  test('dismissing the sheet restores the committed audience instead of widening it', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-story-audience'));
    const sheet = await screen.findByTestId('composer-audience-sheet');
    await user.click(within(sheet).getByText('A group'));
    await user.click(await within(sheet).findByText('Bar Crew'));
    await user.click(screen.getByTestId('composer-audience-done'));
    expect(screen.getByTestId('composer-story-audience-value').textContent).toBe(
      'Group · 1 person',
    );

    // Reopen, browse to Custom — which reaches nobody until people are picked —
    // then back out. "Never mind" must not widen Bar Crew to everyone.
    await user.click(screen.getByTestId('composer-story-audience'));
    const reopened = await screen.findByTestId('composer-audience-sheet');
    await user.click(within(reopened).getByText('Custom'));
    await user.click(within(reopened).getByLabelText('Close story audience'));

    expect(screen.getByTestId('composer-story-audience-value').textContent).toBe(
      'Group · 1 person',
    );
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect([...published[0].storyAudienceIds]).toEqual(['alex']);
    expect(published[0].storyAudienceGroupId).toBe('crew');
  });

  test('Escape inside the audience sheet closes the sheet, never the composer', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-story-audience'));
    await screen.findByTestId('composer-audience-sheet');

    await user.keyboard('{Escape}');

    // The destination screen's own trap must be disarmed under the sheet: if it
    // is not, Escape unmounts the whole composer and the draft is gone.
    expect(exits).toBe(0);
    expect(screen.getByTestId('composer-destinations')).toBeTruthy();
  });

  test('the subrow governs the story only — the Group destination is untouched by it', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['story', 'group'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-story-audience'));
    const sheet = await screen.findByTestId('composer-audience-sheet');
    await user.click(within(sheet).getByText('A group'));
    await user.click(await within(sheet).findByText('Bar Crew'));
    await user.click(screen.getByTestId('composer-audience-done'));

    await user.click(screen.getByTestId('composer-destination-group'));
    await user.click(screen.getByTestId('composer-group-toggle'));
    await user.click(await screen.findByText('Uni'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');

    // The story audience narrowed to one person; the group destination kept its
    // own fixed target and was not intersected with it.
    expect([...published[0].storyAudienceIds]).toEqual(['alex']);
    expect([...published[0].groupIds]).toEqual(['uni']);
  });
});

describe('V8-R-CMP-006 — the Night Out row', () => {
  test('states there is no night out tonight rather than silently doing nothing', async () => {
    const user = userEvent.setup();
    mount({ nightOut: null });
    await toDestinations(user);
    const row = screen.getByTestId('composer-destination-night_out') as HTMLButtonElement;
    expect(row.textContent).toContain('No night out tonight');
    expect(row.disabled).toBe(true);

    await user.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('false');
  });

  test('publishes tonight’s night out id when selected', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['night_out'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-night_out'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(published[0].nightOutId).toBe('no1');
  });
});

describe('V8-R-CMP-007 — the Group row expands in place', () => {
  test('the dropdown opens inside the destination screen, never a new screen', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-group'));
    await user.click(screen.getByTestId('composer-group-toggle'));
    expect(screen.getByTestId('composer-group-dropdown')).toBeTruthy();
    expect(screen.getByTestId('composer-destinations')).toBeTruthy();
    expect(screen.getByTestId('composer-destination-feed')).toBeTruthy();
  });

  test('is multi-select and restates the selection on the row itself', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-group'));
    await user.click(screen.getByTestId('composer-group-toggle'));
    await user.click(await screen.findByText('Bar Crew'));
    await user.click(screen.getByText('Uni'));
    expect(screen.getByTestId('composer-destination-group').textContent).toContain(
      'Bar Crew, Uni',
    );

    // Still on the row once the dropdown is closed again.
    await user.click(screen.getByTestId('composer-group-toggle'));
    expect(screen.queryByTestId('composer-group-option')).toBeNull();
    expect(screen.getByTestId('composer-destination-group').textContent).toContain(
      'Bar Crew, Uni',
    );
  });

  test('creates, invites to and edits nothing — the dropdown offers only selection', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-group'));
    await user.click(screen.getByTestId('composer-group-toggle'));
    const dropdown = screen.getByTestId('composer-group-dropdown');
    expect(within(dropdown).queryByText(/new group/i)).toBeNull();
    expect(within(dropdown).queryByText(/invite/i)).toBeNull();
    expect(within(dropdown).queryByRole('textbox')).toBeNull();
  });

  /**
   * `sendGroupMessage` takes ONE group id, so Group with nothing chosen reaches
   * no thread at all. V8-R-CMP-008 says the CTA writes to EVERY selected
   * destination, so an undeliverable selection is refused BEFORE publishing
   * rather than reported afterwards as a partial.
   */
  test('Group with no group chosen cannot publish, and the CTA says why', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-group'));

    const cta = screen.getByTestId('composer-share') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.textContent).toBe('Choose a group to share to');

    await user.click(cta);
    expect(published).toHaveLength(0);

    // Choosing one makes it publishable, and the group actually travels.
    await user.click(screen.getByTestId('composer-group-toggle'));
    await user.click(await screen.findByText('Uni'));
    expect((screen.getByTestId('composer-share') as HTMLButtonElement).disabled).toBe(false);
    publishResult = { ok: true, publishId: 'p1', delivered: ['group'] };
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect([...published[0].groupIds]).toEqual(['uni']);
  });
});

describe('V8-R-CMP-008 — the CTA is the only write, and it names its effect', () => {
  test('toggling destinations publishes nothing', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-destination-story'));
    expect(published).toHaveLength(0);
  });

  test('the CTA names the destinations and is unavailable with none selected', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    const cta = screen.getByTestId('composer-share') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.textContent).toBe('Pick a place to share');

    await user.click(screen.getByTestId('composer-destination-feed'));
    expect(screen.getByTestId('composer-share').textContent).toBe('Share to Feed');
    await user.click(screen.getByTestId('composer-destination-story'));
    expect(screen.getByTestId('composer-share').textContent).toBe('Share to Feed and Story');
  });

  test('a queued publish is labelled queued, never Shared', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['feed'], queued: true };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));

    const receipt = await screen.findByTestId('composer-receipt');
    expect(receipt.getAttribute('data-receipt-kind')).toBe('queued');
    expect(screen.getByTestId('composer-receipt-headline').textContent).toBe(
      'Queued for 1 place',
    );
  });
});

describe('V8-R-CMP-009 — every full-screen state exits with ✕', () => {
  test('Compose exits without publishing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('composer-compose-exit'));
    expect(exits).toBe(1);
    expect(published).toHaveLength(0);
  });

  test('Destinations exits without publishing, even with rows selected', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destinations-exit'));
    expect(exits).toBe(1);
    expect(published).toHaveLength(0);
  });

  test('the receipt exits back to Social', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    await user.click(screen.getByTestId('composer-receipt-exit'));
    expect(exits).toBe(1);
  });
});

describe('V8-R-CMP-010 — the optional 140-character caption', () => {
  test('labels the remaining length as it is typed', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByTestId('composer-caption-count').textContent).toBe(
      '140 characters left',
    );
    await user.type(screen.getByTestId('composer-caption'), 'hello');
    expect(screen.getByTestId('composer-caption-count').textContent).toBe(
      '135 characters left',
    );
  });

  test('refuses to hold more than 140 characters, pasted or typed', async () => {
    const user = userEvent.setup();
    mount();
    const field = screen.getByTestId('composer-caption') as HTMLTextAreaElement;
    await user.click(field);
    await user.paste('x'.repeat(400));
    expect(field.value.length).toBe(140);
  });

  test('an empty caption publishes as null rather than as an empty string', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(published[0].caption).toBeNull();
  });
});

describe('V8-R-CMP-011 — the three receipts and Undo', () => {
  test('Feed alone', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['feed'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(screen.getByTestId('composer-receipt-headline').textContent).toBe('Posted to Feed');
    expect(screen.getByTestId('composer-receipt-primary').textContent).toBe('View post');
    expect(screen.getByTestId('composer-receipt-undo')).toBeTruthy();
  });

  test('Story alone', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['story'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(screen.getByTestId('composer-receipt-headline').textContent).toBe(
      'Added to your story',
    );
    expect(screen.getByTestId('composer-receipt-primary').textContent).toBe('View story');
  });

  test('several destinations count themselves and show per-destination indicators', async () => {
    const user = userEvent.setup();
    publishResult = { ok: true, publishId: 'p1', delivered: ['feed', 'story'] };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-destination-story'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(screen.getByTestId('composer-receipt-headline').textContent).toBe(
      'Shared to 2 places',
    );
    expect(screen.getByTestId('composer-receipt-primary').textContent).toBe('Done');
    expect(
      screen.getAllByTestId('composer-receipt-destination').map((el) =>
        el.getAttribute('data-destination'),
      ),
    ).toEqual(['feed', 'story']);
  });

  test('a failed Undo does not report success', async () => {
    const user = userEvent.setup();
    undoResult = { ok: false, message: 'That could not be undone.' };
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    await user.click(screen.getByTestId('composer-receipt-undo'));

    const failure = await screen.findByTestId('composer-undo-failed');
    expect(failure.textContent).toContain('It is still live.');
    expect(exits).toBe(0);
  });

  test('a successful Undo leaves the composer', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    await user.click(screen.getByTestId('composer-receipt-undo'));
    await waitFor(() => expect(exits).toBe(1));
  });
});

describe('V8-R-CMP-013 — the bar tag is a decision, never a detection', () => {
  test('starts empty, and an empty venue is a finished state', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByTestId('composer-bar').getAttribute('data-value')).toBe('Choose');
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    await user.click(screen.getByTestId('composer-share'));
    await screen.findByTestId('composer-receipt');
    expect(published[0].barId).toBeNull();
  });

  test('the row opens the shared bar sheet and returns straight to Compose', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('composer-bar'));
    const sheet = await screen.findByTestId('composer-bar-sheet');
    // The app's ONE bar picker, not a second search list.
    expect(within(sheet).getByRole('textbox')).toBeTruthy();
    await user.click(within(sheet).getByLabelText('Close where was this?'));
    await waitFor(() => expect(screen.queryByTestId('composer-bar-sheet')).toBeNull());
    expect(screen.getByTestId('composer-compose')).toBeTruthy();
  });
});

describe('V8-R-CMP-014 — the pre-publish summary is the gate', () => {
  test('sits on the destination screen and restates audience, lifetime, tags and likes', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-feed'));
    const summary = screen.getByTestId('composer-summary');
    expect(summary.textContent).toContain('Feed · your friends · stays until you delete it');
    expect(summary.textContent).toContain('Nobody is tagged');
    expect(summary.textContent).toContain('No bar tagged');
    expect(summary.textContent).toContain('No public like counts');
  });

  test('is rendered before the publishing button in document order', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    const summary = screen.getByTestId('composer-summary');
    const cta = screen.getByTestId('composer-share');
    expect(
      summary.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('follows the selection — turning Story on adds its own audience and lifetime', async () => {
    const user = userEvent.setup();
    mount();
    await toDestinations(user);
    await user.click(screen.getByTestId('composer-destination-story'));
    expect(screen.getByTestId('composer-summary').textContent).toContain(
      'Story · your friends · 24 hours',
    );
  });
});
