# Distance implementation — local pilot, 2026-09-06

Base: `release/v8-ship` at `fac12ac`, uncommitted candidate. Scope authorization: owner's "codeit now pleas" following implementation plan 0.2. No deploy, migration, provider activation or upload.

## Implemented

- One origin for result cards and private walking/driving Maps links; manual seed selection no longer loses to GPS. Public share links remain origin-free.
- Openrouteservice matrix integration: explicit one-source destinations, seconds/meters, batches of five, at most 15 primary and five secondary elements, no retries. Catalog IDs resolve server-side; client-provided destination coordinates are not trusted. Client rejects a catalog-coordinate mismatch.
- Existing cards show walking time/distance and a smaller driving line. Non-routed Map/Friends labels now say straight-line miles, never fabricated minutes. Detail-view directions preserve the result origin and mode.
- Walkable uses raw seconds <=900; 901 displays as 16 minutes. Longer confirmed walks supplement five under "A little farther away". Missing routes remain unavailable; earlier confirmed routes survive a later failed lookup.
- Closest candidate preselection, inclusive broader modes, no silent mode widening or forced exclusion when changing chips. Learned-taste formulas unchanged; final relevance/proximity balancing remains outstanding.
- Explicit routing disclosure/consent; same-search in-flight deduplication, obsolete-response rejection, two-minute display expiry, no persistent location cache. Server disabled by default; Vercel production explicitly refused. Known input IDs/coordinates, byte limit, origin check, request timeout and bounded warm-instance/IP rate limiting.

## Verification

- `npm run typecheck`: exit 0 after the correction.
- Focused Vitest command: `npm test -- src/lib/travelTime.test.ts src/lib/routeSearch.test.ts src/app/api/travel/route.test.ts src/hooks/useTravelRoutes.test.tsx src/lib/matching.test.ts src/lib/share.test.ts --maxWorkers=1 --no-file-parallelism`: exit 0, 76 passed, six files.
- First production-build browser subset: exit 1, two passed/two failed. Test fixture supplied eight rows, below the existing catalog validator's 100-row minimum; routing mock then encountered emergency-catalog IDs. Corrected to a valid 100-row fixture with a positive rendered-catalog readiness assertion; no production validator weakened.
- Corrected production-build browser subset: `npm run test:e2e -- e2e/distance-routes.spec.ts e2e/home-location-first.spec.ts e2e/photo-card.spec.ts e2e/distance-open-now.spec.ts`: exit 0, 26 passed, zero failed/skipped, both iPhone 13 and Pixel 7, zero retries. Production build completed as part of the wrapper. No full release-gate claim.
- `git diff --check`: exit 0. The lease was released after evidence recording; no long-running test process left by this task.

Candidate binding: aggregate SHA-256 `f5204f3b6ca3b2081031c73245c3c45665b8dde65090c319476dba124ee58801`. Algorithm: sort the following paths lexically; SHA-256 each UTF-8 file after CRLF-to-LF normalization; join `path + NUL + fileHash` records with LF and SHA-256 that string. No trailing LF in the joined string. These are the 19 tested implementation/config/test files; earlier unrelated V8 test edits and these documentation artifacts are excluded.

```text
.env.example
e2e/distance-open-now.spec.ts
e2e/distance-routes.spec.ts
e2e/home-location-first.spec.ts
e2e/photo-card.spec.ts
src/app/api/travel/route.test.ts
src/app/api/travel/route.ts
src/app/privacy/page.tsx
src/components/BarLightbox.tsx
src/components/ResultCard.tsx
src/components/ResultsView.tsx
src/components/WhereNextFlow.tsx
src/hooks/useTravelRoutes.test.tsx
src/hooks/useTravelRoutes.ts
src/lib/constants.ts
src/lib/routeSearch.test.ts
src/lib/routeSearch.ts
src/lib/travelTime.test.ts
src/lib/travelTime.ts
```

No real routing-provider response has been measured. Tests intercept route/provider responses; they prove integration behavior, not NYC travel-time accuracy.

## Remaining before live use / release

1. Approve/configure provider access, current terms/retention, attribution and hard account/distributed usage limits. The in-memory limit is per warm server instance, not global across a deployment. Production lock must remain until these controls and route validation pass.
2. Run the public NYC route comparison from the plan and the Break Bar trip if the owner supplies its origin. Record accuracy, snapping behavior, route-element usage, latency and missed closer candidates against the larger reference pool. Set measured acceptance tolerances.
3. Validate coarse/stale origin UX, movement/recalculation, both modes and enlarged-text layout. The current origin is a captured starting point, not continuously refreshed GPS. No wheelchair-accessibility guarantee.
4. Finish the agreed recommendation stage: measured proximity/relevance balance, driving threshold, sparse tags and shown-history effects. This pilot prioritizes proximity, not a newly validated fun-bar model.
5. Run all three gates on the integrated candidate. Carry the prior unrelated browser failure and frozen-ledger digest issue from `V8-TEST-REPAIR-2026-09-06.md`; earlier green Vitest does not certify this newer candidate. A passing subset is not a green release gate.

