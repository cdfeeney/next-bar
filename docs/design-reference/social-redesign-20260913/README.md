# Handoff: Social tab redesign (Next Bar)

## Overview

The Social tab (`/friends`) is being streamlined. Today it is one long scroll of unrelated sections with Groups & People buried inside Tonight, several taps that go nowhere, a Plans tab holding a single card, and a Stories rail duplicated between Tonight and Feed. This handoff covers the chosen direction — **plan-led Social** — across all three sub-tabs plus the presence, plan, photo and reply flows behind them.

The three sub-tabs (Tonight · Plans · Feed) and the five-item bottom tab bar are **locked**: do not change either. Presence stays manual — nothing reads location.

## About the design files

The files in this bundle are **design references written in HTML**. They are prototypes showing intended look and behavior, not production code to copy. The task is to recreate them inside the existing Next Bar app — Next.js App Router, React client components, Tailwind with the project's token names, Supabase RPCs — using its established patterns. Several screens in the prototype are re-drawings of components that **already exist** in the repo (listed per screen below); prefer editing those components over writing new ones.

## Fidelity

**High fidelity.** Colors, type, spacing and copy are final and were taken from the repo itself (`tailwind.config.ts`, `globals.css`, `BottomNav.tsx`, `Avatar.tsx`, `lib/demo/friends.ts`, `lib/bars.core.ts`, `lib/presence/index.ts`). Recreate the UI faithfully using the existing Tailwind tokens rather than hardcoding the hex values quoted here — the hex values are given so you can verify a token resolves to the right thing.

Two caveats: photo and cover imagery are grey placeholder blocks (no real assets yet), and the phone frame in the prototype is just a viewing device, not part of the design.

## Design tokens

Values as they resolve today; use the token names.

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#0a0a0a` | Page background |
| `surface` | `#141414` | Cards, sheets, inputs |
| `border` | `#2a2a2a` | All 1px borders |
| `text` | `#f5f5f0` | Body text |
| `muted` | `#8a8a85` | Secondary text, inactive icons |
| `accent` | `#ff5b3a` | Primary actions, active state, badges |
| `accentDim` | `#c54328` | Accent hover |
| — | `#1c1c1c` | Placeholder fills, disabled button bg |
| — | `rgba(255,91,58,0.08–0.18)` | Accent-tinted selected rows |

Type: **Poppins** (`next/font`), weights 400/500/600/700. Display = 600/700; labels = 700 uppercase with `letter-spacing: 0.2–0.25em` at 10–12px; body 13–16px; section headings 11–12px uppercase 0.25em muted.

Radii: 999px pills, 24px cards and sheets, 16–20px rows and inputs, 12–14px small controls. Spacing: 24px horizontal page padding, 8–12px between rows, 26–34px between sections, 110px bottom padding to clear the nav.

Every interactive target is at least 44px tall. Disabled/held actions use `#1c1c1c` on `muted` text, never opacity alone.

## Screens

### 1. Tonight (default sub-tab)

**Purpose:** answer "are we doing something tonight?" before "who's out?".

**Layout**, top to bottom, 24px horizontal padding:

1. **Header row** — flex, `space-between`, `align-items: flex-start`, 18px top / 14px bottom padding. Left: "NEXT BAR" at 24px/700, uppercase, `letter-spacing: 0.14em`, with "Saturday" beneath at 14px muted. Right: one flex group, `gap: 8px`, hard against the right edge — **pin icon button** then **people icon button**, each 44×44 minimum, 16px radius, 1px `border`, `surface` fill, 22px stroked icon.
   - Pin icon states: nothing set → `muted` icon; status set → `text` icon; bar pinned → `accent` icon, accent border, `rgba(255,91,58,0.12)` fill. `aria-label` names the state ("Pinned at Attaboy — change your night").
   - People icon carries a pending-follow-request badge: 18px accent circle, `bg` text, 10px/700.
