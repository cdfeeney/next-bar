# V9 coverage audit — why phone failures escaped the gate (V9-12, with V9-11 evidence)

Goal g-a7262f1f, run nb-v9-overnight-20260908. Base `3d29726` (= TestFlight commit `1eae20a` + V9 docs) plus the
rebased retirement slice (`21b50d9`, reviewed). Written before changing shared code; sections 5–6 record what the
repairs and probes in this goal actually did.

## 1. Test identity — what a green run certifies

| Dimension | Value at this candidate |
|---|---|
| Source / test / config commit | this worktree's HEAD (recorded in the candidate) |
| Built artifact | `next build` production bundle, fresh per `scripts/run-e2e-release.mjs` run |
| Base URL | `http://localhost:3517` (`PLAYWRIGHT_PORT`, per-worktree) |
| Database | Supabase **staging** project (`NEXT_BAR_STAGING_PROJECT_REFS`), anon key only; the guard var `NEXT_BAR_PRODUCTION_PROJECT_REF` is set so production is refused |
| Auth mode | signed-out by default; signed-in specs seed a session cookie only when `NEXT_PUBLIC_SUPABASE_URL` is present (29 `test.skip` sites in `night-out.spec.ts` otherwise, one per signed-in test) |
| Catalog | bundled Manhattan catalog fixture; specs wait for `Loading the Manhattan catalog` to clear |
| Engines / devices | Playwright `iPhone 13` (WebKit) and `Pixel 7` (Chromium) emulation. **Neither is the installed Capacitor app.** |
| Providers | `NEXT_BAR_ROUTING_ENABLED=true`; route fixtures are mocked in specs; Google media disabled in the gate |
| Retries / workers | 0 retries, 3 workers in release mode |

Consequence: a green gate certifies *this commit, built here, against mocked providers and (mostly) mocked REST,
in two browser emulators*. It says nothing about the TestFlight binary's origin, its WKWebView permissions, or real
Supabase persistence. The owner's phone reports are a third evidence category that no Playwright count can stand in for.

## 2. Feedback-to-test map

| Item | Owner symptom | Existing coverage | What the existing test actually exercises | Why the phone failure escaped | Classification |
|---|---|---|---|---|---|
| V9-01 | "Only 3 routes confirmed" copy; three results | none — no spec matches `routes confirmed` / `Checked … candidates` | `one-results-view.spec.ts` asserts five cards from a fixture catalog; `distance-routes.spec.ts` mocks route responses (8 `page.route`) | copy is only rendered when `ranked.length < count`; every fixture yields 5 routed results so the branch never renders | product copy + missing negative-state test |
| V9-02 | plan form overflows the right edge on iPhone | **none for the form.** `mobile-controls.spec.ts` (4 `test()` declarations generating 12 cases per device: 1 + 5 routes × 2 + 1; 44px targets, on-screen check) runs only `PUBLIC_ROUTES` = `/`, `/map`, `/rankings`, `/settings`, `/install` (`:233`); `/friends/consensus` is not in it. `night-out.spec.ts` "the Start a Night Out form" tests reach the form but assert fields, not geometry | the control-geometry check never visits the planner; where it does run it used two **fixed waits** (1000 ms, 500 ms) and never opens native date/time selectors, types long names, or raises the keyboard | overflow appears on a route the geometry check never visits, in states no test enters; fixed waits also sample mid-layout | test gap (route + interaction states) |
| V9-03 | created Night Out cannot be found again | `night-out.spec.ts` (39 `test()` declarations at the base) | twelve catch-all `page.route('**/rest/v1/**', fulfillJson(200, []))` sites answer **every** unstubbed REST/RPC call with an empty 200 — including `get_my_night_outs` | the create→navigate away→return journey was never asserted; a wrong or missing list request was indistinguishable from "no plans" because the stub returned `[]` for anything. **Repaired in §5: the journey now exists with a stateful list fixture.** | test defect (fail-open stub) + missing journey |
| V9-04 | recipient picker is a wall of chips | no spec targets `inviteeSelection` / `GroupsAndPeople`; `night-out.spec.ts` seeds invitees via stubs | recipient set is never read back from the submitted request | submitted recipients are never compared with the visible selection | missing assertion |
| V9-05 | no suggestions/voting/real invite in the flow; CTA position | `night-out.spec.ts` vote/RSVP cases (`respond_night_out`, `lock_night_out`, `rsvp_night_out_by_token`) | stubs return success without inspecting request bodies; the create→invite→accept→vote chain is split across tests with seeded state | a write that sends the wrong arguments still "succeeds"; the flow order is not asserted | fail-open stub + missing journey |
| V9-06 | "No camera is available on this device" on iPhone | `add-story.spec.ts` (13 tests) mocks `getUserMedia` | browser emulation with a fake media stream | `ios/App/App/Info.plist` has no `NSCameraUsageDescription`; WKWebView permission behaviour is not reachable from Playwright at all | native gap — browser test cannot cover it |
| V9-07 | map name should open photos/hours | `map-interaction.spec.ts` (12 tests, 1 fixed wait) | popup open/close, pan, search focus | feature does not exist yet; nothing to have caught | new requirement |
| V9-11 | fonts differ from the chosen design | `a11y-mobile.spec.ts`, no font assertion anywhere | — | base is all-Poppins by code (`layout.tsx:3,16`); no test reads `document.fonts`; screenshots are not inspected | drift from approved art + no visual evidence |

