# V9 overnight fix and refactor queue

Version: 0.5 intake, recorded 2026-09-08 America/New_York. Revision 0.2 added Connor's critical visual/typography review and test-reliability audit (V9-11/12). Revision 0.3 records his explicit correction that the chosen typography replaced Poppins with different header and body fonts. Revision 0.4 makes test repair and the bounded shared-code refactor prerequisites for feature lanes. Revision 0.5 makes Apple Human Interface Guidelines plus applicable SDK documentation an explicit UI-review rubric; no earlier requirement ID is renumbered.
Owner: Connor. Source: this session's v8 phone feedback and explicit instruction to save the work for v9, not continue fixing v8 now.
Baseline inspected: `1eae20ad124be66b8a62d67e0309ac756d2be783`.

This is the repository's v9 feedback queue and requirement delta. It preserves the requested behavior; it is not a claim that implementation, review, stored mission admission, or device acceptance has happened. The frozen v8 PRD/ledger remain historical inputs. No workers or paid model calls were launched to prepare this queue.

## Release and environment truth

- Product v8/v9 and Apple's build numbers are different identifiers.
- Last previous iOS upload: version 1.0 build 8, run `32484294934`, explicitly built for `https://next-bar-staging.vercel.app`.
- Version 1.0 build 9, run `34305730032`, successfully uploaded in this session for `https://next-bar.com`. Apple processing, tester assignment and installation were not independently verified.
- Production website was promoted to deployment `dpl_HgzpMX3U8wDd1aynGZ6fNSBaEnRJ`. This did not update build 8's staging origin. Earlier advice to simply reopen build 8 was wrong.
- The owner calls the tested product v8; the precise installed iOS build for these reports is still unconfirmed. Record build, origin, account environment, iOS version and commit when reproducing. Do not infer origin from the current Capacitor default; inspect the actual build's dispatch/logs.
- Prepare and verify v9 on staging. Do not move production aliases, roll back production, upload another binary, alter Google keys/quotas, run migrations or distribute to testers as part of an unattended loop. Those are separate release actions.
- Preserve account data, ratings, groups, memberships, night history and existing storage keys. A switch between staging and production does not migrate accounts or sessions.

## Ordered queue

IDs below are requirement/task identities, NOT stored `g-...` mission IDs. The source numbering was incomplete; retain all reports without inventing missing items.

**Owner priority correction:** the Playwright repairs and codebase refactor are foundation work and come before feature implementation. The previous instruction to prioritize functional changes ahead of the refactor is superseded. Execute these stages:

1. **Establish reliable checks (V9-12, with V9-11 visual evidence).** Verify build/environment identity, reproduce representative phone failures, repair misleading test fixtures/assertions/readiness, and record which checks exercise mocked, live staging or native behavior. Capture current behavior and expected approved behavior separately before changing shared code.
2. **Refactor the necessary foundation (V9-08).** Audit whether the previously reviewed retirement slice is present in the actual chosen baseline. Preserve/reuse it; do not redo it. Trace callers and simplify the shared planner/invitation state, detail-view access, camera ownership and other concrete dependencies implicated by the feedback. Keep one writer and behavior-preserving slices. Do not turn this into a whole-app rewrite or unrelated cleanup.
3. **Verify and record a shared starting commit.** Run the applicable regression checks and required review on the foundation candidate. Separate pre-existing/reproduced product failures or newly requested behavior from regressions introduced by the refactor; preserve the failing evidence and map it to the exact remaining goal. Do not require an unimplemented feature to pass before work can begin, but never hide its failure with skips/mocks or call the full release gate green. No new foundation regression or unresolved shared ownership may pass this stage.
4. **Start dependent feature lanes from that same verified foundation commit.** Night Out stays in one lane; independent map/recommendation/camera work may use another only under the launch policy. Shared fonts/test infrastructure remain serialized. Finish with combined-candidate verification and physical-device acceptance before release.

The driver must store these dependencies in actual goals/manifest state; a numbered prose list is not a scheduling gate. If the foundation consumes the available run budget, preserve it and report feature work pending rather than starting feature branches early. A visual audit is not permission to replace the owner's chosen design.

### V9-01 — Recommendation text and short results

Source: owner saw three bars and disliked text such as “near you only 3 routes confirmed in this search.”