## Continuation — 2026-09-07

Same worktree, branch and HEAD; existing uncommitted work preserved. Continued under
the existing distance goal `01a06dc8-f41c-79f0-a511-78824ebe50c5`.

- Fixed response reuse extending route freshness when returning to a prior origin.
  The response now carries its original expiry; only explicit recalculation starts
  a new lifetime. Regression cases returning after 60 and 120 seconds both failed
  before the fix and pass afterward (five hook checks total).
- Browser coverage now exercises expiry without automatic requests, explicit
  recalculation, matching directions, and 100%/200% text on both phone projects.
  The first production-build subset passed all six cases. Added approximate-GPS
  coverage afterward to assert the disclosed Chelsea centroid is used in both
  the route request and Maps link. All eight distance cases passed in the full
  browser run, including approximate origin and enlarged text on both phones.
- Typecheck passed again with the approximate-GPS test included. Full Vitest:
  `npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot`, exit 0;
  193 files passed, one skipped; 3077 tests passed, seven opt-in skips; 467.16 seconds.
  Log: `D:\Temp\next-bar-vitest-20260907.log`.
- Full production-build browser gate: `npm run test:e2e`, exit 1; 710 passed,
  six failed, two skipped, 10.3 minutes, both phone projects, three workers,
  zero retries. Log: `D:\Temp\next-bar-full-e2e-20260907.log`.
  The release gate is NOT green. No independent DB work ran alongside it.
- Two failures are `vibe-tweak-ranking.spec.ts:183`, one on each phone: applying
  the vibe still leaves StEight(behind KUNIYA HAIR) first with `Vibe match 0/1`.
  `ResultsView.tsx` sorts the output of `matches` by exact miles and uses those
  candidates for unrouted cards, overriding the matcher's explicit-vibe order.
  This is the distance pilot's unresolved recommendation precedence, not an
  expiry failure; no ranking weight or test assertion was changed to hide it.
- Four iPhone failures are `venue-tags.spec.ts:89`, `:110`, and the two `:194`
  viewport cases. The first result's StEight lightbox has no displayed tags;
  assertions requiring tags fail or time out waiting for that section. Pixel
  counterparts passed. The tests choose the first recommendation without a
  fixed tagged-venue fixture. This is not evidence of an overflow defect.
  Screenshots, error contexts and traces remain in `test-results/`.
- The previously failing home resting-position coverage check passed on both
  phones this run. No readiness fix was made; one passing run does not resolve
  the previously documented catalog-loading race.
- `check:contract` still fails the same two validator digests recorded in
  `V8-TEST-REPAIR-2026-09-06.md`. No frozen approval record was changed.
- Local/staging configuration and session contain no `ORS_API_KEY`; routing remains
  disabled. No provider call, deployment, migration, or TestFlight upload was made.

Integrated candidate binding: HEAD `fac12ac84f310580aea26f6e9ddc13ba971ebc10` plus
the 19 implementation files listed above and the four V8 test-repair files
(`src/lib/effectiveMigration.ts`, `src/lib/effectiveMigration.body.test.ts`,
`src/lib/storiesRls.live.test.ts`, `src/lib/nightOutsRls.live.test.ts`). Using the
same LF-normalized aggregate algorithm above, these 23 files hash to
`4c64e7321a584b8954e62e145f0de36df13d8d2a15e6eb45a0de5fdd36f12897`.

## Hosted routing connected — 2026-09-07

The owner saved `ORS_API_KEY` in the EXISTING release worktree `.env.local` and
confirmed it was saved. Verified one non-placeholder entry and staging project
`wqxovhiovgcijmfzxgby`, without printing the key. No env file was created or
modified by this activation. `NEXT_BAR_ROUTING_ENABLED=true` was set only in the
local preview process environment; the existing env file's flag remains off.

- ORS returned HTTP 200 for walking and driving matrices from a public Times
  Square sample to three public NYC sample points. Two provider requests.
- The real app endpoint then returned complete walking and driving results for
  five actual staging catalog bars, with exact destination identity checks.
  Two app searches made four provider requests: six provider requests total,
  within the announced eight-request ceiling, with no provider retries.
