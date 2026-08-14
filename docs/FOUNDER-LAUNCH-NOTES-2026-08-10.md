# Next Bar founder launch notes

Date: 2026-08-10  
Scope: read-only launch diagnosis and scope correction; no app, deployment, database, Apple, or notification changes made

## Decision

The four founders are the first seed cohort. The immediate objective is not more market research, venue coverage, or product breadth. It is to get all four founders into the same working build, complete a real night-planning loop on their phones, fix only blockers found in that loop, and then put the web/PWA version in front of friend groups.

The current bottleneck is **launch coordination and scope control**, not an inability to build software.

## The app is closer to launch than it appears

| Surface | Evidence on 2026-08-10 | Honest status |
|---|---|---|
| Production web | `https://next-bar-two.vercel.app/api/health` returned 200, Supabase `ok`, SHA `6ec5e5d` | Running, but behind the latest Staging release line |
| Staging web | `https://next-bar-staging.vercel.app/api/health` returned 200, Supabase `ok`, SHA `efca486` | Running the current `release/beta1-final-candidate` source |
| iOS build pipeline | GitHub Actions run [31142679072](https://github.com/cdfeeney/next-bar/actions/runs/31142679072) succeeded on 2026-08-07 and logged a successful signed IPA upload to App Store Connect | Working |
| Earlier physical install | `docs/CONTINUATION-2026-08-04.md` records build 5 installed on the operator's iPhone and an Internal Testing group created | Proven once; the four-founder roster still needs a current check |
| Latest TestFlight origin | The August 7 workflow log shows `CAP_SERVER_URL=https://next-bar-staging.vercel.app` | The installed shell can receive Staging web updates without another native build |
| Apple tester roster | The earlier continuation records two cofounder invites sent; on 2026-08-10 the operator confirmed that all four founders are now in the app | Distribution is no longer the assumed blocker; confirm the same build/environment during the test |

This means the next action is **not “finish the iOS app.”** Distribution has reached the founder cohort; the next action is the real four-account phone test.

## What is actually built

The latest release line already contains:

- accounts, handles, and onboarding;
- real follows and follow requests;
- rankings and ratings;
- followed-circle Group Favorites;
- bar suggestions, votes/RSVPs, and vibe voting for the caller plus followed users;
- shareable nights and revocation;
- Nights Out history;
- a working internal TestFlight upload path.

Important limitation: this is a **followed-circle** social model. It is not a private, invite-scoped Night Out. The existing "Invite friends" button shares `/join`; it does not create a group room.

Not launch-ready today:

- reusable Crews and per-night invited membership;
- invite-scoped visibility, removal, or expiry;
- native APNs notifications;
- a complete Web Push system. Subscription storage and browser helpers exist, but the opt-in UI and sender are not connected, and the feature is disabled;
- proven real multi-account behavior on protected Staging;
- a completed physical retest of the reported top safe-area, background, and scrolling issues.

### Notification behavior confirmed by source inspection

Cormac should **not currently be expected to receive a phone notification** when another founder votes, suggests a bar, changes the night's state, or informally "pings" him:

- there is no product-level ping action or notification event in the current release;
- native APNs support and the Capacitor Push Notifications plugin are absent;
- Web Push handlers and subscription helpers exist, but the feature is disabled, the helpers have no production UI call site, and no sender is connected;
- suggestions and vibe votes fetch on page mount and after the current user's own write. There is no Realtime subscription or polling that automatically updates Cormac's already-open screen.

Current expected behavior: after another founder changes the night, Cormac should see the shared state after reopening or remounting Plan Night Out. Failure after a deliberate reload/remount is a P0 cross-account data bug. Failure to show a lock-screen banner is an unbuilt notification feature, not a regression.

Desired product behavior later: notify immediately for a direct Night Out invitation or explicit ping, and optionally once when the group reaches a decision. Do not notify for every vote or suggestion.

The safe-area/scroll work appears to have already been implemented and reviewed on `fix/nighttime-mobile-hardening`; it has not been reconciled into `release/beta1-final-candidate`. Reuse and verify that work instead of rebuilding it.

## Why this has felt much slower than it should

### 1. “Launch” has never been frozen

The launch target has absorbed Crews, invited Night Outs, notifications, Close Friends, photos, recaps, native packaging, catalog work, design polish, scaling, and App Store concerns. That makes every useful build feel unfinished.

### 2. The system of record is fragmented

Today there are materially different states:

- checked-out branch: `feat/phase1-compliance-media` at `c02baf9`;
- Production/main: `6ec5e5d`;
- Staging/release candidate: `efca486`, 267 commits ahead of main;
- completed mobile fixes on another branch;
- old planning documents that still say TestFlight or Capacitor is not started.

The work exists, but it is difficult to see, promote, and trust as one release.

### 3. Mocked completeness has outrun behavioral proof

The social matrix has extensive unit and local browser coverage, but it explicitly says the social tests are mocked-localhost evidence. Four real accounts have not completed the complete cross-account path on Staging. That test should have happened much earlier and repeatedly.

### 4. Dark foundations have been mentally counted as features

Push subscription code and a database table are useful foundations, but they do not send a notification. A feature is complete only when a user can trigger and receive it on a physical phone.

### 5. Quality work has not been constrained by launch risk

The repository shows strong engineering discipline, but launch-critical work has been mixed with deep hardening, catalog expansion, documentation, and future-scale preparation. The result is high code output without a single four-person definition of done.

### 6. External integration was left late

Apple signing, runner SDK, Node version, origin configuration, physical-device behavior, and cofounder invitation acceptance surfaced after a large amount of implementation. These are normal integration failures, but they should be exercised at the start of each release slice.

## Frozen founder-launch scope

For the first founder night, use four dedicated accounts that follow only each other. In that controlled cohort, the existing followed-circle behavior is an acceptable temporary substitute for a private Crew.

The founder build passes when all four people can:

1. Confirm they are using the same TestFlight build/environment.
2. Open the app without a blank/offline shell or unusable safe-area/scroll behavior.
3. Create or recover an account and claim a handle.
4. Find and mutually follow the other three accounts; accept private-profile requests if applicable.
5. Open Plan Night Out and see the four-person circle.
6. Cast a vibe vote, suggest a bar, vote/RSVP, and see the other accounts' changes after refresh/reopen.
7. Reach one group choice and share the result.
8. Background and reopen the app without losing the session or the night's state.

For this test, notification means a manual iMessage/SMS/WhatsApp message containing the app link. Native push is not an acceptance criterion.

## 48-hour execution order

### Block 1 — build alignment, no coding

All four founders are already in the app. One founder now owns a 15-minute alignment check:

1. Confirm all four are opening the same TestFlight app/build.
2. Confirm each person can sign in and reach Plan Night Out.
3. Record the four account handles and mutual-follow state.
4. Capture only pass/fail and screenshots of blockers.

Do not start a new feature during this check.

### Block 2 — one real multi-account walkthrough

One founder drives the checklist, one records issues, and the other two behave like ordinary users. Run the frozen acceptance test above on four physical phones.

Classify findings:

- **P0 launch blocker:** cannot install/load/sign in; content is untappable/offscreen; cross-account change does not appear; data disappears; crash or security boundary failure.
- **P1 after pilot:** confusing copy, visual polish, slow non-blocking state, missing notification, missing chat, or an extra desired social feature.

Fix only P0s. Re-run the same four-phone path after each focused batch.

### Block 3 — reconcile and promote one release

After the founder path passes:

1. Choose one exact release candidate based on `release/beta1-final-candidate`.
2. Reconcile the already-reviewed mobile safe-area/scroll fixes rather than recreating them.
3. Run the existing focused tests plus one physical TestFlight pass.
4. Promote that exact verified web artifact to Production through the existing attended release process.
5. Verify Production health SHA, sign-in, follows, and one cross-account planning loop.

Do not merge every branch or every queued feature into this release.

### Block 4 — friend-group pilot

Use the Production web/PWA link for friends. Do not wait for a public App Store release: the current remote-origin TestFlight build is intentionally restricted to an internal group.

Pilot with five friend groups, roughly 20 people. For each group, record:

- invite/link sent;
- account created;
- first follow completed;
- first vote or suggestion completed;
- group choice reached;
- actual outing reported;
- returned within seven days.

Manual tracking is acceptable for the first five groups because analytics is currently dark. Instrument the same funnel before expanding past the pilot.

## Explicitly cut from the founder launch

- reusable Crews and persistent group chat;
- Close Friends;
- native APNs and broad notification preferences;
- night photos and recap maps;
- venue-pin migrations;
- more venue collection;
- a design-system rebuild;
- public App Store submission;
- 20,000-user scaling work;
- more creator scraping or growth research.

True invited Night Outs should be the next product candidate only if the five-group pilot proves that the follower-circle workaround creates confusion, privacy leakage, or onboarding friction. Native push should follow one proven trigger—most likely "you were invited to tonight's plan"—rather than becoming a generic notification project.

## Founder ownership

Assign one owner per outcome, regardless of titles:

| Owner | Outcome |
|---|---|
| Launch owner | One release candidate, TestFlight roster, Production promotion, final go/no-go |
| Product-test owner | Four-phone script, evidence, P0/P1 triage, retest |
| Growth owner | Schedules the first five friend groups and tracks activation/return |
| User-support owner | Watches the sessions, answers onboarding questions, and records exact friction |

Engineering can be shared; outcome ownership cannot.

## Pilot exit gate

Do not call the app launched because a build exists. Call the founder pilot complete when:

- all four founders complete the loop on two separate nights;
- no P0 remains;
- five friend groups have attempted the loop;
- at least three groups reach a shared choice;
- at least two groups return within seven days;
- every drop-off is measured well enough to choose the next single product change.

At that point, the team will have evidence for whether the next constraint is invited groups, notifications, onboarding, recommendation quality, or distribution. Until then, building all of them at once hides the answer.

## Existing evidence to keep authoritative

- `docs/SOCIAL-EVIDENCE-MATRIX-2026-08-05.md` on `release/beta1-final-candidate`
- `docs/MORNING-HANDOFF-2026-08-05.md` on `release/beta1-final-candidate`
- `docs/CONTINUATION-2026-08-04.md` on `release/beta1-final-candidate`
- `docs/IOS-TESTFLIGHT-RUNBOOK.md` on `origin/main`
- GitHub Actions TestFlight run [31142679072](https://github.com/cdfeeney/next-bar/actions/runs/31142679072)
