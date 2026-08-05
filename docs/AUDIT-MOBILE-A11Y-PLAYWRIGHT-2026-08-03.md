# Mobile / A11y / Playwright audit + morning cleanup packet — 2026-08-03 (goal g-43d6da5f)

Produced unattended in the 2026-08-02/03 overnight run. Everything here is
either verified-by-run (named spec results) or evidence-with-recommendation.
Nothing was deleted; the cleanup packet below is attended-action-only.

## 1. Fixed this run

- **Install-sheet under BottomNav (crit 1) — REPRODUCED and FIXED.** The iOS
  "Add to Home Screen" sheet rendered at `z-[60]` beneath the `z-[1000]`
  BottomNav: the nav painted over the bottom sheet's lower edge and
  intercepted the "Got it" tap. Geometry-proven RED by the new
  `e2e/install-sheet.spec.ts` (elementFromPoint resolved to `nav`), fixed by
  moving the sheet to the app's modal tier `z-[1100]`, GREEN after.
  The spec joined the iPhone 17 compact-viewport project (same
  bottom-crowded shape as its siblings).

## 2. Viewport / project coverage audit (crit 2, 7)

Authoritative source: `playwright.config.ts` projects.

| Project | Engine | Scope |
| --- | --- | --- |
| warmup | — (request-level) | compiles every route before any spec (dev Fast Refresh full-reload artifact eliminated; added in g-65a31bdf) |
| iPhone 13 | WebKit | ALL specs |
| Pixel 7 | Chromium | ALL specs |
| iPhone 17 (402×681) | WebKit | 10 bottom-crowded/compact specs (mobile-controls, a11y-mobile, app-shell-smoke, vibe-tweak-reachable, map-lightbox, map-interaction, exact-filter-empty, cancel-bottomnav, search-bars, install-sheet) |
| Desktop marketing (NEW this run) | Desktop Chrome | app-store-pack + app-shell-smoke — the latter carries the actual /install marketing-route test (santa: Codex caught the first cut covering only /, /map and legal pages) |

Coverage by criterion-2 dimension:
- iPhone 13 / Pixel 7 / 402×681: covered as above.
- Desktop for marketing routes: NOW covered (new project). Before this run: zero.
- Landscape: NOT configured anywhere. Recommendation: one scoped landscape
  project over the map + lightbox specs if the operator wants it; not added
  unattended (runtime cost vs unknown priority).
- Keyboard-open: cancel-bottomnav.spec.ts is the responsible spec — it
  focuses the map search input, shrinks the viewport by 320px (a real
  soft-keyboard simulation) and asserts the action row stays clear; it also
  pins the safe-area formulas (santa: Codex corrected the first draft,
  which credited only the compact-viewport proxy).
- Modal/sheet: covered (map-lightbox, cancel-bottomnav, install-sheet,
  QuickAddBar via pairwise-flow/rankings-add-flow).
- Safe area: covered (BottomNav padding assertions in mobile-controls;
  bottom-crowded specs).
- Empty/loading/error: empty states covered (exact-filter-empty, want-to-go,
  rankings/search empty states); corrupt-storage covered (search-bars,
  rankings-lists); **offline: ZERO coverage anywhere** — gap, recommendation:
  one spec with `context.setOffline(true)` over the home surface asserting
  the static-catalog fallback renders. Not added tonight (needs a product
  decision on what offline SHOULD show before pinning it).
- Reduced motion (crit 6): `MotionConfig reducedMotion="user"` (VibeQuiz);
  NEW functional smoke added this run (quiz completes under
  `prefers-reduced-motion: reduce`, quiz-path.spec.ts).

## 3. Touch-target and a11y verification (crit 3, 4, 5)

- 44px minimum: enforced by convention (`min-h-[44px]` app-wide). ASSERTED
  coverage is narrower than the convention (santa: Codex): mobile-controls
  sweeps only its five PUBLIC_ROUTES and a11y-mobile checks control heights
  on `/` — routes like /quiz, /auth, /friends, /lists, /search rely on the
  class convention plus their own specs' targeted geometry assertions, not
  a global sweep. Gap recommendation: extend the sweep's route list when
  the g-90dccd13-era reachability harness is next touched.
  Ran this run: a11y-mobile passed CLEAN on all its viewports (part of the
  22-passed batch in §5's run; zero a11y-mobile failures).
- 56px primary-path: NO test in the suite asserts 56px anywhere (santa:
  Codex round 3 — the earlier draft claimed /search rows carried one; they
  carry the `min-h-[56px]` CLASS, and the spec's geometry assertion checks
  the adjacent save toggle against 44px). Convention only. Recommendation:
  one geometry assertion on the /search row height, and a decision on which
  other primary-path controls the 56px design target should pin.
- Focus trap/return/Escape/backdrop/roles/announcements: BarLightbox
  (trap + opener-return + Escape, pinned by map-lightbox + the g-7b6021a8
  focus-steal regression test), QuickAddBar (Escape + scroll lock),
  search's sr-only role=status announcements (santa-reviewed in
  g-7b6021a8), install sheet (role=dialog, aria-modal, backdrop click).

## 4. BarMedia decision (crit 11) — REMOVED, with evidence