- Public Times Square sample to Manhattan Break Bar: walking 928.82 seconds /
  1290.05 meters (display 16 minutes, correctly outside Walkable); driving
  190.26 seconds / 1311.32 meters. Break Bar & Billiards is a separate catalog
  destination, not the Manhattan Break Bar. This is not the owner's original trip.
- Missing routing consent was refused. The initial local check found the
  numeric host `127.0.0.1` receives 403 because this Next dev server constructs
  the request origin as `localhost`. Using `http://localhost:3107` for BOTH
  page and requests passes the origin check. No origin guard was weakened.
  Verify canonical hostname behavior separately before staging deployment.
- Preview remains running at `http://localhost:3107`, exec session `66203`,
  launched with `$env:NEXT_BAR_ROUTING_ENABLED = 'true'; npm run dev -- --hostname
  127.0.0.1 --port 3107`. Stop this preview before another build/test server uses
  the same worktree. Restarting without the process flag disables routing again.
- Receipts (public samples only, no keys):
  `D:\Temp\next-bar-routing-live-20260907.json` and
  `D:\Temp\next-bar-routing-app-live-20260907.json`.

This proves live integration, not real-world ETA accuracy or production
readiness. Comparisons against identical Maps inputs, production usage controls,
and the recorded tag/vibe and release-contract failures remain open. No product
code, database schema, production deployment, or TestFlight build changed.

## Localhost consent labels and vibe ordering repaired — 2026-09-07

The owner reported every card showing unavailable times on localhost. The
running server returned `enabled: true`; its request log showed page capability
GETs but no route POST from that UI session. Calculation requires the existing
`Calculate travel times` consent button above the cards. The browser connector
had no connected browser, so the owner's exact banner was not inspected.
Before consent, cards now say `Walk time — calculate above` / `Drive time —
calculate above`; actual failures and disabled routing still say unavailable.
No consent was bypassed, and no new provider request was made during this slice.

Two downstream sorts had erased matcher preference: ResultsView sorted the
entire matcher output by exact miles, and routeSearch sorted confirmed routes
by duration. ResultsView now selects the nearest 15 IDs but retains the existing
matcher order within that pool. Routing preserves this preference among
eligible routes. Walkable still requires raw duration <=900 seconds; farther
supplements follow eligible routes and sort by duration. Existing learned-taste
weights and applied-vibe semantics are reused, with no new driving threshold.

Venue-tag layout tests now consistently use the full mocked catalog and open a
recommended venue whose displayable tags are known. Untagged venues still omit
the section; no catalog tags were invented or enriched. A read-only staging
lookup confirmed the owner's named sample venues have tags, which is separate
from whether those tags overlap the selected vibe.

Validation on the combined candidate:

- `npm run typecheck`: passed.
- Focused route, expiry, explicit-vibe, tag and candidate-selection checks:
  41 passed. The new ResultsView regression checks both changed preference
  and exclusion of a matching venue outside the nearest 15.
- Full Vitest: **3078 passed, 7 skipped**, 194 files passed / 1 skipped,
  450.76 seconds. Serialized workers with the existing staging CA certificate.
  Log: `D:/Temp/next-bar-vitest-vibe-20260907.log`.
- Full `npm run test:e2e`: **716 passed, 2 skipped, zero failures**, 9.4 minutes,
  production build, iPhone 13 and Pixel 7, three workers, zero retries.
  All six formerly failing tag/vibe cases and all eight distance-route cases
  passed. Existing skips are the `/friends` overscroll case on both projects.
  Log: `D:/Temp/next-bar-e2e-vibe-20260907.log`; report in `playwright-report/`;
  `.last-run.json` reports passed with no failed tests.
- `git diff --check`: passed. `check:contract` still fails the same two
  validator/validator_test `DIGEST_DRIFT` findings; no frozen record changed.

Candidate: HEAD `fac12ac84f310580aea26f6e9ddc13ba971ebc10`, previous 23 files
plus `e2e/venue-tags.spec.ts` and `src/components/ResultsView.routing.test.tsx`.
The 25-file LF-normalized aggregate is
`32d7ff52c44e545994d1b69304e559cf329a015b4e0f4b74c42e124a2bbe9e37`.

Preview restarted at **http://localhost:3107**, exec session `89749`, with
`NEXT_BAR_ROUTING_ENABLED=true` only in the preview process. No env file was
created or changed. Refresh the page and press `Calculate travel times` above
the recommendations. Stop this preview before another build in this worktree.