## 3. Smell inventory (measured on the base, `e2e/*.spec.ts`, 46 specs)

- Catch-all REST stubs returning `[]`: **twelve** sites in `night-out.spec.ts` at the base — `stubBearerRpcs` :177,
  `stubMemberRpcs` :206, `stubOwnerRpcs` :257, the non-member decline test :607, the invite-token trio :790, the
  dead-link test :839, `stubTonight` :1055, the failed-own-pin test :1265, three Saved Nights Out tests :1656/:1724/:1754,
  and `openTheForm` :1788 (line numbers as of the base). The first revision of this audit counted four: its inventory
  grepped for the one-line form and missed the other eight, which the round-1 panel caught. Plus `**/auth/v1/**` → `{}`
  beside each. **These are the fail-open pattern.**
- Env-gated skips: `night-out.spec.ts` **29** `test.skip(SUPABASE_URL === null, …)` call sites (one per signed-in test);
  `plan-invites.spec.ts` 1; `add-story.spec.ts` 1; `story-rail.spec.ts` 1; `suggestions.spec.ts` 1. Acknowledged by
  `assertAuthenticatedE2eConfigured`, which fails loudly outside CI — correct, keep; with the URL present none of them
  skip (the gate reports 0 skipped from these files).
- Fixed waits at the base: `mobile-controls.spec.ts` :256 (1000 ms), :307 (500 ms) — **repaired here**;
  `map-interaction.spec.ts` 1, `app-shell-smoke.spec.ts:21` (250 ms), `claim-handle.spec.ts:239` (700 ms),
  `onboarding-identity.spec.ts:313` (1000 ms) — untouched, none guards a V9 item.
- Force/soft/retry markers across 14 specs (claim-handle 2, follow-requests 4, friends-real 3, others 1 each) — reviewed, not repaired here; none guard a V9 item.
- Timezone-free clock literal: `vibe-tweak-ranking.spec.ts:26` `new Date('2026-07-24T23:00:00')` — parsed in the host zone, the same species as the night-out pin fixed in `9a5e6fa`. Latent, not the cause of the font failure (see §6).

## 4. Three evidence categories — never substitute one for another

1. **Deterministic browser regression** (this gate): mocked providers, fixture catalog, strict REST fixtures after §5. Proves UI logic and request shape.
2. **Isolated staging integration**: real Supabase staging persistence and auth, bounded provider use, isolated test accounts. Not run in the unattended loop; required before release for V9-03/04/05.
3. **Physical TestFlight iPhone**: camera permission (V9-06), keyboard/safe-area overflow (V9-02), rendered typography (V9-11). Attended only.

## 5. Repairs made in this goal

Implemented by the delegated Codex slice (write scope `e2e/night-out.spec.ts`, `e2e/mobile-controls.spec.ts`,
`e2e/helpers/`), integrated and verified by the lead.

- **`e2e/helpers/strictRest.ts` (new).** `stubStrictRest(page)` replaces the blanket `**/rest/v1/**` → `[]` catch-all:
  any REST/RPC request no specific fixture answers is recorded (method, URL, decoded body) and answered with a JSON
  500 so the app cannot hang; `assertNoUnexpectedRest(page)` runs in `test.afterEach` and fails the test listing them.
  Route order is preserved (strict catch-all first, specific fixtures after, last-registered wins).
- **`e2e/night-out.spec.ts`.** All **twelve** catch-alls replaced by `stubNightOutRest` (strict catch-all + the
  root-layout and app-shell fixtures: catalog, `profiles`, `rpc/get_follow_requests`, `GET /rest/v1/ratings`). Tests
  that walk through Social add `stubSocialShellRest` (the page's entry reads, each named and empty: following /
  followers / outgoing requests, `groups`, `stories`, `group_unread_counts`, invitation notifications, friend ratings,
  circle and own presence); the Start-form tests add the Plans sub-tab reads (`get_my_night_outs`, circle RSVPs /
  suggestions / vibe votes). Write RPCs assert their bodies: `join_night_out_by_token` and `rsvp_night_out_by_token`
  (`p_token`, `p_key`, `p_response`), `lock_night_out` (`p_night_out`), `respond_night_out` (`p_night_out`, `p_accept`,
  `p_expected_status`, `p_expected_revision`). Read RPCs assert their identity too: `resolve_night_out_by_token`
  requires `{ p_token: TOKEN }` and every `get_night_out*` read requires `p_night_out === PLAN_ID`, so a fixture can no
  longer answer a wrong plan and keep an exact-plan regression green (round-1 Codex finding).
  Strict-mode history: first run 36/106 failed on exactly the two shell paths; after the twelve-site repair 18/106
  failed on the Social-page reads above; explicit fixtures → 106/106.