- Remove the result-summary sentence `Only {n} routes confirmed in this search.` and equivalent internal routing-count commentary from the recommendation surface. Review the nearby `Checked ... candidates` text for the same problem. Preserve required provider attribution and useful actionable failures.
- Investigate why this account/search returned only three: candidate ordering/cap, opening hours, selected travel band, filters and provider response. Record the cause before changing ranking or request volume.
- Do not invent two bars, silently change the selected travel band, fabricate travel times, or raise provider budgets merely to reach five. Five eligible results remain the target; fewer can be valid when eligibility is exhausted.
- The owner explicitly accepts the temporary zero-to-loaded transition for now. Record it as deferred by Connor on this date; do not spend this queue redesigning loading states.
- Evidence: `src/components/ResultsView.tsx:300`, `src/hooks/useTravelRoutes.ts`, `src/lib/routeSearch.ts`, `src/lib/travelTime.ts`. The current server search caps candidates at 15; that is an investigation lead, not a proven cause for this account.
- Acceptance: offending copy absent; confirmed times/attribution remain; a reproducible short-result case explains actual eligibility; both mobile viewports pass. Live provider checks need an explicit finite request allowance.

### V9-02 — Plan Night Out horizontal overflow

Source: plan form spills far beyond the right edge on iPhone.

- Trace which form field/layout exceeds the viewport, including native date/time inputs, long names and the keyboard. Fix sizing in the responsible shared component rather than hiding the entire page's overflow.
- Keep labels and values readable and controls reachable in compact and large iPhone portrait/landscape; retain safe areas, zoom/text scaling and vertical scrolling.
- Paths: `src/app/friends/consensus/page.tsx`, `src/components/NightOutPlanFields.tsx`, `src/components/StartNightOutButton.tsx`.
- Acceptance: document width does not exceed viewport width after opening selectors/date fields and with long content; primary CTA is accessible with and without keyboard. Include WebKit and actual iPhone evidence.

### V9-03 — Created Night Out stays discoverable

Source: after starting a night the owner can no longer find it.

- After successful creation, open that exact plan and make the owner's active plan discoverable under Social > Plans. Returning from another tab or reopening the app must recover the same plan.
- Distinguish loading/read failure from no plans. Do not create another plan as a recovery mechanism. Preserve cancelled/expired states, membership checks and account-switch isolation.
- Investigate owner inclusion in `get_my_night_outs`, list refresh/navigation, night cutoffs and the existing creation recovery state. Cause is not yet proven; do not assume data was deleted.
- Paths: `src/components/StartNightOutButton.tsx`, `src/components/PlanInvites.tsx`, `src/app/friends/_components/PlansSection.tsx`, `src/lib/nightOuts.server.ts`, `src/app/night-out/[token]/page.tsx`.
- Acceptance: owner creates once, navigates away, returns/reloads and reopens the same ID; invitee sees only authorized invitations; another account does not inherit it; failed reads are recoverable.

### V9-04 — Searchable people and group selection

Source: replace the “blob of people” with search/dropdown selection of a group or individuals.

- Use a compact accessible people search and group selector; selected recipients must be visible and editable without displaying the entire circle as a wall of chips.
- Reuse real groups and membership APIs, including friends with no ranked bars. Deduplicate recipients when a person is chosen directly and through a group. Keep empty, loading and failed roster states distinct.
- Make actual recipients clear before submission; do not silently invite everyone because of an implicit default. Exact icon/spacing art can use the current approved design system; no new visual direction is approved here.
- Paths: `src/app/friends/consensus/page.tsx`, `src/lib/inviteeSelection.ts`, `src/lib/groups.server.ts`, `src/app/friends/_components/GroupsAndPeople.tsx`.
- Acceptance: select group, add/remove individuals, search long names, keyboard/VoiceOver operate picker; submitted recipient set exactly matches the visible selection, including unrated members. Preserve server authorization and blocked-user rules.

### V9-05 — Bar suggestions, voting and actual invitations in the plan flow

Source: owner cannot find bar suggestions/voting or a real invite action; Start Night Out belongs at the bottom, not among people's names.

