# V9 overlooked work — 2026-09-08

**Base candidate:** `6e8fab1c2a1c5543312c7e746e5973c359936edf`.
**Method:** `product-roadmap-review`, product-audit mode; skill recorded on the goal
as `08d555d15ef241e4e344a02949bb2db8eeb3a71fd512e7a0479f29e85b6b286d`.
**Companion:** `docs/V9-LEGACY-RETIREMENT-2026-09-08.md`.

The operator asked what they should be working on and are not. This answers from
local product evidence only. No market claims, no competitor research, no invented
users, no invented numbers. Where the evidence does not support a claim, the item
says so rather than filling the gap.

---

## 1. Decision summary

**The single most consequential gap is that Next Bar collects no usage evidence at
all.** The analytics module exists, ships dark, and has zero callers (item 1). Every
prioritisation below it — including this document's own ranking — is therefore
reasoning from code and contract, not from what people do. Fixing that is cheap and
it is what makes the *next* roadmap defensible instead of plausible.

Behind it sit three cheap credibility repairs the product is currently making
promises it cannot keep on: a release contract whose "what is left" list is wrong
(item 2), a freshness guarantee computed from placeholder dates (item 5), and a
five-surface app with no error boundary on any of the five (item 4).

And there is a recurring shape worth naming on its own: **four separate capabilities
are fully built and wired to nothing** — the approved global composer, web push,
badges, and analytics. That is not dead code; it is finished work sitting one commit
away from being usable, and nobody is tracking it.

**What is explicitly not recommended:** new features. See §6.

---

## 2. Evidence register

| # | Source | Fact established | Strength |
|---|---|---|---|
| A1 | `src/lib/analytics.ts:19` `trackEvent` — `git grep "lib/analytics"` returns only `src/app/api/event/route.ts:4`, importing the name constant | No product code emits any analytics event | fact |
| A2 | `src/lib/analytics.ts:15` requires `NEXT_PUBLIC_ANALYTICS === '1'`; `src/app/api/event/route.ts` is "503-dark unless `ANALYTICS_ENABLED === '1'`" | Even wired, the pipeline is off in every deployment | fact |
| A3 | `docs/V8-TRACEABILITY-LEDGER.json` coverage tally `{partial:67, complete:12, contradicted:16, stale:1, missing:54}` | 54 approved requirements read as unimplemented | fact |
| A4 | `V8-R-GRP-001` reads `coverage: missing` while naming `src/app/friends/_components/GroupsAndPeople.tsx` as its implementation path — and that file exists, alongside `src/lib/groups.server.ts` (883 lines) and `GroupThread.tsx` (1,052 lines) | At least one row is internally contradictory | fact |
| A5 | `docs/V8-DECISIONS-2026-09-07.md` §5 lists `V8-R-STO-014` and `V8-R-STO-015` as "approved requirements with missing implementation", yet `src/lib/media/reEncode.ts` implements the re-encode and is wired at `src/app/api/media/upload/route.ts:209`, and `src/lib/media/signedUrl.ts` implements the server-decided lifetime | Two mandatory security requirements are recorded as unbuilt while built | fact |
| A6 | `src/components/composer/` — 2,241 product lines across six files, zero non-test importers, no dynamic import, and the string "Share a moment" appears nowhere outside the directory | `V8-R-CMP-001`…`016` are unreachable | fact |
| A7 | `find src/app -name "error.tsx" -o -name "global-error.tsx"` returns nothing; `src/components/states/OperationalState.tsx` is imported only by `onboarding/page.tsx` and four `settings/**` pages | No main surface has a route error boundary or the approved degraded state | fact |
| A8 | `src/lib/bars.core.ts:11` `PLACEHOLDER_VERIFIED = '2026-04-01'`, used 38 times; the file header states the dates "are PLACEHOLDERS so all bars pass the 180-day hard filter"; `src/lib/matching.ts:221` filters on `LAST_VERIFIED_HARD_FILTER_DAYS` = `365` (`src/lib/constants.ts:30`) | The freshness filter is applied to fabricated dates | fact |
| A9 | `src/components/FreeTextSeed.tsx:88` sets `lastVerified: new Date().toISOString().split('T')[0]` on a user-typed bar | A bar nobody checked is stamped verified today | fact |
| A10 | `package.json` dependencies list contains no error-monitoring client; `src/components/CatalogRefresh.tsx` reports its `fallback` state only as on-screen text | Server-side and client-side failures are unobservable to the operator | fact |
| A11 | `.github/workflows/ci.yml` runs `tsc --noEmit`, `vitest run` and `npm run build`. `npm run check:contract` and `npm run check:catalog-bundle` appear in no workflow; `check:catalog-bundle` is referenced only by `package.json:20`. No ESLint config file and no `eslint` dependency exist | Two release-critical checks are unarmed and there is no linter | fact |
| A12 | `e2e/a11y-mobile.spec.ts` covers target size and text scaling; contrast lives in `src/lib/paletteContrast.test.ts`; no axe or equivalent rule engine is a dependency | Accessibility coverage is four hand-written criteria, not a rule sweep | fact |
| A13 | `src/lib/push.ts:19` `isPushEnabled()` needs two unset env flags; `subscribeToPush` (line 60) has zero callers; the only importer is `src/app/settings/_signOut.ts:3` | There is no return-visit mechanism | fact |
| A14 | `public/sw.js:8` `SHELL_URLS = ['/', '/quiz', '/where-next', '/tried', '/manifest.webmanifest']` | The offline shell caches none of Map, Rankings, Friends or Settings | fact |
| A15 | `src/lib/placesUiKit.ts` exports `billableEventCount()` and `billableEventCountForSurface()`; their only importer is `src/components/GooglePlacePhoto.tsx` | The billing meter is never transmitted anywhere | fact |
| A16 | `docs/GOOGLE-MEDIA-RUNBOOK.md:31-32` documents a Google Cloud SKU quota cap and a billing budget + alert as the spending stops | The provider-side ceiling is designed; whether it is *set* is a console fact this audit cannot read | fact + unknown |