- **Post-decline paint, corrected by the round-1 panel.** In *signed-in non-member declines from the preview WITHOUT
  joining first*, the five plan reads after a successful decline are the page's own `loadMemberView(planId)`
  (`page.tsx:812-816`) — by design, not a stray. The server's real answer is the plan with `caller_status: 'declined'`:
  `decline_night_out_by_token` writes a declined member row (0046:196-198) and `get_night_out` returns the plan for any
  member row (0059:228-241). The first revision fixtured these reads as `[]`, which made `loadMemberView` fail and
  would have hidden the resulting "Couldn't send that — the link may have expired." after a decline that succeeded.
  The fixture now returns the declined plan row and an empty board, and the test asserts the declined state renders
  ("You're out for this one…", `page.tsx:1251`) and the error banner does not. Nothing here is a V9-03/V9-05 question.
- **V9-03 journey added** ("V9-03: a plan created once is discoverable again after leaving, returning and reloading"):
  from the Plans entry point, create once (`create_night_out` body asserted), land on `/night-out/<token>` as owner,
  leave for `/map`, return to Plans, reload, return again — the same plan must be listed each time and exactly one
  create may have happened. The `get_my_night_outs` fixture is **stateful** (empty until the create RPC was issued,
  shaped as the server answers). **V9-03 is REPRODUCED in the browser, with its cause.** `get_my_night_outs` excludes
  the caller's own plans (`supabase/migrations/0059_night_outs_respond_revision.sql:296`, `n.owner_id <> auth.uid()`;
  restated at `src/lib/nightOuts.server.ts:355-357`), `PlansSection` renders only the Start link plus `PlanInvites`, and
  `StartNightOutButton.tsx:38-41` records "no surface lists plans you own" as a residual V8-3 gap. So after creating, the
  owner's Plans tab is genuinely empty — the phone report, exactly. A first draft of this fixture returned the owner's
  row and went green; the round-3 panel (both lanes) caught it as the fail-open this goal exists to remove. Now:
  the journey asserts what holds (one create, owner lands on the plan, Plans re-reads the list on return and reload,
  never a second create), and a separate case — "V9-03: the plan an owner just created is listed under Plans after
  returning" — asserts the missing behaviour under `test.fail(true, …)` naming V9-03, so it reports as an expected
  failure today and turns red when the Night Out goal adds an owner surface or includes owned plans in the list.
  This is not a staging or device question; it is a product gap with a line number.
- **V9-04 default observed and pinned.** Running the journey under the strict fixture showed `invite_to_night_out`
  firing for the one circle member without the test selecting anyone. The cause is a **visible** default, not a silent
  one: the consensus page pre-selects every circle member (`src/app/friends/consensus/page.tsx`, `effectiveSelected`:
  "Everyone you follow starts selected — including members with no ratings"; each chip renders `aria-pressed="true"`,
  a no-ratings friend as "Sam — no ranked bars yet"). Whether "everyone by default" is the right default is V9-04's design call ("make actual
  recipients clear before submission"). What must hold regardless is pinned by "V9-04: the invite set equals the
  visible selection — deselecting everyone invites nobody": the chip starts pressed, the test deselects it, starts the
  plan, and asserts zero invites. **Passes on this base** (`fb4-e2e-slice-2.log`) — the invariant holds; only the
  default is in question. A first draft of this case asserted
  "nobody selected" without deselecting and mislabelled the default as silent; the round-3 Codex lane caught it.
- **`e2e/mobile-controls.spec.ts`.** Both fixed waits (1000 ms, 500 ms) replaced by `waitForStableControls`: an
  `expect.poll` that samples every control's bounding box and every element's `scrollTop` on two consecutive
  animation frames and requires them equal. Assertions unchanged.
- **Verification (lead, production build, both viewports, 0 retries):** `node scripts/run-e2e-release.mjs
  e2e/night-out.spec.ts e2e/mobile-controls.spec.ts` → `106 passed (1.7m)`, bounded-run exit 0, on the round-2 tree.
  The three-part gate for the **frozen candidate** (typecheck, stored Vitest run, unfiltered production Playwright) is
  recorded where it binds to the exact commit — the goal's store evidence and the run directory logs
  (`D:/harness-handoffs/nextbar-v9-overnight/nb-v9-overnight-20260908/fb2-*.log`) — not in this file, which is part of
  the commit being gated and so cannot carry its own result. For the record, the round-1 candidate `a3f7f291` measured
  `738 tests: 736 passed, 0 failed, 2 skipped` (the pre-existing `/friends` overscroll pair), 10.1 m. The delegated
  Codex run could not launch browsers inside its sandbox (binaries not visible: 106 failed before execution) — an
  environment limit of delegation, never evidence.