- Order the flow as plan details, recipients and suggested bars, then the primary action at the bottom. Clearly label the action that creates the plan and sends its invitations; expose sharing of that specific plan's invitation link.
- Let the organizer select bars for the plan's vote from the planning flow; retain member suggestions/votes on the resulting plan. Show the shortlist and invitation outcome after submission.
- Reuse the canonical Night Out board and existing suggest/vote/invite APIs. A generic `/join` share is not a plan invitation; tonight-wide polls are not member-scoped Night Out votes.
- Preserve idempotent creation and recipient deduplication. If a suggestion or invitation fails after creation, keep the created plan accessible, show the partial outcome and retry only failed operations. Never claim an invitation was sent when a write failed.
- Paths: `src/components/StartNightOutButton.tsx`, `src/components/NightOutPlanFields.tsx`, `src/app/friends/consensus/page.tsx`, `src/app/night-out/[token]/page.tsx`, `src/lib/nightOuts.server.ts`. Verify existing board components/callers before adding any new abstraction.
- Acceptance: owner selects people/group and a bar, creates once, sees the plan and specific invite link; invited member accepts and votes; outsider cannot read private state or vote; double tap and partial failure do not duplicate plan/invites. Use isolated test accounts; no real-user messages in automation.
- Coordinate V9-02/03/04/05 sequentially: they share the planner and creation code.

### V9-06 — Real iPhone camera access

Source: “No camera is available on this device” on an iPhone.

- The capture system already exists (`src/components/capture/useCamera.ts`, `CameraStage.tsx`), using `getUserMedia` with `audio:false`. It is not evidence of working native permissions.
- Confirmed local gap: `ios/App/App/Info.plist` lacks `NSCameraUsageDescription`. Apple requires a camera usage description for camera access. This is a concrete fix candidate, not proof it is the sole cause of the reported failure.
- Trace the signed build's permissions, WKWebView media-capture behavior and secure origin. Use Apple's documented APIs and existing Capacitor support; do not unconditionally grant camera access to arbitrary origins or add microphone permission without an audio feature.
- Distinguish permission denied, missing API, busy camera and device unavailable when the system exposes that distinction. Offer accurate app/browser settings guidance and retain library/cancel/retry paths.
- Acceptance: actual TestFlight-installed iPhone prompts on deliberate capture entry, shows preview, takes rear/front photos, survives denial/retry/cancel and releases capture on exit. Simulator/mocked browser success cannot close this item. Native plist/config changes require a new staging-targeted iOS binary at the attended device-test step.
- Preserve the existing photo audience, storage and deletion policies; this is not approval to change media retention or publish captures automatically.

### V9-07 — Map venue name opens shared photos and hours view

Source: owner item 7, explicitly “for 9.”

- On the map, the venue name is a visibly light-blue interactive link/control. Tapping it opens the same venue detail view used by Next Bar's Photos & hours, for that exact venue.
- Provide an X in the top-right corner. Closing returns to the map at the same center, zoom, selected venue and filters; restore focus to the triggering name. Do not send the user to an unrelated external map.
- Reuse `BarLightbox` and its Google media/fallback/attribution behavior. Support both marker popups and search-focused popups: `BarMap.tsx` currently creates one with React and one with DOM `textContent`.
- Paths: `src/components/BarMap.tsx`, `src/components/BarLightbox.tsx`, `src/components/ResultCard.tsx`, `src/app/map/page.tsx`.
- Acceptance: marker and map-search entry both open correct photos/hours, X is visible/reachable with safe areas, keyboard/Escape/VoiceOver work, close restores map state and focus. No unsafe interpolated HTML, background media prefetch across all pins, or rehosted Google photos.

### V9-08 — Bounded refactor of the affected code

Source: owner asks to put these issues into the codebase refactor; prior v9 audit scope already exists in `V8-PRD-DELTA-2026-09-07.md`.

- Locate the existing v9 audit/retirement goals before creating another. Fold these concrete findings into that audit as residual work, preserving exact task identities and existing owners.
- Trace planner creation/recovery, group vs individual selection, plan discovery, map/detail entry and capture ownership end to end. Remove duplicate paths or misleading legacy UI only where the approved replacement and every caller are known.
- Keep one canonical plan/invite/vote model, one detail view, and one camera ownership path. Do not rewrite the app, add speculative frameworks or delete recovery/idempotency/security behavior to reduce line count.
- Acceptance: per slice, record callers, before/after complexity or removed duplication, behavior preserved and runnable verification. The necessary shared-code refactor is a prerequisite for dependent feature work, verified against the repaired tests. Once those concrete dependencies are sound, proceed to the fixes; unrelated architecture cleanup is outside this foundation gate.