**Confidence ceiling.** This audit can establish what the repository does and what
the contract says. It cannot establish what users need, how often anything is used,
whether the Google quota cap is actually configured, or what the live database rows
contain. Every item below is scoped to that ceiling, and the items that depend on
absent evidence say so instead of guessing.

---

## 3. Decision coverage ledger

| Trigger | Status | Decision or gap | Smallest evidence or test | Release implication |
|---|---|---|---|---|
| Alternatives / competition / new idea | **not triggered** | This is an audit of an existing approved product; no new idea is proposed here | — | — |
| Price / tier / monetization | **not triggered** | No monetization surface exists or is proposed in V8 | — | — |
| Launch, growth, adoption | **fact + unknown** | The install path (`/install`) and the iOS TestFlight route exist (`docs/IOS-TESTFLIGHT-RUNBOOK.md`, `.github/workflows/ios-testflight.yml`), but no funnel is instrumented — `trackEvent` has no callers | Wire the four existing event names; read one week | Launch readiness is unmeasurable, not unmet |
| Experiment / metric / causal claim | **unknown** | No baseline exists for any product metric. This document deliberately makes no causal or improvement claim | Item 1 is the prerequisite for any experiment | No A/B or metric claim may be made before item 1 |
| AI / data-dependent decision | **fact** | The learned-taste ranker is data-dependent and **does** have offline evaluation: `src/lib/__evals__/` (`matching.eval.test.ts`, `rankingReplay.eval.test.ts`, `cascadeInvariants.ts`) and `docs/RANKING-EVAL-2026-08-19.md`. Constants in `src/lib/tasteAffinity.ts` are documented as product decisions, not tuning knobs | Existing evals run in `npm test` | Adequately covered; no action proposed |
| Platform / API / vendor / long-lived data | **fact** | Four external dependencies: Google Places UI Kit (metered, item 10), Supabase (catalog + auth + storage), OpenFreeMap/MapLibre basemap, Capacitor/iOS. Media lifecycle is handled — `src/lib/media/signedUrl.ts` caps URL lifetime, `/api/media/reclaim` runs on a `vercel.json` cron | Item 10 covers the residual cost gap | Vendor fallbacks exist; observability of them does not (item 6) |
| Regulated / high-harm | **fact** | Alcohol venues, precise location and user photos, with a 21+ device acknowledgement (`src/app/onboarding/age/page.tsx`, `src/app/onboarding/_ageAck.ts`) and server-side EXIF/GPS stripping (`src/lib/media/reEncode.ts`). `src/lib/moderation/` exists | Not re-litigated here; the retirement audit's S1 is the one safety-relevant item | Age gate and metadata stripping are present and wired |
| Release commitment | **fact** | The V8 release contract validates (`check-release-contract.mjs` exits 0) but its coverage field is wrong (item 2) and two of its checks are not in CI (item 7) | Items 2 and 7 | The contract cannot currently answer "what is left" |

