# Next Bar distance correction — implementation plan 0.2

Status: revised at the owner's request on 2026-09-06; proposed execution defaults below are not yet a frozen implementation contract.
Companion requirement ledger: `DISTANCE-PLAN-2026-09-06.json`.
Base inspected: `release/v8-ship` at `fac12ac`.
Existing goal: `01a06dc8-f41c-79f0-a511-78824ebe50c5`; reuse it, do not create a competing distance goal.

## Implementation authorization and current boundary

The owner's subsequent instruction, **"codeit now pleas"** (2026-09-06, this thread), authorizes the local implementation of the presented distance correction, including the existing-card treatment, raw 15-minute walking cutoff, bounded candidate checks and separately labeled farther supplements. This supersedes the local-code pause in this draft, not the live-provider, production or release approval boundary. No new implementation goal was created.

Implementation now lives in `travelTime.ts`, `routeSearch.ts`, `/api/travel`, `useTravelRoutes.ts`, ResultsView and the existing cards. The driver has selected the proposed openrouteservice integration for local development; credentials have not been configured or exercised. The endpoint is off without explicit environment activation and refuses Vercel production. Its warm-instance/IP limit is not a distributed/account-level spending guarantee. That limitation blocks production activation.

This is the distance-first pilot, not a completed release or validated relevance algorithm. Local proximity selects up to 15 candidates; confirmed primary route duration orders returned candidates. The existing learned-taste formulas are unchanged, but effective result ordering changes to proximity-first; taste does not currently outrank route duration. A finalized proximity/taste balance and a timed driving eligibility threshold remain later decisions. Cab currently selects the driving profile without excluding nearby venues; Anywhere includes nearby venues and has no upper-distance filter. Neither claims a 20-minute driving cutoff.

Provider disclosure is a separate user action before the first route request for a starting point. In-flight work is reused within the active view; route estimates expire from display after two minutes and require an explicit recalculation. There is no persistent route cache, automatic retry, precise-location history or live-traffic claim. This provisional display lifetime is not evidence of provider cache permission or measured route accuracy. See `DISTANCE-IMPLEMENTATION-2026-09-06.md` for candidate evidence and remaining acceptance work.

## Owner decisions and scope

- Distance/origin correctness first; evaluate recommendation matching afterward.
- Reuse the existing ResultCard. Add a smaller driving time/distance line beneath the walking line; no card redesign.
- Walkable means an estimated walking route of at most 15 minutes, not 1.5 straight-line miles.
- The owner wants at least five options. This is not permission to mislabel longer walks or fabricate results.
- Correct this implementation plan, then implement and validate distance, then improve recommendation ordering, then finish V8 release checks. Unrelated test repairs must not displace distance implementation again. No production deployment, migration, upload, paid API activation, or new coordinate disclosure is authorized by this document.

User source: the current thread's card-reuse request, "I always want at least 5 options", and "first our distance mapping plans ... second ... fix v8 tests".
The owner's subsequent clarification ("Are we supposed to be coding the proper distance plan") supersedes refinement 0.1's test-first execution order. The latest request authorizes correcting this plan; it does not select a provider or approve production activation. The recommendations and unresolved choices below are not silently stamped approved.

## Evidence and the contract change needed

`src/lib/travelTime.ts` multiplies straight-line miles by fixed walking/driving rates. `matching.ts` uses 1.5/4-mile bands and lets explicit vibe matches expand beyond the selected band. `WhereNextFlow.tsx` also auto-widens empty searches and uses exclusive rings for cab/anywhere. These are separate behaviors, not one multiplier defect.

`useGeolocation.ts` can substitute a neighborhood centroid for coarse GPS. The manual flow can say "From [bar]" while using GPS. ResultCard and BarLightbox build Maps search links without pinning the calculation origin or travel mode. Map and Friends also call the old travel helper.