### V9-09 — Tile icon design exploration

Source: owner item 10 asks about redrawing Next Bar tile icons with Claude Design.

- Prepare a small icon exploration in Claude Design against the existing Next Bar palette and typography. Show candidate icons in actual tile context at phone size, with selected/unselected and light/dark contrast where applicable.
- Clarify which tile/icon family the owner means before replacing assets (in-app tile icons versus the installed app icon). This ambiguity blocks only icon replacement, not the functional queue.
- Prefer simple SVG or appropriate native symbols after visual selection. Keep labels/accessibility and approved navigation. No image generation, paid design run, new asset family or icon replacement was launched/approved by saving this task.
- Acceptance for this queue item is a reviewable design brief/exploration; shipping new art waits for the owner's selection. Record the chosen artifact and scope before implementation.

### V9-10 — Apple SDK and native UI review as a standing practice

Source: owner asks to use Apple SDK guidance going forward, specifically rounded-corner APIs and applicable iPhone fixes.

- Consult current primary Apple documentation for affected native behavior. Record the SDK/API, supported OS versions and fallbacks; test on the supported iPhone range. Include camera permission, safe areas, sheet dismissal, keyboard layout, touch targets, text scaling and VoiceOver in the relevant fix checks.
- **Required Apple review rubric:** use Apple's Human Interface Guidelines for design/interaction decisions and SDK documentation for implementation. Check typography hierarchy and custom-font legibility; larger text/Bold Text support; control sizing and spacing (preserve this repository's 44px web target contract and verify its actual iPhone presentation); safe areas and adaptive portrait/landscape layout; keyboard reachability; navigation and sheet close/back behavior; contrast and non-color state cues; VoiceOver labels/order/focus; reduced motion; corner concentricity; and permission/recovery UX. Match each actionable finding to the relevant Apple source, affected screen, observed evidence and verification method. Do not claim universal HIG compliance from a generic checklist or passing screenshot test.
- Preserve the owner's selected custom heading/body fonts and brand. Apple guidance explicitly accommodates custom fonts when legible and accessible; it is not permission to replace them with Poppins or a system font. For WKWebView content, verify actual accessibility text behavior on-device rather than assuming a CSS font-size or a SwiftUI modifier gives the web page Dynamic Type support.
- Native corner APIs exist: UIKit `UICornerConfiguration` / `UIView.cornerConfiguration`, and SwiftUI `ConcentricRectangle`. Use them where there is an actual native container and supported runtime; do not hard-code undocumented device corner radii.
- Next Bar currently renders most screens as HTML/CSS inside Capacitor's WKWebView. These SwiftUI/UIKit APIs do not directly style HTML tiles. Use consistent web radius/spacing tokens there; do not claim native API adoption for a CSS-only change. No wholesale SwiftUI rewrite is authorized.
- The existing pipeline already builds with Xcode/iOS SDK on a Mac runner. Building with that SDK and adopting a particular native UI API are different things.
- Acceptance: a short native-versus-web applicability inventory tied to these fixes, one justified minimal change where applicable, OS fallback evidence and physical-device checks. Corner artwork remains consistent with the selected design.

### V9-11 — Critical visual and typography review against the chosen designs

Source: Connor reports the fonts look different from the ones he chose and requests a critical review of visually awkward or broken UI. This authorizes an audit and restoration of approved intent, not a new design direction.

- **Owner correction, authoritative:** “we had a font change it was not poppins we had differnet header and body text for sure.” The approved target uses distinct header/body font families and is NOT the current all-Poppins implementation. Exact family names, weights and the later design artifact still need recovery. Do not ask the owner to approve Poppins again, reinterpret this as a weight-only change, or select a replacement pair by guesswork.
- Confirmed stale records: `docs/BLUEPRINT-viral-social-2026-07-23.md` A0 specifies Poppins for both roles; `docs/CLAUDE-DESIGN-RECOVERY-2026-08-12.md` says “Poppins-like.” These are historical evidence and are superseded for the typography target by the owner's correction. The local inspected references contain screenshots and do not establish the later pair's names. Recover the later approved Claude Design typography artifact/source or decision, then persist separate heading/body tokens and exact role/weight mappings in the versioned v9 contract before changing fonts. Missing family names block only the font substitution, not the rest of the visual or functional audit.