The app test gate is green; production routing readiness is still unapproved.
The existing release-contract drift and previously documented provider quality,
quota/terms and canonical-host checks remain before rollout. No production
deployment, migration, TestFlight upload, or new model/provider call occurred.

## Automatic routes, broader distance choices and photo diagnosis — 2026-09-07

The owner requested automatic calculation, reported identical choices in all
three distance modes, and asked why lightbox photos were missing. This section
supersedes the separate routing-consent click described above.

- Routes now calculate automatically after a starting point is resolved and
  whenever routing inputs change. The browser location/picked-origin flow is
  retained. The hook and endpoint no longer send/require a separate `consent`
  boolean. Same-input renders and StrictMode reuse the pending request; the
  original 120-second estimate lifetime is retained. There is no expiry polling
  or automatic provider retry; error/stale recovery remains explicit.
  Privacy copy and the results disclosure describe automatic routing.
- Walkable keeps the nearest-15 candidate shortlist and the raw <=900-second
  route requirement. Cab ranks matches across the existing four-mile
  straight-line search area; Anywhere ranks across the full service catalog.
  Both broader modes retain nearby eligibility and route at most 15 candidates.
  The existing taste and applied-vibe scoring formulas are reused across those
  broader pools; exact miles still break ties. Good results can overlap between
  modes. The optional owner question about exclusive farther-only results had
  no reply; proceeded with the stated inclusive assumption.
- The matcher defaults to its previous distance-band behavior. Quiz results
  explicitly retain their nearby shortlist (`nearbyFirst`), because that
  surface has no distance selection. This avoids silently treating the quiz's
  historical `maxMiles=null` as an explicit Anywhere choice.
- Photo diagnosis: both worktrees contain 3,435 local photo files. Staging lists
  Smithfield Hall with one photo and Barcade/Chelsea with three; the local
  Smithfield and Chelsea Barcade WebP URLs returned HTTP 200/image-webp.
  Lulla NYC, Hello Hello Bar & Cafe and Crompton Ale House have `photo_count=0`
  and no corresponding local image files. They have Google place IDs, but this
  checkout has no Google Maps browser API key and live Google media is off;
  the existing legacy-photo setting is on. No credentials were printed.
  Lightboxes now explain loading/missing photos instead of silently omitting
  the section. No new photos were sourced and no Google integration was enabled.
  Asked the owner where an existing browser key is configured; no reply yet.

Verification and one evidence-driven correction:

- Initial focused checks: 39 passed; typecheck passed. Initial full Vitest:
  3080 passed / 7 skipped, 443.14s (`D:/Temp/next-bar-vitest-auto-20260907.log`).
- The first browser run exposed an old assertion requiring identical distance
  batches and the quiz-default regression. Stopped that run after 218 passed,
  2 failed, 1 skipped rather than completing a known-red candidate. Log:
  `D:/Temp/next-bar-e2e-auto-20260907.log`.
- One correction preserved the quiz's nearby default and changed the distance
  test to verify a wider cab batch, its four-mile boundary, the full-area mode,
  and restoration of the Walkable batch. Focused candidate checks: 2 passed.
- **Final typecheck and full Vitest passed: 3080 passed / 7 skipped, 194 files
  passed / 1 skipped, 443.27s.** Log:
  `D:/Temp/next-bar-vitest-auto-final-20260907.log`.
- **Final full production browser run: 716 passed / 2 skipped / zero failures,
  9.5 minutes, both phones, three workers, zero retries.** Automatic routing,
  expiry, directions, precision/text-size cases, distance selectors, quiz,
  lightbox and tag/vibe checks pass. Existing skips are `/friends` overscroll
  on each phone. Log: `D:/Temp/next-bar-e2e-auto-final-20260907.log`.
  `test-results/.last-run.json` is passed with no failed tests.
- `git diff --check` passed. The two existing release-contract validator hash
  mismatches remain (`D:/Temp/next-bar-contract-auto-20260907.log`).

Final candidate: HEAD `fac12ac84f310580aea26f6e9ddc13ba971ebc10`, previous 25
files plus `src/lib/matching.ts`, `src/components/BarLightbox.googlePhoto.test.tsx`
and `src/app/quiz/page.tsx`. The 28-file LF-normalized aggregate is
`e7cba04fe49c318b9f2abf0049878c3c850516f86040fc06d486137b430dadd0`.

Preview restarted at **http://localhost:3107**, exec session **72981**, routing
enabled only in the preview process; refresh the page to load the final code.
No env file was created or changed. No scripted ORS/Google provider test was
run in this slice; the owner's preview did record successful app route POSTs.
No production deployment, migration or TestFlight upload occurred. Populating
the missing photo assets/live source, production routing readiness and the
existing release-contract drift remain unresolved.

