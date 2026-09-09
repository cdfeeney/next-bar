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
| Auth mode | signed-out by default; signed-in specs seed a session cookie only when `NEXT_PUBLIC_SUPABASE_URL` is present (eight `test.skip` sites in `night-out.spec.ts` otherwise) |
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
| V9-02 | plan form overflows the right edge on iPhone | `mobile-controls.spec.ts` (4 tests, 44px targets, on-screen check) — `/friends/consensus` is in its route list | measures control bounding boxes after two **fixed waits** (1000 ms, 500 ms); does not open native date/time selectors, does not type long names, does not raise the keyboard | overflow appears after selector/keyboard interaction and with long content — states the test never enters; fixed waits also sample mid-layout | test gap (interaction states) |
| V9-03 | created Night Out cannot be found again | `night-out.spec.ts` (39 tests) | four catch-all `page.route('**/rest/v1/**', fulfillJson(200, []))` answer **every** unstubbed REST/RPC call with an empty 200 — including `get_my_night_outs` | the create→navigate away→return journey is never asserted; a wrong or missing list request is indistinguishable from "no plans" because the stub returns `[]` for anything | test defect (fail-open stub) + missing journey |
| V9-04 | recipient picker is a wall of chips | no spec targets `inviteeSelection` / `GroupsAndPeople`; `night-out.spec.ts` seeds invitees via stubs | recipient set is never read back from the submitted request | submitted recipients are never compared with the visible selection | missing assertion |
| V9-05 | no suggestions/voting/real invite in the flow; CTA position | `night-out.spec.ts` vote/RSVP cases (`respond_night_out`, `lock_night_out`, `rsvp_night_out_by_token`) | stubs return success without inspecting request bodies; the create→invite→accept→vote chain is split across tests with seeded state | a write that sends the wrong arguments still "succeeds"; the flow order is not asserted | fail-open stub + missing journey |
| V9-06 | "No camera is available on this device" on iPhone | `add-story.spec.ts` (13 tests) mocks `getUserMedia` | browser emulation with a fake media stream | `ios/App/App/Info.plist` has no `NSCameraUsageDescription`; WKWebView permission behaviour is not reachable from Playwright at all | native gap — browser test cannot cover it |
| V9-07 | map name should open photos/hours | `map-interaction.spec.ts` (12 tests, 1 fixed wait) | popup open/close, pan, search focus | feature does not exist yet; nothing to have caught | new requirement |
| V9-11 | fonts differ from the chosen design | `a11y-mobile.spec.ts`, no font assertion anywhere | — | base is all-Poppins by code (`layout.tsx:3,16`); no test reads `document.fonts`; screenshots are not inspected | drift from approved art + no visual evidence |

## 3. Smell inventory (measured on the base, `e2e/*.spec.ts`, 46 specs)

- Catch-all REST stubs returning `[]`/`{}`: `night-out.spec.ts` :177, :206, :257, :607 (`**/rest/v1/**`), plus `**/auth/v1/**` → `{}` at :207, :258, :608. **These are the fail-open pattern.**
- Env-gated skips: `night-out.spec.ts` 8× `test.skip(SUPABASE_URL === null)`; `plan-invites.spec.ts` 1; `add-story.spec.ts` 1. Acknowledged by `assertAuthenticatedE2eConfigured`, which fails loudly outside CI — correct, keep.
- Fixed waits: `mobile-controls.spec.ts` :256 (1000 ms), :307 (500 ms); `map-interaction.spec.ts` 1.
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
- **`e2e/night-out.spec.ts`.** All four catch-alls replaced. Write RPCs now assert their request bodies:
  `join_night_out_by_token` and `rsvp_night_out_by_token` (`p_token`, `p_key`, `p_response`), `lock_night_out`
  (`p_night_out`), `respond_night_out` (`p_night_out`, `p_accept`, `p_expected_status`, `p_expected_revision`).
  Calls the blanket stub had been hiding, now explicit fixtures: the catalog (`fulfillCatalog`), `profiles`,
  `night_out_media_window`, and two **app-shell reads issued on every signed-in page** — `rpc/get_follow_requests`
  (inbox badge) and `GET /rest/v1/ratings` (server ratings sync). First strict run: 36/106 failed, all on exactly
  those two shell paths; explicit empty fixtures restored 104/106.
- **Observed and kept visible, not hidden:** in *signed-in non-member declines from the preview WITHOUT joining
  first*, once `decline_night_out_by_token` resolves the page issues five plan-board reads (`get_night_out`,
  `_board`, `_members`, `_voting`, `_anon_rsvps`) for a plan the user is not a member of. RLS answers a non-member
  with nothing, so the explicit fixture returns `[]`; whether the page should issue them at all after "Not tonight"
  is recorded here for the Night Out goal (V9-03/V9-05). The test's own assertions are unchanged.
- **`e2e/mobile-controls.spec.ts`.** Both fixed waits (1000 ms, 500 ms) replaced by `waitForStableControls`: an
  `expect.poll` that samples every control's bounding box and every element's `scrollTop` on two consecutive
  animation frames and requires them equal. Assertions unchanged.
- **Verification (lead, production build, both viewports, 0 retries):** `node scripts/run-e2e-release.mjs
  e2e/night-out.spec.ts e2e/mobile-controls.spec.ts` → `106 passed (1.7m)`, bounded-run exit 0. The delegated
  run itself could not launch browsers inside the Codex sandbox (binaries not visible: 106 failed before
  execution) — recorded as an environment limit of delegation, not as evidence.

## 6. Font commit vs `vibe-tweak-ranking.spec.ts:160` — reproduction attempt

**Does not reproduce on this base.** Bounded A/B, 2026-09-09 ~01:05 EDT: the three-file diff of `ee5913e`
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

The capture spec is opt-in (`VISUAL_CAPTURE_DIR`), and `playwright.config.ts` ignores it otherwise, so the release
gate carries no skipped capture cases. Screenshots are review evidence for browser rendering; they say nothing about
the installed app.

## 8. Remaining gaps after this goal

- Journeys for V9-03/04/05 (create → discover after reload; select → inspect invite set; invite → accept → vote) land with the Night Out goal, against the strict fixtures from §5.
- Staging integration and physical-device categories are untouched by this goal.