- Start from `docs/design-reference/README.md`, its approval/decision records, and the actual approved artifacts, including `approved/next-bar-five-bars-typography-refinement.png`. Match each screen to its correct reference and approval date. If an exact font/weight is not specified by the available artifact, report that uncertainty and consult the approved design source; do not identify a font from a screenshot by guesswork or treat old code comments as approval.
- Current code evidence: `src/app/layout.tsx` imports Poppins; `tailwind.config.ts` assigns it to display and body families; `src/app/globals.css` sets `.font-display` to weight 700. This differs from the owner's confirmed separate-font target. Do not treat successful Poppins loading as acceptance. The exact history of whether the later pair was never implemented, lost in integration or deployed elsewhere is unproven; trace it before claiming a regression cause.
- Inspect actual rendered family and face, requested/loaded font assets, load failures, fallback/synthetic weights, size, weight, line height, tracking and wrapping on headings, bar names, body text, buttons and navigation. Computed `font-family` alone does not prove the glyphs use the intended loaded face. Include cold/warm loads and asset failure, and distinguish app-owned text from provider-owned Google widgets.
- Walk Map, Rankings, Next Bar?, Social, Account, planning, plan details, photos/hours and capture. Review visual hierarchy, spacing, oversized text, cramped controls, horizontal overflow, overlapping elements, inconsistent corners/icons, clipped labels, contrast, safe areas and keyboard behavior. Include long names, nonempty lists, empty/error states, selected states and larger accessibility text.
- Produce a bounded visual defect list: screen/state, exact build/origin/commit, reproduction, expected approved reference, annotated actual/reference image, severity, likely code owner and smallest correction. Separate broken behavior, drift from approved art, and subjective suggestions. Do not auto-approve screenshots from the current implementation as the design baseline.
- Apply the V9-10 Apple HIG/SDK rubric to this visual review and include the supporting source for each Apple-related finding. Compare both brand fidelity and iPhone usability; do not substitute general platform styling for the owner's approved design.
- Acceptance: a side-by-side review of the affected screens with identified font evidence and concrete fixes; visual changes match the approved reference or have an explicit new owner decision. Verify on compact/large mobile viewports plus the actual iPhone. Screenshots must be inspected, not just generated. Existing acceptance of the temporary zero-to-loaded transition in V9-01 remains in force.
- Scope: `src/app/layout.tsx`, `tailwind.config.ts`, `src/app/globals.css`, approved design references and only the components implicated by reproduced visual defects. Preserve accessibility and provider attribution; avoid unrelated restyling.

### V9-12 — Audit and repair misleading Playwright coverage

Source: Connor can trigger failures on his screens despite reported passing tests, and asks to improve how tests are written and executed. Treat these reports as evidence of coverage/acceptance gaps. Do not assume every test is faulty or blame the user's device.

