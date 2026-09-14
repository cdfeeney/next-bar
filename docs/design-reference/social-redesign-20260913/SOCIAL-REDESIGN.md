# Social tab redesign — flow and capabilities

Prototype: `Social Redesign.dc.html` (canvas of options) · component: `SocialPhone.dc.html`
Source of truth: `nb-v9-20260908/v9` · design system: Next Bar
Chosen direction: **1c, plan-led** (turn 1 holds the four explorations, turn 2 the build-out, turns 3–4 the refinements)

## Problems this addresses

1. Tonight was one long scroll of unrelated sections.
2. Groups & People was buried inside Tonight.
3. Dead ends — taps that went nowhere.
4. Plans was one card on an empty screen.
5. Feed and Tonight both carried Stories.

## Structure

Three sub-tabs stay locked across the top: **Tonight · Plans · Feed**. The five-tab bottom bar is untouched. Presence stays manual.

Header carries the title, the date, and two icon buttons top-right:

- **Pin** — your whole presence. Muted when nothing is set, white when a status is set, accent when a bar is pinned. Opens one sheet that answers both "are you going out?" and "where are you?".
- **People** — pushes the Groups & people panel. Badge shows pending follow requests.

### Tonight
Stories rail → plan card (live plan with vote count, or "No plan yet" with the create CTA) → your status row → Out tonight roster → nothing else.

### Plans
Your plan tonight · Start a Night Out · invitations you've been sent · earlier nights (each opens its saved-night recap).

### Feed
Stories rail → 24-hour posts, each with View night and an inline reply thread.

## Flows that work in the prototype

**Presence** — pin icon → status (Going out / Maybe later / Not going out) and "Where are you?" → bar picker → audience (Friends / Close friends / Only some people). "Only some people" reveals a mutuals-only picker with search, states the count in words, and holds "Pin it" until at least one person is chosen. Pinning a bar sets you to Going out.

**Plan** — Start a night out → cover photo + name, when, area, who's going, up to three bars to seed the vote → creates the plan and sends invitations → board with live vote counts (▲ moves your vote), suggest another bar, host can lock in early → decided state with directions and share.

**Photo** — "+" on your own story cell → capture modes (Take one photo / Front + back / Choose from library, as a bottom sheet) → approve-or-retake gate, with the inset and the four composition edits on a paired shot → compose (caption, Bar, People) → destinations (Feed / Story / Night Out / Group, multi-select, story audience joined to its row) → receipt, whose Undo deletes what was shared.

**Replies** — inline on the feed post. Three states (not read / no replies / rows), composer clears only on a confirmed send, character count near the ceiling, × only on replies you may delete.

**People** — followers and following lists, @username search above Groups, groups with unread counts, Group Favorites.

## Grounded in the codebase

| Element | Source |
| --- | --- |
| Colors, type, spacing | `tailwind.config.ts`, `globals.css`, Poppins |
| Bottom nav glyphs and labels | `components/BottomNav.tsx` |
| Avatar tones, seed hash, sizes | `components/Avatar.tsx` (seeds on handle) |
| Friend names, handles, initials | `lib/demo/friends.ts` (Claire R. carries `MR`) |
| Bars, neighborhoods | `lib/bars.core.ts` |
| Presence audiences | `lib/presence/index.ts` `AUDIENCE_LABELS`; `PinDialogs.tsx` |
| Pin sequence rules | `friends/_components/TonightPresence.tsx` |
| Plan board, shortlist cap | `friends/consensus/page.tsx`, `night-out/[token]` |
| Saved night recap | `app/nights/[id]`, `RecapCard.tsx`, `savedNightSummary`, `barVisual.ts`, `RatingBadge.tsx` |
| Comment thread rules and constants | `lib/feed.server.ts` (`MAX_FEED_COMMENT_LENGTH` 2000, `FEED_COMMENTS_PER_POST` 200), `FeedComments.tsx` |
| Capture pipeline | `components/capture/CaptureFlow.tsx`, `CaptureModeSheet.tsx`, `CaptureReview.tsx` |
| Compose and destinations | `components/composer/ComposeStep.tsx`, `DestinationsStep.tsx` |
| Story audience model | `components/story/storyStore.ts` (`'friends' | 'custom'`), `StorySheets.tsx` |
| Groups, unread, invitations | `friends/_components/GroupsAndPeople.tsx` |

## Added beyond the current code

- **Search in the people pickers** (Tag friends, story Custom audience, pin recipients). `StorySheets`' `PeopleSheet` maps the whole friends list with no filter, which breaks at 70+ friends. Each list is now a bounded scroller with a name/@handle filter and a no-match line.
- **Cover photo and name on a night out**, carried through to the plan board.
- **Plans tab content** — invitations moved here from inside Groups, plus earlier nights.

## Known gaps

- No group thread screen, so a group's unread count has nowhere to land.
- The plan shortlist picks from the bar catalog; it should offer Group Favorites first (`friends/consensus` computes it).
- No guest-side RSVP view of a plan.
- Covers and feed photos are placeholders — no real imagery yet.