---

## 4. Product and actor map

Stage: pre-launch, with live v7 users on the production project. Shape: a
**single-user recommendation product with a social layer bolted beside it** — one
person choosing a bar tonight, plus friends, groups, stories and night-outs.

| Actor | What they need | Where it is served |
|---|---|---|
| The person choosing a bar tonight | Five trustworthy ranked bars, right now, near enough | `/` Next Bar?, `src/lib/matching.ts`, `ResultsView.tsx` |
| The same person, next week | A reason to come back | **Nothing** — item 9 |
| A friend receiving an invite | A readable invite that works signed-out | `/night-out/[token]` (`V8-R-INV-001`…`007`) |
| The operator (founder) | To know what is built, what is used, what it costs, and what broke | **Weakest surface by far** — items 1, 2, 6, 10 |

The conflict worth stating: the social layer (stories, groups, feed, night-outs) is
by volume the largest part of the codebase, while the product's stated job — "which
bar next" — is the smaller and the one with a data-freshness problem (item 5). This
document does not propose resolving that; it proposes measuring it first (item 1).

---

## 5. The ten items, prioritised

Ordered by (what it unblocks) ÷ (effort), with release-credibility repairs ahead of
capability work, per the method's sequencing rule.

---

### 1. Nothing in the product emits a usage event

- **Status:** fact — A1, A2.
- **Source:** `src/lib/analytics.ts:19` (`trackEvent`, four event names: `search`,
  `share`, `save`, `visit`); its only importer is `src/app/api/event/route.ts:4`,
  which imports the name constant, not the emitter. `docs/ANALYTICS-DESIGN.md`.
- **User impact:** none directly. **Operator impact is total**: no one can say
  whether anyone completes a search, opens a bar, returns, or abandons onboarding.
- **Confidence:** High. **Effort:** Low — the server route, the migration (`0018`),
  the rate limiter, the privacy model and the counter are already written and
  reviewed; what is missing is call sites and two flags.
- **Smallest useful action:** add `trackEvent('search')` where results render and
  `trackEvent('visit')` on a bar open, enable both flags on staging, and read one
  week. A test that asserts the emitter fires on the results path is enough to keep
  it wired.
- **Owner:** **founder** decides whether the four existing names are the four
  questions worth answering; **code** wires whatever they are.
- **Why it is first:** every other item on this list, and any future roadmap, is
  currently argued from source code rather than behaviour.

### 2. The release contract's coverage field has drifted from the code

- **Status:** fact — A3, A4, A5.
- **Source:** `docs/V8-TRACEABILITY-LEDGER.json` reports 54 rows `missing` and 16
  `contradicted` out of 150. `V8-R-GRP-001` says `coverage: missing` while naming an
  implementation path that exists. `docs/V8-DECISIONS-2026-09-07.md` §5 names
  `V8-R-STO-014` and `V8-R-STO-015` as unimplemented mandatory security
  requirements, while `src/lib/media/reEncode.ts` (wired at
  `src/app/api/media/upload/route.ts:209`) and `src/lib/media/signedUrl.ts`
  implement exactly those two — and both files cite the requirement IDs in their
  own headers.
- **User impact:** indirect but serious. The contract is the release gate; a gate
  that misreports what is built cannot decide what ships.
- **Confidence:** High that the field is stale for the rows checked. **Medium** that
  all 54 are stale — six were verified, not fifty-four.
- **Effort:** Medium — a row-by-row re-audit.
- **Smallest useful action:** re-audit the 54 `missing` and 16 `contradicted` rows
  against the current candidate, correct `coverage` and `implementation_paths`, and
  add a `verified_against` commit SHA per row so the next reader can tell a stale
  row from a true gap. `scripts/check-release-contract.mjs` validates the enum only
  — it has no way to catch this, which is why it passes.
- **Owner:** **code** does the sweep; **founder** rules on any row where the code
  and the intent genuinely disagree.

### 3. The approved global composer is built and mounted nowhere