2. **Sub-tab strip** — 1px `border` container, `surface`, 16px radius, 4px padding, three equal buttons at 44px, 12px radius, 12px/700 uppercase `letter-spacing: 0.14em`. Active: `accent` fill, `bg` text. Inactive: transparent, `muted`.
3. **Stories rail** — horizontal scroller, 18px top padding, `gap: 14px`, 24px side padding, scrollbar hidden. Each cell is a 58px-wide button: 54px ring (2px `accent` when unviewed, transparent otherwise) around a 48px avatar, label beneath at 11px muted, ellipsised. Your own cell carries a 18px accent "+" badge bottom-right with a 2px `bg` ring and opens the photo flow.
4. **Plan card** — the primary element.
   - With a plan: full-width button, 28px radius, 1px `accent` border, `linear-gradient(180deg, rgba(255,91,58,0.14), #141414)`, 20px padding. Contents: "YOUR PLAN TONIGHT" 10px/700 accent uppercase 0.22em → title 26px/700 → meta 13px muted ("Lower East Side · 4 going · 3 of 4 voted") → a 14px-padded divider (`rgba(255,91,58,0.35)`) then a row with "Attaboy is leading" 14px/600 and "OPEN ›" 12px/700 accent uppercase. Opens the plan board.
   - Without: same box, `border` instead of accent, `surface` fill. "TONIGHT" label → "No plan yet." 24px/700 → 13px muted explanation → full-width 50px accent pill "Start a night out".
5. **Your status row** — full-width button, 20px radius, 1px `border`, transparent, 12px/16px padding: 34px avatar, then "You · Going out" 14px/600 with the audience line beneath at 11px muted, then "CHANGE ›" 11px/700 uppercase muted. Opens the presence sheet.
6. **Out tonight** — section heading, then either rows or an empty state.
   - Row: 12px vertical padding, 1px `#1c1c1c` bottom border, `gap: 12px`: 36px avatar → bar name 15px/600 with "Claire R. · Going out" beneath at 12px muted → time at 11px muted, right-aligned.
   - Empty: 24px-radius dashed `border` box, 20px padding, "Nobody's out yet — invite the people you'd actually go out with." then a 44px outlined "Invite friends" pill to Following.

**Existing code:** `src/app/friends/page.tsx`, `_components/TonightPresence.tsx`, `components/story/StoriesRail.tsx`, `_components/YourPlanTonight.tsx`.

### 2. Plans

Section heading "PLANS", then:

1. **Your plan tonight** — 24px-radius accent-bordered `surface` button: label 11px muted uppercase, title 18px/700 ("Open for votes" / "Attaboy · locked in"), meta 12px muted. Opens the board.
2. **Start a Night Out** — 24px-radius `border`/`surface` button: 44px accent-tinted rounded tile with a 20px "+", then "Start a Night Out" 18px/700 and "NEW PLAN · TIME, AREA, PEOPLE" 11px muted uppercase.
3. **Invited** — section heading, then a 24px-radius `surface` card per invitation: 34px avatar, plan name 15px/600, "Dev P. · Saturday 10:00 PM · East Village" 12px muted, then two 44px buttons — accent "I'm in", outlined muted "Not tonight". These are the night-out invitation notifications that today render inside Groups; move them here.
4. **Earlier nights** — rows with a 44px gradient thumbnail, title 15px/600, `savedNightSummary` line 12px muted, chevron. Each opens the saved-night recap.

When there is no plan, add the line "Invitations you've been sent land here too. Nothing else lives on this tab."

**Existing code:** `_components/PlansSection.tsx`; invitations from `GroupsAndPeople.tsx` (`get_my_night_out_invitation_notifications`, `markInvitationNotificationRead`); earlier nights from `app/nights/page.tsx`.

### 3. Feed

Stories rail (same spec as Tonight, 64px cells / 56px ring / 56px avatar at this size), then post cards: 16px radius, 1px `border`, `surface`, `overflow: hidden`.

- Header: 12px/16px padding, 34px avatar, name 14px, "Attaboy · Lower East Side" 11px muted, age 11px muted right.
- Media: full-bleed, 200px tall, `#1c1c1c` placeholder.
- Body: 12px/16px padding. Caption 14px/1.5, then two 44px buttons at `gap: 10px` — "VIEW NIGHT" outlined, and the reply toggle, which reads "REPLY" or "REPLIES · 2" and turns accent-bordered with accent text when the thread is open.
- **Reply thread** (see Interactions) expands inside the card under a 1px `border` divider.

**Existing code:** `_components/FeedSection.tsx`, `_components/FeedComments.tsx`.

### 4. Presence sheet ("You tonight")

Pushed screen with a back chevron and title.

- Trust line: "Manual, always. Nothing here reads your location, and it all clears at 4 AM."
- "ARE YOU GOING OUT?" label, then three full-width rows (60px, 20px radius, `surface`, 18px padding): Going out / Maybe later / Not going out. Selected row gets an `accent` border, `rgba(255,91,58,0.10)` fill, and a trailing accent ✓. Unselected rows render **no** ✓ (`display: none`, not reduced opacity).
- "WHERE ARE YOU?" label, then a row with a 44px accent-tinted pin tile, the pinned bar name or "Pin my spot", a sub-line, and an accent chevron. Available whatever the status.
- Footer: "Pinning a bar sets you to Going out."