The owner reports Break Bar at 14 minutes here versus 22 in Maps. The live catalog read in this thread found Manhattan Break Bar at 458 9th Ave with only the `pub` tag. The exact trip is NOT reproduced: origin, location mode, and reference screenshot remain unknown. Sparse tagging is evidence of limited inputs, not proof of the reported ranking cause.

The old P1 contract in `V8-PRD-2026-08-13.md` mandates the current distance bands and taste-first within-band ordering. This draft identifies the intended replacement but does not rewrite the frozen PRD, ledger digests, or already-completed goals. Freeze a versioned delta after the open decisions are resolved.

## Proposed end-to-end behavior

1. Resolve one origin, its source, accuracy, and timestamp. Label GPS, selected bar, and approximate neighborhood honestly. Never certify "from you" using a neighborhood centroid.
2. Form a deterministic, proximity-aware candidate order locally, respecting existing open/closed and visited-bar rules. Do not retune taste weights in this phase.
3. Route an initial batch of five in the selected mode; check replacements in bounded batches. Compare this strategy with a larger routed reference pool before fixing the total cap. Five passing candidates are not proof of the five closest candidates.
4. Evaluate Walkable against the raw walking duration <= 900 seconds, before rounding. Keep longer walks out of the Walkable classification even when a vibe matches.
5. Show five valid options when available. Recommended resolution of the count/radius conflict: a clearly separate "A little farther away" group, with route times, if fewer than five qualify. This fallback still needs an explicit owner decision versus tap-to-expand. Under provider failure, insufficient catalog, or exhausted search budget, report the real limitation; never invent five results or claim the search was exhaustive.
6. Calculate the secondary travel mode for the final displayed bars. Both modes use the same origin and destination identity but may follow different routes. Label driving time as Drive, not Uber pickup time/fare.
7. Keep the current card and actions. Walking remains the primary line; driving is smaller underneath. Offer explicit walking/driving directions from the same origin. No auto-navigation or booking.
8. Anywhere should include nearby bars rather than mean "only distant bars". Driving eligibility threshold and final proximity/taste ordering need approval; 20 minutes driving and 0–10/10–15-minute walking groups are proposals only.

## Loading, caching, failure, and trust

- Model calculating, available, unavailable/unreachable, stale, and approximate-origin states distinctly. Do not show an unverified Walkable claim during loading.
- A new origin/search invalidates pending results; late responses must not overwrite the current search. Do not reorder cards under a tap as secondary driving results arrive.
- Share in-flight work within a search. Reuse route results only where provider rules permit, keyed by origin, destination identity/coordinates, mode, and relevant departure time/options. No coarse location-cell cache initially.
- Walking and traffic-sensitive driving need different freshness policies. Exact TTLs and movement rules must be selected with the provider and validated near the 15-minute boundary. No indefinite cache or failed-response cache masquerading as a route.
- Session-level reuse first, if permitted. No persistent precise-location history, cross-user location cache, or exact-coordinate telemetry. Review application, proxy, and provider logging and retention before activation.
- A backend request accepts validated coordinates and bounded known catalog IDs, not arbitrary URLs/destinations. Enforce per-user/session and global limits; cache is not an abuse/spending control. Keep provider secrets server-side.
- Provider outage/quota/timeout must yield honest unavailability, not the old straight-line minutes. Disabling the feature must preserve that honesty. Existing map/friends/lightbox callers must not contradict route-based results; non-routed surfaces may show neighborhood or explicitly straight-line distance.
- Routing is an estimate, not a guarantee of arrival time, accessibility, or a safe pedestrian route. Keep provider warnings/attribution and an external-directions fallback. Do not call an ordinary foot route wheelchair-accessible.

## Proposed defaults and the activation boundary

Make one bounded proposal, not an open-ended provider study. Propose hosted openrouteservice as the first walking/driving integration to validate, using ordinary HTTP fetch and the existing test tools. This is a candidate, not a claim that current commercial terms, quotas, retention or route quality have passed review. Confirm those before external calls; if it fails the stated requirements, report the evidence and replacement decision instead of silently adding another provider.