- **Status:** fact — A6.
- **Source:** `src/components/composer/GlobalComposer.tsx` (577 lines) plus five
  supporting files, 2,241 product lines in total, implementing `V8-R-CMP-001`
  through `V8-R-CMP-016`. Zero non-test importers; no `dynamic()` import; the
  user-facing string "Share a moment" (`ComposeStep.tsx:81,87`) appears nowhere else
  in the repository. It has a 1,289-line test file and six rounds of review history.
- **User impact:** sixteen approved requirements — every "share a moment" path
  across Feed, Story, Night Out and Group — are unreachable.
- **Confidence:** High that it is unmounted. **Unknown** whether it is unmounted
  deliberately (a staged rollout) or by omission.
- **Effort:** Medium — the component is finished; the work is an entry point, the
  publish wiring behind `PublishInput`/`PublishResult`, and e2e coverage.
- **Smallest useful action:** ask the founder the one question — is the composer
  V8 or V9? If V8, an e2e that opens it from the Social tab and publishes to one
  destination is the smallest proof it is real.
- **Owner:** **founder** first (this is a scope question, not a bug); then **code**.

### 4. No route-level error boundary anywhere, and the approved degraded state reaches only two surfaces

- **Status:** fact — A7.
- **Source:** `find src/app -name "error.tsx" -o -name "global-error.tsx"` returns
  zero files. `src/components/states/OperationalState.tsx` — which exists precisely
  to enforce `V8-R-OPS-001` and `V8-R-OPS-007` in one place — is imported only by
  `src/app/onboarding/page.tsx`, `src/app/settings/page.tsx`,
  `src/app/settings/preferences/page.tsx`, `src/app/settings/profile/page.tsx` and
  `src/app/settings/connections/blocked/page.tsx`. `V8-R-OPS-002` through
  `V8-R-OPS-006` name Next Bar?, Map, Rankings, Social and Camera — none of them.
- **User impact:** a render throw on any of the five main tabs produces Next's
  default error screen, which by definition does not name what is true and offers no
  recovery. This is the failure mode most likely to be seen by a first-time user on
  a flaky connection.
- **Confidence:** High. **Effort:** Low — one `error.tsx` per route segment
  rendering the existing `OperationalState` with a named message.
- **Smallest useful action:** add `error.tsx` to the five tab segments; one e2e that
  forces a throw on `/map` and asserts the named message plus a single recovery
  control.
- **Owner:** **code**.

### 5. The freshness guarantee is computed from placeholder dates

- **Status:** fact — A8, A9.
- **Source:** `src/lib/matching.ts:221` filters the candidate pool by
  `daysAgo(b.lastVerified, now) <= LAST_VERIFIED_HARD_FILTER_DAYS`, which is `365`
  (`src/lib/constants.ts:30`). `src/lib/bars.core.ts:11` defines
  `PLACEHOLDER_VERIFIED = '2026-04-01'` and uses it 38 times; the header of
  `src/lib/bars.ts` states plainly that these dates "are PLACEHOLDERS so all bars
  pass the … hard filter and the app remains functional", and that real curation "is
  tracked as PRD risk R4 and must happen before any public launch where the app
  makes factual claims about named businesses". Across the static catalog files the
  values are: 139× `2026-04-01`, 133× `2026-07-24`, 34× `2026-07-25`, 1× `2026-06-26`.
  Separately, `src/components/FreeTextSeed.tsx:88` stamps *today's* date on a bar the
  user typed in.
- **User impact:** the app tells people a bar is open, priced and vibed a certain
  way on the strength of a date chosen to satisfy a filter. It is the one place
  where the product's core promise and its data are furthest apart.
- **Confidence:** High for the static catalog. **Unknown** for the live `bars` table
  — `last_verified` is `not null` (`supabase/migrations/0019_bars_catalog.sql:38`)
  and this audit has no database access, so the live distribution is unread.
- **Effort:** Low for the code half, **High** for the curation half — which is the
  actual work, and is not a code task.
- **Smallest useful action (code):** one query against the staging ledger's `bars`
  table grouping `last_verified` by month; that single reading turns this from
  unknown into decidable. Then make the expiry loud rather than silent — today, a
  bar aging past 365 days simply stops appearing, with no operator signal.
  `src/lib/matching.test.ts:489` already pins the placeholder cohort's survival to a
  specific date, which shows the hazard was seen and deferred rather than closed.
- **Owner:** **founder** owns curation and the honesty of the claim; **code** owns
  making the expiry observable.