`<BarMedia>` had ZERO production render sites. Its two once-intended
consumers each documented their reason to call `resolveMedia` (the single
media-policy boundary) directly: ResultCard's comment ("bespoke overlay …
is why this uses resolveMedia directly instead of the <BarMedia> wrapper"),
and BarLightbox resolves directly for the criterion-12/13 kill-switch path.
That is affirmative repo evidence of no intended consumer (the consumer
comments describing the direct-resolveMedia choice PRE-DATE tonight; only
BarVisualTile's inaccurate adoption claim was corrected in this run —
santa: GLM asked for the timestamping) → removed
`src/components/BarMedia.tsx` + its test; corrected BarVisualTile's stale
comment that claimed both surfaces "go through BarMedia" (they never did
after the migration to direct resolveMedia calls). The media POLICY is
untouched — one boundary, `src/lib/mediaPolicy.ts`, as before.

## 5. Known failures preserved as evidence (crit 8, 9, 10)

- **mobile-controls: 3 pre-existing failures** ("1 unreachable control on /",
  identical across all three viewports) — property of the blocked goal
  g-90f908bc (its recorded diagnosis was disproven; the real failure is
  documented on that goal's evidence). NOT chased tonight, NOT weakened —
  the assertions stand exactly as written, red, as the goal requires.
- **catalogSwapped readiness-poll flake** (search-bars, iPhone 13): recurred
  twice tonight, green on immediate re-run both times; dev-only (production
  has no on-demand compile). Watch count: night 2. If it recurs on a warm
  server after the warmup project, re-open the investigation recorded in
  the 2026-08-03 takeover notes.

## 6. Morning cleanup packet (crit 13) — ATTENDED ACTIONS ONLY, nothing deleted (crit 14)

### 6a. Dead failed deployment record (next-bar-staging project)

- **What**: one FAILED deployment in the next-bar-staging project's
  deployment list — the 2026-08-02 9-file "No Next.js version detected"
  upload made by the other tool during the half-provisioned setup (see
  STAGING-ACCEPTANCE notes). It predates the good deploy of 6464237.
- **Evidence**: deployment list for the project shows exactly one errored
  entry with a 9-file upload; the healthy deployment (READY, aliased) is
  the one serving.
- **Safe attended action**: from the platform dashboard → project →
  Deployments → the errored entry → Delete. API alternative: DELETE
  /v13/deployments/{id} with the errored deployment's id (list first, match
  state=ERROR, confirm createdAt 2026-08-02, confirm it is NOT aliased).
- **Rollback/recovery**: none needed — deleting an errored, never-aliased
  deployment cannot affect the serving alias. Abort if the entry shows any
  alias or state!=ERROR, and (santa: GLM) scan for any inbound reference to
  the deployment id (project settings, alias history) before deleting —
  never-aliased covers the main vector but not all of them.
- **Verification**: deployment list shows no ERROR entries; staging URL
  still serves; /api/health still returns sha 6464237852ca.

### 6b. Eight “phantom” rows in the Staging bars table — REFRAMED: they are labeled synthetic fixtures; CONFIRM INTENT BEFORE ANY DELETE

- **What**: 8 rows in the STAGING `bars` table absent from the current
  catalog: `7b-horseshoe-bar, kcbc-taproom, dominies-astoria,
  empire-hotel-rooftop, pieces-bar, slate, bar-coastal,
  the-slaughtered-lamb-pub`.
- **Evidence, BOTH readings (santa: Codex + Claude convergent)**: the
  operator flagged them as stale during the attended 2026-08-02 session
  (one, dominies-astoria, held a colliding place_id that was nulled). BUT
  their addresses read “Synthetic staging fixture, New York, NY” — they
  were seeded deliberately by the staging bootstrap, and the staging
  runbook’s row-count expectations may include them. These readings
  conflict; the packet does NOT decide.
- **Attended pre-action, in order**:
  1. Operator decides: keep the synthetic fixtures (do nothing; update the
     stale-rows note in the acceptance docs) or remove them. RECORD the
     decision + reasoning in docs/STAGING-ACCEPTANCE notes (or the goal's
     evidence) BEFORE any transaction opens (santa: DeepSeek — the next
     reader must be able to trace why).
  2. If removing — dependency sweep FIRST, enumerated from the SCHEMA, not
     from memory: grep the migrations for every bar-id-bearing column
     (known at writing: ratings, pairwise comparisons, `bar_rsvps`,
     shared-night tables, `bar_suggestions.bar_id` — which has NO foreign
     key and would orphan silently (santa: Codex round 3) — and any
     photo/queue tables) and check all of them for the 8 ids; a non-zero
     hit anywhere means STOP and widen the plan (bars-only backup cannot
     restore cascaded or orphaned children). Report the PER-TABLE hit
     counts to the operator before proceeding; hits in
     `bar_suggestions` are USER-GENERATED content and need their own
     explicit consent, distinct from the stale-bars intent (santa: GLM).
  3. Backup: `SELECT * FROM public.bars WHERE id IN (…8 ids…)` — save it.
  4. In ONE transaction: `DELETE … WHERE id IN (…) RETURNING id;` — commit
     only if exactly 8 rows return AND step-2 was clean; otherwise ROLLBACK.
- **Rollback/recovery**: re-INSERT the step-3 backup (valid only if step 2
  was clean — that precondition is what makes the rollback complete). If
  the sweep was NOT clean and a delete happened anyway, restore from a
  point-in-time backup taken immediately pre-transaction — a local
  ROLLBACK cannot resurrect rows a missed cache/denormalized table already
  lost (santa: GLM).
- **Verification**: row count −8; staging /api/health ok; map renders; none
  of the 8 names in /search; re-check the staging runbook’s expected-count
  figure and update it if it named 410.

## 7. Unresolved for the operator (carried forward, not decisions made tonight)

- Landscape project: add or explicitly decline (runtime cost).
- Offline behavior: decide the intended offline UX, then pin it with a spec.
- mobile-controls red trio: owned by blocked goal g-90f908bc.