For the first local implementation, propose five primary-mode candidates per batch, at most three batches, then secondary-mode routes for up to five displayed bars: at most 20 origin/destination/mode elements per search. This is a testable engineering ceiling, not an approved bill or proof of the nearest five. Stop at the cap, expose a limited-search state when relevant, and compare against a larger public-origin reference pool in the attended provider check. Mode changes and repeated searches also need session/global enforcement; a per-search cap alone does not bound spending.

Recommend automatically filling missing Walkable slots under a separate **A little farther away** heading. Preserve five choices when suitable routable bars can be found within the bounded search; never describe the supplement as Walkable. Do not add tap-to-expand as a second implementation variant unless the owner chooses it.

Provider credentials are not necessary for deterministic local implementation and tests: use synthetic route responses intercepted by the existing test tools. They are necessary for validating real routing. No runtime mock routes, fabricated fallback ETAs, generic provider framework, or production switch-on. Approve and pin the behavior delta before product edits; resolve live-service authority separately before transmitting any user location.

## Decisions to close, not indefinite research

| Decision | Recommended next action | Why it matters |
| --- | --- | --- |
| Provider, coordinate disclosure, hosting and spending cap | Approve the hosted openrouteservice candidate for validation; confirm terms, credentials, permitted retention and hard usage limits before external calls | Local fixture-based development is separate from live activation; no approved service or live-traffic commitment yet |
| Fewer than five Walkable bars | Approve the proposed visibly separated farther suggestions | Five visible options and a strict filtered list can conflict |
| Worth a ride / Anywhere / ranking precedence | Freeze threshold and inclusion semantics after distance validation | Prior proposals must not become hidden product decisions |
| Candidate cap, cache TTL, latency/accuracy targets | Measure the bounded prototype first; record thresholds before release | No measured production baseline or defensible numerical targets yet |

## Implementation slices and acceptance

The driver owns each slice and its checks, in order, under the existing distance goal. Do not create competing goals or restart completed V8 investigations. Each slice leaves a runnable result, not another standalone planning document.