- **Related, weaker signal (inference):** `src/lib/catalog.ts`'s own SWAP-DAY
  CHECKLIST warns that non-reactive `getBarById` readers show stale bars after the
  catalog swap. `src/app/friends/_components/TonightPresence.tsx:105` follows the
  rule and calls `useBars()`; `src/app/friends/page.tsx:363` and
  `src/app/friends/_components/FeedSection.tsx:477,643` call `getBarById` without a
  subscription. Whether this is user-visible depends on load ordering, so it is an
  inference, not a defect claim — the cheap check is one e2e that renders a Feed post
  for a bar outside the 39-bar core set.

### 6. Nothing reports a production failure to the operator

- **Status:** fact — A10.
- **Source:** `package.json` carries no error-monitoring client. The catalog's
  degraded path (`src/components/CatalogRefresh.tsx`) reports itself only as
  on-screen text — "Catalog refresh unavailable — showing the emergency set." When
  that fires, the app silently narrows from the full catalog to the 39-bar
  `bars.core.ts` emergency set, and no one outside that browser knows.
- **User impact:** a user in the degraded state gets a near-empty recommender that
  still looks like it is working. There is no path by which the operator learns.
- **Confidence:** High. **Effort:** Low for a first signal.
- **Smallest useful action:** the analytics route from item 1 already exists,
  already rate-limits, and already has a service-role writer — one additional
  event name for "catalog fallback" reuses all of it and needs no new vendor.
- **Owner:** **code**; **founder** decides if a third-party monitor is wanted
  instead.

### 7. Two release-critical checks are not in CI, and there is no linter

- **Status:** fact — A11.
- **Source:** `.github/workflows/ci.yml` runs type-check, Vitest and the production
  build, and honestly states it is not the full gate. `npm run check:contract` and
  `npm run check:catalog-bundle` appear in no workflow; `check:catalog-bundle` is
  referenced only by `package.json:20`. That second one is the guard that keeps the
  584 KB Places sidecar out of the client bundle — the exact regression that blocked
  every deploy on 2026-07-24 (`src/lib/catalog.slim.ts:11-25`). There is no ESLint
  config and no `eslint` dependency.
- **User impact:** a contract-digest drift or a bundle-size regression reaches `main`
  without anything objecting.
- **Confidence:** High. **Effort:** Low — both are existing npm scripts;
  `check:catalog-bundle` needs the build step it already follows in CI.
- **Smallest useful action:** add both to the existing `gates` job. A linter is a
  separate, larger decision — name it, do not bundle it.
- **Owner:** **code**.

### 8. Accessibility is four hand-written checks, not a rule sweep

- **Status:** fact — A12.
- **Source:** `e2e/a11y-mobile.spec.ts` audits 44px targets and text scaling to 200%
  across the five tabs; reduced motion is asserted in
  `e2e/native-shell-contract.spec.ts` and palette contrast in
  `src/lib/paletteContrast.test.ts`. No axe-core or equivalent is a dependency.
- **User impact:** unlabelled controls, wrong roles, broken heading order and
  contrast failures on *dynamic* content are unchecked. The four criteria that are
  covered are covered well and on both viewports; the rest is uncovered.
- **Confidence:** High on the gap. **Unknown** how many real violations exist — that
  is what the sweep would answer.
- **Effort:** Low to get a first reading; unknown to fix what it finds.
- **Smallest useful action:** run a rule engine once against the five tab routes and
  triage the output before deciding whether to gate on it. Do not add a gate that
  fails on day one.
- **Owner:** **code**.

### 9. There is no reason or mechanism to come back

- **Status:** fact — A13, A14.
- **Source:** `src/lib/push.ts` implements a weekly Thursday–Saturday "Time for your
  Next Bar" nudge with a cadence gate (`src/lib/cadence.ts`) and a documented dark
  ship. `subscribeToPush` (line 60) has zero callers; the only importer of the module
  is `src/app/settings/_signOut.ts:3`, the cleanup path. Independently,
  `public/sw.js:8` pre-caches `['/', '/quiz', '/where-next', '/tried',
  '/manifest.webmanifest']` — a route list that predates the current five-tab shell
  and contains none of `/map`, `/rankings`, `/friends`, `/settings`.
- **User impact:** nothing brings a user back, and the offline fallback covers routes
  the navigation no longer points at.