- Map each reported phone failure in this queue to the existing test, actual trigger, mocked dependencies, skipped state and missing assertion. Separate product defects, test defects, differing account/catalog/build environments, and browser-versus-native limitations. Record unknowns without guessing causality.
- Establish test identity before interpreting results: exact source/test/config commit, built artifact, base URL, database environment, auth mode, catalog fixture/live source, browser engine/device settings and any provider flags. A test of local staging code cannot certify the deployed production binary. An iPhone Playwright project is browser emulation, not the installed Capacitor app.
- Audit broad `page.route`/RPC mocks, fabricated successful writes, blanket empty REST responses, direct navigation or storage seeding that bypasses the user journey, forced clicks, fixed sleeps, excessive timeouts, skipped tests and retries. Keep useful deterministic fixtures, but assert the expected request arguments and fail unexpected calls where appropriate; a stubbed success must never be reported as live integration proof.
- Existing leads: `e2e/night-out.spec.ts` stubs Night Out and auth/REST responses in some scenarios; `e2e/mobile-controls.spec.ts` contains fixed waits; `playwright.config.ts` already uses a fresh server and zero retries for release runs. Inspect these in context rather than deleting all mocks/waits or reimplementing controls that already exist.
- Write journeys from visible entry points using user-facing controls and normal actionability. Assert the resulting state, not merely a click, a heading or a 200 response: create -> discover again after navigation/reload; select recipients -> inspect actual invite set; invite -> recipient accepts -> suggests/votes; map name -> correct details -> X -> preserved map/focus. Include denied permissions, failed/partial writes, long content and relevant account switches.
- For every repaired regression, retain the original failing trace or a deterministic equivalent that fails on the known-bad version and passes on the correction. Use saved evidence/isolated fixtures; never reset or mutate the active writer's candidate to manufacture a baseline. Do not weaken assertions, blindly update image snapshots or raise retries to turn the gate green.
- Visual checks must wait for real readiness and font loading, cover geometry/occlusion and compare approved stable surfaces where meaningful. Mask only genuinely nondeterministic provider content and disclose masks; do not mask the failing control. Browser screenshots are review evidence, not proof of native permission behavior.
- Keep three explicit evidence categories: deterministic browser regression tests; isolated staging integration tests with real persistence/auth and bounded provider use; physical TestFlight iPhone acceptance for camera, native prompts, keyboard/safe areas and selected visual checks. Never silently substitute the first category for the other two. No production user-account mutation, real-person invitations or billable calls without the applicable run authorization.
- Run the repository's required production gate on the final candidate (both mobile viewports, unfiltered required suite); report passed/failed/skipped and provider/mock conditions. Do not rerun unchanged full suites merely to update prose. Save traces/screenshots/console and failed network evidence with secrets and personal data redacted, and report remaining untested flows plainly.
- Acceptance: a concise feedback-to-test coverage table; meaningful regressions for the reproduced issues; candidate-bound gate evidence; honest remaining live/native gaps. A large passing-test count is not the completion criterion. If physical access or a required staging service is unavailable, preserve the implemented/tested slice and mark that acceptance incomplete.
- Scope: `playwright.config.ts`, `scripts/run-e2e-release.mjs`, the implicated `e2e/` specs/helpers and the existing release evidence/reporting paths. Improve the existing Playwright setup rather than adding a second framework or a broad flaky-test retry layer.

## Overnight admission and stop rules

1. This file is a prepared queue, not a running loop. No `g-...` IDs were created here. A title-filtered read of this worktree's goal list returned no matching v9/refactor/camera/night/map-photo goals; that is NOT a repository-wide duplicate/lease audit.
2. Before mission admission, inspect existing goals and live workstreams across the repository, especially the prior v9 audit. Reuse matching IDs and preserve live owners. Pin this delta's version/digest, baseline, requirement IDs and affected v8 requirements in the v9 ledger. Do not silently restamp the frozen v8 ledger or claim its validator admits v9.
3. Default to one worker and sequential slices. No model routing, paid reviews or workers are authorized by this queue-saving turn. At launch, set a finite model-call budget and wall-clock stop bound; inspect local usage if available. A failed call is not approval.
4. One focused implementation attempt and at most one evidence-driven correction per slice, then report a blocker instead of expanding scope. Do not retry uploads or billable provider calls blindly.
5. Follow the repository's typecheck, Vitest and production Playwright release gate when implementation is ready; relevant flows run on both mobile viewports and auth modes. Record actual failures without compressing away evidence. New native changes also require a real staging TestFlight device check.
6. Finish each slice with exact commit, changed paths, test results, screenshots where relevant, residual limitations and next action. Stop at ready-for-review or a concrete blocker. No automatic integration, production deployment, database mutation, new TestFlight upload, external message or quota/key change.

## Primary Apple references checked for this intake

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- [Typography, custom fonts and Dynamic Type](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Accessibility and control sizing](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Adaptive layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [UIKit corner configuration](https://developer.apple.com/documentation/uikit/uicornerconfiguration-swift.struct)
- [SwiftUI ConcentricRectangle](https://developer.apple.com/documentation/swiftui/concentricrectangle)
- [Camera authorization and usage descriptions](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)
- [WKWebView media-capture permission delegate](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:))

Release evidence outside the repository is indexed by `D:/harness-handoffs/nextbar-overnight-20260907/IOS-TESTFLIGHT-CORRECTION-2026-09-08.md`. Recheck current remote state before any subsequent release action.