1. **Origin and route data.** Trace `WhereNextFlow`, `useGeolocation`, `ResultsView`, `travelTime` and all their callers. A selected starting bar is the origin when the UI says "From [bar]"; the current-location flow uses its captured GPS reading; a neighborhood origin is explicitly approximate. Hold one origin snapshot per search. Keep walking/driving duration in seconds and route distance in meters, with origin/destination identity and availability. Retain haversine only for local candidate preselection or explicitly straight-line display. Add one provider-specific server integration at a new bounded route endpoint under `src/app/api`; reuse existing validation/rate-limit patterns after inspecting them. Test via intercepted provider responses, including malformed, null/unreachable, timeout and quota responses. No provider keys in browser code and no precise coordinates in URLs, logs or public shares.
2. **Existing card and directions.** Feed that same result into ResultCard: walking time and route distance first, smaller driving time and route distance beneath; preserve existing actions and layout. Each directions action uses the same destination, origin and explicit mode. Origin-bearing directions URLs are only constructed for the user's external Maps action, never public shares or telemetry. Audit BarLightbox, Map and Friends; any surface not supplied a route must show honest neighborhood/straight-line distance, not old multiplier minutes. Before live activation, correct the browser-only location promise and provide the required routing disclosure. Prove both phone layouts, loading/error states and action destinations with mocked routes.
3. **Route eligibility and bounded filling.** Use raw walking seconds <=900, never the displayed rounded minute value. Request initial five candidates and bounded replacements; reject obsolete results when origin/search changes. Route the other mode for final cards without changing their order. Implement the approved farther-group decision, unknown-route handling, request cap and deduplication. Candidate proximity determines what is checked first; retain current taste calculations rather than retuning weights here. Do not change Walkable to 15 minutes while leaving explicit-vibe expansion able to certify a longer trip. Add boundary, exhaustion, fewer-than-five and stale-response regression checks. Keep live routing disabled until the activation checks below pass.
4. **Real-route validation and activation readiness.** With approved provider access, use a small public NYC origin set spanning grid streets, bridges, parks, coarse GPS, selected origins and the 15-minute boundary. The owner's actual Break Bar trip is an additional case if they supply an origin; its absence does not prevent the other cases. Compare identical origin/destination/mode inputs; Maps is a reference, not infallible ground truth. Record raw seconds/meters, false Walkable classifications, missed closer candidates against a larger reference pool, route elements/search and latency. Agree numeric accuracy/latency tolerances before declaring acceptance; fixtures alone cannot prove real-world ETA quality. Set provider-permitted freshness, expiry/movement handling, attribution, privacy disclosure, session/global limits and failure behavior before enabling real user requests. No background location tracking or persistent precise-location cache.
5. **Recommendation correction, after distance evidence.** Evaluate nearer relevant choices using route times, preserving the existing learned-taste formula and Option B. Freeze the revised P1 precedence, driving threshold and inclusive Anywhere behavior before changing ranking. Inspect the effects of shown/visited exclusions, sparse tags and numerical near-ties; do not conflate them with a routing defect. Verify that strong taste does not bypass Walkable, nearby bars remain eligible in broader modes, and five options are filled honestly. An owner example improves relevance evaluation but is not required to test route filtering or deterministic proximity rules.
6. **V8 release checks last.** Integrate the distance candidate, then run the complete release gate below. Preserve the existing unrelated test changes without expanding them during slices 1–5. Carry the remaining browser coverage failure and release-contract digest issue from `V8-TEST-REPAIR-2026-09-06.md`; neither is silently waived or assumed fixed. Fix or obtain an explicit disposition before release.

The first implementation deliverable is a locally working, fixture-tested route-to-card flow with matching Maps inputs, not merely a revised multiplier or a provider stub. The feature is not finished until live route validation, eligibility, broader-mode semantics and the final gate have passed on the integrated candidate. No partial slice should be described as the completed distance fix.

Required regression cases: 22 minutes excluded from Walkable; 900 seconds accepted and 901 rejected; vibe cannot bypass radius; farther supplements clearly distinguished; missing routes cannot be certified; origin change rejects old results; mode-specific cache keys; repeated render/reopen avoids duplicate work; budget exhaustion stops requests without false "no bars"; cab/anywhere do not accidentally exclude nearby bars; Maps destination/origin/mode match; both iPhone 13 and Pixel 7 remain readable at enlarged text and existing actions still work.

**Matching evidence:** reproduce an actual suggestion set when the owner supplies an approximate origin and desired/undesired venues. Assess proximity and relevance separately, including sparse tags. No rating-based exclusion or new personalization model by accident.

Additional evidence from the current Vitest replay (`rankingReplay.eval.test.ts`, seed 20260819): six of 900 simulated pages contain a farther-first adjacent pair with a score difference <=1e-12. One pair puts 1.494 miles ahead of 0.240 miles for a score difference of 2.78e-17. Investigate numerical near-ties in the matching phase. This synthetic 403-bar replay is not the owner's actual catalog/profile or evidence of the Break Bar trip; it does not authorize changing ranking weights now.

**Release:** typecheck, Vitest, production-build E2E on both viewports, isolated staging verification, then owner-attended rollout. Record candidate identity and all failures. A green subset is not a green release gate. Owner chooses product/vendor decisions and release approval; driver owns implementation and evidence. Stop rollout on false eligibility, privacy leakage, uncontrolled requests, or contradictory labels. Do not roll back to misleading minute estimates.

Not planned: card redesign, Uber booking/fares, turn-by-turn navigation, self-hosted routing before need is demonstrated, monetization/growth changes, or paid model review.