### 5. Bar picker → audience (the pin sequence)

Two steps; **nothing is written until "Pin it"**.

- **Bar picker:** "Pick where you are. Only the audience you choose next can see it, and it clears at 4 AM.", a search field, then rows of bar name 16px/600 over "LES" 11px muted uppercase.
- **Audience:** chosen bar as a 24px/700 heading, "Nothing is shared until you pin it.", then the three `AUDIENCE_LABELS` rows — **Friends**, **Close friends**, **Only some people** — labels only, no invented hints.
  - Picking "Only some people" reveals a mutuals-only picker: the line "Only friends who follow you back can be picked. This applies to tonight's pin only.", a "Search friends…" field, a bounded 260px scroller of friend rows, and a count in words below ("1 person will see this pin tonight.").
  - "Pin it" is held at `#1c1c1c`/`muted` while the audience is "Only some people" with zero recipients, and turns accent as soon as one is picked. Then a "Cancel" outlined pill.

**Existing code:** `lib/presence/PinDialogs.tsx` (`PinBarDialog`, `PinAudienceDialog`), `TonightPresence.tsx` (`choosePendingAudience`, `confirmPin`, `pin-pending-audience-count`), `lib/presence/index.ts`.

### 6. Create a night out

Partiful-style identity first, then logistics:

1. **Cover tile** — full-width, 150px, 24px radius. Empty: dashed `#3a3a3a` border, `surface`, centred "+ ADD A COVER PHOTO" 11px/700 muted uppercase 0.16em. Filled: the image (placeholder gradient in the prototype), label bottom-left on a translucent `text` chip. Tapping opens the picker.
2. **Name field** — borderless 22px/700 input with a 1px `border` underline, placeholder "Name the night", then "The name and cover are what people see on the invite."
3. **WHEN** — 16px-radius `surface` field, "Tonight, 9:00 PM".
4. **AREA (optional)** — same, seeded from the bar you pinned, default "Anywhere".
5. **WHO'S GOING** — wrapping 44px friend pills; selected get accent border, tint and accent text.
6. **SHORTLIST** — "N of 3" counter, the line "Seed the vote with up to three bars. Everyone can suggest more once the plan is live.", then bar rows with a trailing "+"/"✓". Cap at 3.
7. **CTA** — 54px accent pill, "Create the night out · 3 invited", then "Creates the plan and sends the invitations."

**Existing code:** `components/NightOutPlanFields.tsx`, `app/night-out/[token]`. The cover and name are **new** fields.

### 7. Plan board (vote → decided)

- Cover (when set), then title 28px/700 — the plan's name, falling back to "Where are we going?" — and "Saturday, September 13 · 9:00 PM · hosted by you" 13px muted.
- **Decided banner** (locked only): 24px-radius accent-bordered gradient card — "DECIDED" 10px accent uppercase, bar + neighborhood 24px/700, "Everyone invited has been told. Doors at 9:00 PM.", then two 44px outlined buttons, Directions and Share.
- **SHORTLIST** heading with "CLOSES 11:00 PM" (or "VOTING CLOSED") in accent 11px uppercase, then one row per bar: 20px radius, `surface`, accent border on the leader while open. Left: a 46px vote button (14px radius, ▲ over the count; accent border/tint/text when it holds your vote). Middle: bar name 16px/600 over "LES · suggested by you" 11px muted uppercase. Right: "LEADING" / "PICKED" in accent 10px uppercase, rendered **only** on the leading row.
- Voting is single-transfer: tapping a new bar moves your vote off the old one; tapping your current one clears it.
- "Suggest another bar…" field → picker; a suggestion lands with **zero** votes, including yours.
- **Lock in <leader>** — 52px accent pill, then "You're the host, so you decide. Voting closes on its own at 11:00 PM." Hidden once locked.
- **GOING** — rows of 34px avatar, name 15px/600, "INVITED VIA FRIENDS" 11px muted uppercase, and state ("Going" in `text`, "No reply" in `muted`).
- Footer: "Copy invite link" and "Not tonight".

**Existing code:** `friends/consensus/page.tsx` (Group Favorites, `SHORTLIST_CAP`), `night-out/[token]/page.tsx`.

### 8. Saved night recap

Reached from Plans → earlier nights. This is `/nights/[id]` plus `RecapCard`'s stop list:

Cover, title 24px/700, `savedNightSummary` line ("Saturday, September 6 · 2 bars · 4 photos") 12px muted, then a 20px/700 headline ("2 stops · you loved Attaboy"), then numbered stop rows: index 12px muted, a 32px `BarVisualTile` (glyph + hue from the bar's tags and price tier), bar name 14px/700 with a ♥ when loved, and a `RatingBadge` pill (Loved = accent fill; Liked = accent outline; Pass = struck through, muted). Then one primary 56px pill "Rank last night →" (or "See your rankings →"), an outlined "Share the night", a two-column photo grid at 16px radius, and a 192px map block of the night's pins.

**Existing code:** `app/nights/[id]/page.tsx`, `components/RecapCard.tsx`, `lib/nightOutMedia` (`savedNightSummary`), `lib/barVisual.ts`, `components/BarVisualTile.tsx`, `components/RatingBadge.tsx`.

### 9. Photo flow

Four steps, matching the repo's pipeline exactly.

1. **Capture modes** — a **bottom sheet**, not a pushed screen: full-bleed overlay with `justify-content: flex-end`, the sheet itself `surface`, `border-radius: 24px 24px 0 0`, 1px top border, 20px padding with 32px at the bottom. Header holds "Add to your story" 20px/700 and "Capture now, then choose who sees it." 14px muted, with a 44px ✕ ("Close capture") — no back chevron on this step. Three 64px rows, each a 40px accent-tinted tile with a 21px stroked icon, label 14px, hint 11px muted, chevron: **Take one photo** ("One fresh shot — rear or front camera."), **Front + back** ("Two shots, paired: the room and you."), **Choose from library** ("Use a photo you already have."). Footer, centred: "Nothing is shared until you review it and pick an audience."
2. **Approve or retake** — full screen. A "DRAFT — NOT SHARED" chip and a "Front + back" / "One photo" accent chip, the main photo at 3:4 with the inset bottom-right (92px, 3:4, 12px radius) on a paired shot, then — paired only — four 44px composition buttons in a 2×2 grid: Swap main photo, Keep only one, Rotate main, Rotate inset. Then Retake and **Use photos** / **Use photo** side by side, and "Retake discards this shot and reopens the capture options. Nothing has left your phone."
3. **Compose** — the pair as a 104px thumbnail with its inset, "Share a moment." 22px/700, a Retake pill, a caption field (140 char ceiling, counter appears in the last 40), then two 56px rows, **Bar** and **People**, each opening a sheet and showing its value in accent. People opens "Tag friends" — "Friends are people you follow who follow you back.", a search field, a total/picked header, a bounded 290px scroller of toggle rows, and Done. Then a 54px accent "Next".
4. **Destinations** — "Where does this go?" 22px/700 and exactly four multi-select rows, no fifth: **Feed** ("Stays until you delete it · friends can comment"), **Story** ("Visible for 24 hours"), **Night Out** (the plan's label, or "No night out tonight" and unavailable when there is none), **Group** (the group's name). Selected rows get accent border + `rgba(255,91,58,0.08)`. When Story is on, a **joined** sub-row — no gap, top border removed, bottom corners rounded — reads "Story audience" with the value in accent and opens the audience sheet. CTA names the picks ("Share to Feed and Story") and sits at `#1c1c1c`/`muted` with none selected. Footer: "One capture, one publish — no review screen after this."
5. **Receipt** — "Shared." 26px/700, a consequence line ("Live for 24 hours, and on your feed until you delete it."), the pair, then "See it" (accent) and **Undo**. Undo is an author **delete** of what was just published — it removes the post and ends the flow. It must not reopen the composer.

**Story audience sheet:** exactly two options, per `storyStore.ts`'s `StoryAudience = 'friends' | 'custom'` — **Friends** ("All accepted friends · your Account default") and **Custom** ("Pick people one by one"). Custom reveals the mutuals picker with "Who sees it. Only friends who follow you back can be picked." and a search field; Done reads "Pick at least one person" and is held while Custom has nobody. Dismissing with Custom empty falls back to Friends. Footer: "Applies to this story only. Your Account default stays Friends."

**Existing code:** `components/capture/CaptureFlow.tsx`, `CaptureModeSheet.tsx`, `CaptureReview.tsx`, `components/story/AddStoryFlow.tsx`, `StorySheets.tsx`, `components/composer/ComposeStep.tsx`, `DestinationsStep.tsx`.

### 10. Groups & people

Pushed from the header's people icon. Order matters — this changed:

1. Two 24px-radius count tiles side by side, **Followers** and **Following** (28px/700 number, 11px muted uppercase label), each linking to its list.
2. **FIND FRIENDS** — the @username search field. This now sits **above** Groups, directly under the counts.
3. **GROUPS** — 20px-radius `surface` rows, name 16px/600, unread count as an 22px accent badge. Empty: dashed box, "No groups yet. A group is a standing chat with the friends who follow you back." Then a 44px outlined "New group".
4. **Group Favorites** — 24px-radius row, "Bars your circle all rate highly", chevron → `/friends/consensus`.

Followers/Following lists: 38px avatar, name 15px/600, handle 12px muted, and an action pill — accent-outlined "Follow back" on Followers, muted "Following" on Following. Empty states name the consequence and offer the invite link.

**Existing code:** `_components/GroupsAndPeople.tsx`, `friends/followers`, `friends/following`.

## Interactions & behavior

**Reply thread (inline, in the post card).** Three distinct states — this is the point of the refinement:
- thread not read yet → "Replies could not be loaded yet." 11px muted. Never show this as "no replies".
- read and empty → "No replies yet."
- rows → 36px avatar, name 13px/600 + age 11px muted, body 13px/1.45, and a 28px × delete **rendered only** where the viewer is the commenter or the post author.
Composer: a 44px input plus a Send button that is `border`/`muted` while empty and accent-outlined once there is text. The draft clears **only** on a confirmed write — a refused write keeps the text. Ceiling is `MAX_FEED_COMMENT_LENGTH` (2000); show "N left" inside the last 200. At `FEED_COMMENTS_PER_POST` (200) rows, add "Showing the most recent 200 replies." Server refusals land in a live region beside the composer; a failed write must never read as success.

**Presence.** Selecting a status writes immediately; selecting a bar does not. The pin sequence holds bar + audience + recipients and writes once, on "Pin it", so there is no instant where a pin exists under an audience nobody chose. Changing a live pin's audience to "Only some people" opens the picker rather than sending a request. Pinning a bar implies Going out. Everything clears at 4 AM.

**Voting.** Single transferable vote as described above; a suggestion starts at zero. Only the host sees "Lock in". Locking freezes the shortlist and swaps the vote UI for directions/share.

**Navigation.** Every pushed screen has a back affordance and returns to where it was opened from — the capture sheet uses ✕ instead of a chevron. There are no dead ends: the plan card, status row, both header icons, group rows, count tiles, story cells, feed reply and "View night" all lead somewhere.

**Search fields** filter on display name or @handle, case-insensitive, and render "Nobody matches “query”." when empty. Each list is a bounded scroller so the sheet's actions stay reachable.

No animations are specified beyond the app's existing `transition-colors` on interactive elements.

## State

Per screen: active sub-tab; presence `{status, barId, audience, recipientIds}` plus the pending `{bar, audience, recipients}` held during the pin sequence; plan `{id, title, cover, when, area, invited[], shortlist[] (max 3), votes, myVote, locked}`; per-post comment threads keyed by post id, with "not yet read" distinct from "empty", plus the draft and any server notice; the share flow `{step, pair {main, inset}, caption, barId, taggedIds[], destinations[], storyAudience, storyRecipientIds[]}`; and the open sheet plus its search query.

Data all exists: `set_night_presence`, `fetchUnreadCounts`, `createGroup`, `addFeedComment` / `deleteFeedComment` / `fetchFeedComments`, `publish_story`, `get_my_night_out_invitation_notifications`, `markInvitationNotificationRead`, the consensus computation in `lib/demo/consensus.ts`.

## Assets

None new. Icons are inline stroked SVGs in the prototype (pin, people, camera, front+back, library) matching `BottomNav`'s 1.7–2.2 stroke weight — swap in the app's icon set if one exists. Avatars are initials on `Avatar.tsx`'s deterministic warm tone, seeded on handle. **Photos and plan covers are grey placeholders** — no imagery was produced; wire them to real uploads.

## Files in this bundle

- `Social Redesign.dc.html` — the canvas. Open this. Turn 1 holds the four Tonight explorations (1a is today, recreated); turn 2 the chosen direction across all three sub-tabs; turns 3 and 4 the refinements. Every phone is interactive.
- `SocialPhone.dc.html` — the component all of those render. One file; `variant="c"` is the chosen direction. Its logic carries inline comments naming the repo file each rule came from.
- `support.js` — runtime for the two files above.
- `SOCIAL-REDESIGN.md` — the shorter summary, including the table mapping each element to its source file and the known gaps.

The dashed chip in each phone's status bar toggles between an empty new account and an active night.

## Known gaps

- No group thread screen, so a group's unread count has nowhere to land.
- The plan shortlist picks from the bar catalog; it should offer Group Favorites first (`friends/consensus` already computes it).
- No guest-side RSVP view of a plan.
- Covers and feed photos are placeholders.