## Provider contract references

Request structure and seconds/meters checked against the [official matrix documentation](https://giscience.github.io/openrouteservice/api-reference/endpoints/matrix/). Private directions parameters checked against [Google Maps URLs documentation](https://developers.google.com/maps/documentation/urls/get-started). No paid API call or user-origin disclosure occurred during this implementation.

## Shorter routing copy and CARTO replacement — 2026-09-07

Owner requested less routing disclosure, removal of the CARTO API-key watermark,
and another investigation of missing lightbox photos. This slice:

- Changes the normal precise-location label to “Near you”. Moves route scope,
  estimation limits, automatic-location-use explanation and bounded search count
  into a native, initially closed “About travel times” disclosure below results.
  Keeps routing attribution visible outside the disclosure and actionable
  loading, error, expiry and incomplete-result messages above the cards.
- Replaces the shared Leaflet CARTO source with
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with linked OSM attribution,
  maximum tile zoom 19 and grayscale/inversion to retain a dark basemap.
  This replaces the provider; it does not conceal CARTO's watermark.
- Adds one shared browser-test fixture that fulfills OSM tiles locally and
  mechanically updates 39 Playwright imports, including the existing catalog
  fixture. Context-level interception covers extra pages too. No new dependency
  or test-only application setting. Map tests assert the actual OSM tile URL,
  loaded tile element and visible credit; routing tests exercise the disclosure
  at both text sizes and retain mode-scope assertions.
- Found no bundled PMTiles, MBTiles or PBF street basemap in either checkout's
  public directory. `scripts/census/tiles.ts` defines venue-ingestion search
  regions, not offline map imagery. The replacement remains an online basemap.
- Photo evidence remains as recorded above: Smithfield Hall and Barcade have
  cached files; Lulla, Hello Hello and Crompton have zero stored photos. Live
  Google media and its browser key are absent locally. Asked which venue the
  owner is opening; no response yet. No new photo content or credential was
  created, and this slice makes no claim to have fixed missing photo content.
- Read-only Vercel inspection found the existing project linked and all three
  Google media setting names present in Production. The individual environment
  GET endpoints returned `decrypted: false` with no `value` for the browser key
  and both flags. Therefore their configured values and activation could not be
  verified or copied. No Vercel settings changed. A temporary helper outside the
  repository inspected only these names and booleans; its guarded apply mode was
  never run. The existing Google browser key remains the needed local input.

References: [CARTO key requirement](https://carto.com/basemaps/apikey/),
[CARTO terms](https://carto.com/legal/basemap-terms/),
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/),
[ORS published attribution terms](https://staging.openrouteservice.org/terms-of-service/).
Public OSM tiles are best-effort interactive browsing infrastructure; offline
downloads and automated pan/zoom traffic are not enabled by this change.

Final typecheck passed; full Vitest passed with
3080 tests passed / 7 skipped, 194 files passed / 1 skipped, 446.71s. Log:
`D:/Temp/next-bar-vitest-maps-copy-20260907.log`.
Full production-build Playwright passed: 716 passed / 2 existing skips / zero
failures, 9.6 minutes, both phones, three workers and zero retries. Log:
`D:/Temp/next-bar-e2e-maps-copy-20260907.log`. The two skips are the existing
friends overscroll case on each phone. `test-results/.last-run.json` is passed
with no failed tests. `git diff --check` passed. Map imagery is mocked in this
gate; it verifies the real component URL/loading/attribution and interactions,
not the public tile service's availability. Live Google photos remain untested
and unconfigured locally; the suite uses the existing media policy and mocks.
Release-contract check still fails
the same two existing `DIGEST_DRIFT` findings; log:
`D:/Temp/next-bar-contract-maps-copy-20260907.log`.
No env file was created or changed in this slice.

Final combined candidate: HEAD `fac12ac84f310580aea26f6e9ddc13ba971ebc10`,
67 dirty non-doc files, LF-normalized aggregate
`4ed549533738796544eddbb64705d4cefa71dd2077bfb30f75e890695056ea00`.
The additional browser spec edits are the shared tile fixture imports plus
focused map/disclosure/location-copy assertions; no unrelated test behavior
was changed. Preview restored at **http://localhost:3107**, exec session
**70546**, with routing enabled only in the process. Temporary Vercel inspection
helpers were removed. No deployment, migration, TestFlight upload or cloud
environment mutation occurred. Existing release-contract drift and restoring
the Google browser key remain unresolved.