## 6. Font commit vs `vibe-tweak-ranking.spec.ts:160` — reproduction attempt (mechanism NOT established)

**Does not reproduce on this base; the 09-03 mechanism remains unidentified.** The goal asked for a root-cause note;
what this probe delivers is narrower and is stated as such: on this base the approved fonts do not trigger the failure.
Establishing *why* they did on 2026-09-03 needs a bisect across `fa295e3..1eae20a` with the font diff applied at each
step — deferred to the V9-11 goal, which owns that file. The probe applied the diff to the working tree and restored it
byte-for-byte (SHA-256 verified) rather than using a scratch branch; the overnight boundary forbids branch switches. Bounded A/B, 2026-09-09 ~01:05 EDT: the three-file diff of `ee5913e`
(`src/app/layout.tsx`, `tailwind.config.ts`, `src/app/globals.css` — Playfair Display 600/700 display, Nunito Sans
400/600/700 body) was applied to the working tree at this candidate's base, `.next` removed, a production build made,
and `e2e/vibe-tweak-ranking.spec.ts` run on both viewports: **4/4 passed** (`18 passed (1.1m)` including the 14
capture cases; bounded-run exit 0; log `fb-font-ab.log` in the run directory). `document.fonts` on every captured
screen listed `__Playfair_Display 600/700` and `__Nunito_Sans 400/600/700` as loaded, so the fonts were genuinely in
play. The three files were then restored from an out-of-repo snapshot and verified by SHA-256; no font change is part
of this candidate.

What that means and does not mean. On 2026-09-03 the same three-file change failed this spec 3/3 on `release/v8`
(parent `fa295e3` passed) and was held back. This base carries nine later commits on the recommendation path
(`9a5e6fa` separate travel bands + strict vibe eligibility, `f309066` refresh-history, `1eae20a` routing) that
changed how results settle. The cheapest consistent explanation is that the 09-03 failure was a **ranking-order
instability under timing shifts** (a font swap with `display: 'swap'` reflows and re-times the settle) that the
later recommendation rework removed — not a typography defect. That is a hypothesis: no bisect was run, and the old
failure was never measured on this base. What is established: the approved fonts can be restored on this base
without the held-back failure, and the V9-11 goal should re-run this exact spec as its first check.

Latent, unrelated: `vibe-tweak-ranking.spec.ts:26` pins the clock with a timezone-free literal
(`new Date('2026-07-24T23:00:00')`), the species fixed for `night-out.spec.ts` in `9a5e6fa`. Green on this EDT host;
would drift on a PDT/UTC runner. Left for the V9-11 goal (same file).

## 7. Visual evidence captured

`docs/design-reference/actual-2026-09-09/` — one full-page PNG per screen per viewport (Next Bar? home, Map,
Rankings, Social, plan form, Settings, Nights) from `e2e/visual-capture.spec.ts`, captured after
`document.fonts.ready` with the loaded faces logged per capture. Two sets:

- root: the base as it is — every screen loaded **Poppins 400/700 only** (`__Poppins_528a31`), which is the
  drift V9-11 reports.
- `with-fonts-ee5913e/`: the same screens with the approved pair applied during the §6 probe — the V9-11 target
  rendered on real screens, for the owner's side-by-side against `docs/design-reference/approved/`.

`docs/design-reference/actual-2026-09-09/README.md` maps every capture to its approved reference and names what is
**not** captured: plan details (`/night-out/<token>`, needs the member fixtures) and the opened photos/hours lightbox —
both still owed to V9-11. Each capture now waits for its screen's own readiness text (not just `main`) and records
whether the network went idle instead of silently ignoring a page that never does.

The capture spec is opt-in (`VISUAL_CAPTURE_DIR`), and `playwright.config.ts` ignores it otherwise, so the release
gate carries no skipped capture cases. Screenshots are review evidence for browser rendering; they say nothing about
the installed app.

## 8. Remaining gaps after this goal

- V9-03 is reproduced with a cause (§5): owned plans are excluded from `get_my_night_outs` and no surface lists them.
  The Night Out goal owns the fix (owner surface or list inclusion) and removes the `test.fail` annotation when it
  lands. The V9-04 default-all selection is a design decision for that goal; the invite-set-equals-selection invariant
  is already pinned. The V9-05 journey (invite → accept → vote) lands with the Night Out goal, against the strict
  fixtures from §5.
- Staging integration and physical-device categories are untouched by this goal.