- **Confidence:** High on the mechanism. **Unknown** whether repeat use is actually
  weak — that is item 1's job to answer, and it is why this sits ninth rather than
  third despite being the classic retention gap.
- **Effort:** Low for the service-worker route list; Medium for push (VAPID keys and
  migration `0009` are named as prerequisites in `src/lib/push.ts:8-9`).
- **Smallest useful action:** correct `SHELL_URLS` to the five real tabs now — it is
  a one-line honesty fix. Defer push until item 1 shows whether return visits are the
  problem.
- **Owner:** **code** for the shell list; **founder** for push, after evidence.

### 10. Provider cost is metered in the browser and reported nowhere

- **Status:** fact, with one unknown — A15, A16.
- **Source:** `src/lib/placesUiKit.ts` is a careful piece of work: one seam for the
  Google SDK, a fail-closed key check, a documented billing model (Places UI Kit
  Query, one event per component request, 10,000/month free then $1.00/1,000), a
  `requested` meter that records *that* a request was made and never what came back,
  and a runtime kill flag (`/api/flags`). `docs/GOOGLE-MEDIA-RUNBOOK.md:31-32`
  documents the Google Cloud SKU quota cap as the immediate hard spending stop and a
  billing budget plus alert as the backstop. The gap: `billableEventCount()` and
  `billableEventCountForSurface()` are exported and consumed only by
  `src/components/GooglePlacePhoto.tsx` and tests — the number never leaves the
  browser.
- **User impact:** when the quota cap fires, photos degrade to a glyph. That is the
  designed behaviour and it is honest; the problem is that the operator's first
  signal is the degradation itself.
- **Confidence:** High on the code. **Unknown** whether the SKU quota cap and billing
  alert are actually configured in the Google Cloud console — a console fact this
  audit cannot read, and the operator has separately reported a Google account reset.
- **Effort:** Low.
- **Smallest useful action (founder, first):** confirm the SKU quota cap and billing
  alert are set on the current browser key. That is the whole spending control and it
  costs one console check. **Then (code):** emit the existing per-surface count via
  the item-1 route so there is a first-party number.
- **Owner:** **founder** for the console; **code** for the telemetry.

---

## 6. What NOT to build yet

**No new user-facing features.** Not because none would help, but because the
product cannot currently tell whether any of them would — item 1 is the reason, and
building on top of it would be guessing dressed as a roadmap.

Specifically deferred, with the missing evidence named:

| Not now | Missing evidence |
|---|---|
| Badges and the Persona card (`src/lib/badges.ts`, 154 lines, already written) | Explicit V9 deferral (`D-C-24`, founder, 2026-08-23). No evidence anyone wants them; no engagement data exists to test the premise |
| Automatic ranking-event Feed rows | Deferred (`D-C-35`). No data on whether the Feed is read at all |
| Native Photos-library export | Deferred unconditionally (`D-C-19`). No request evidence |
| Web push | Item 9 — build only if item 1 shows return visits are the weak link |
| Any ranker or matching change | The offline evals (`src/lib/__evals__/`) already constrain this, and the `v8-recommendations` lane is actively writing `matching.ts`, `ResultsView.tsx` and `WhereNextFlow.tsx` for `V8-R-NXT-008`/`009`. Two writers on one file is how both changes get lost |
| Replacing the approved map, the Places UI Kit photo flow, routing, or numeric ratings | All four are founder-approved and working. Nothing in this audit argues against any of them |
| A whole-codebase rewrite | Explicitly out of scope (`docs/V8-PRD-DELTA-2026-09-07.md`, "V9 and release boundary") |

Also not recommended: adding a linter and gating on it in the same change (item 7),
or gating CI on an accessibility rule engine before its output has been triaged
(item 8). Both would turn a useful signal into a blocked pipeline on day one.

---

## 7. Next validation

**The single cheapest action that reduces the largest uncertainty:** wire
`trackEvent` at two call sites, enable both analytics flags on staging, and read one
week of the four counters.

Everything the product needs to do this already exists and has already been
security-reviewed — the route, migration `0018`, the service-role writer, the rate
limiter, the night-key bucketing and the privacy model. The work is call sites and
two flags. Until it is done, this document's ranking, and any roadmap built after
it, remains a reading of the codebase rather than a reading of the product.

**Second:** the founder console check in item 10. One look, and the only real
spending control is either confirmed or found missing.
