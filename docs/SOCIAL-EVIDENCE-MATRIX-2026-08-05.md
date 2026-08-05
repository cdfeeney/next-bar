# Social evidence matrix — 2026-08-05 (overnight Gate 3)

Produced by the local-only overnight verification loop (scope:
`docs/OVERNIGHT-TEST-AND-READINESS-SCOPE-2026-08-05.md`). Every browser result
below ran on BOTH iPhone 13 (WebKit) and Pixel 7 (Chromium) under the loopback
network fence (`e2e/tools/fence-proxy.mjs` + `playwright.config.ts` proxy):
non-loopback application requests were REFUSED and logged by hostname only.
During the run the fence refused 390 requests to the protected-Staging
Supabase host and ~248 to carto basemap CDNs — and every suite still passed,
proving no spec depends on live egress.

**Evidence class legend** — all E2E evidence here is `mocked-localhost`
(Supabase stubbed per spec via `e2e/helpers/fakeAuth.ts` or inline routes).
NOTHING in this matrix is real-Staging, real multi-account, or
physical-TestFlight proof. Those remain attended gaps for every row.

Run totals (2026-08-05, HEAD 5b9e300 + fence): identity/auth batch 62 pass +
1 skip (clipboard = chromium-only guard) + 1 iPhone 13 flake inside the
fence-proxy crash window that passed 4/4 on the justified retry;
friends/suggestions/votes/pins batch 109 pass; nights/sharing/lists batch 73
pass + 2 skips (same clipboard guard). Zero genuine failures.

| Row | Implementation state | Evidence (exact spec/test source) | State coverage (mocked-localhost) | Next missing behavioral test |
|---|---|---|---|---|
| Identity (handle, onboarding) | Built | `auth-page.spec.ts`, `claim-handle.spec.ts`, `onboarding-identity.spec.ts`, `profile-anon.spec.ts`; unit `profile.server.test.ts`, `storedProfile.test.ts` | signed-in, signed-out, empty, error, mobile ✓; revoked/stale/concurrent ✗ | real-Staging claim conflict between two live accounts |
| Follow / follow-request | Built | `friends-flow.spec.ts`, `friends-real.spec.ts`, `follow-requests.spec.ts` (incl. account-switch isolation via accountCache); unit `follows.server.test.ts`, `useFollows.test.ts` | signed-in, signed-out, unauthorized, empty, error, concurrent(account-switch), mobile ✓; revoked/stale ✗ | real two-account request→accept on Staging |
| Ratings (Loved/Liked/Pass) | Built | `rating-and-nav.spec.ts`, `rankings-*.spec.ts`, `want-to-go.spec.ts` (rate-prunes); unit `ratings.server.test.ts` | signed-in, signed-out(local mode), empty, mobile ✓; error/stale/concurrent ✗ | server-mode rating write failure surfaced to UI |
| Consensus (tonight poll board) | Built (followed-circle only) | `suggestions.spec.ts` (/friends/consensus board) | signed-in, empty, error(cap/decline), mobile ✓; unauthorized/revoked ✗ | real multi-account board on Staging |
| Suggestions | Built (followed-circle `get_circle_suggestions`) | `suggestions.spec.ts`; unit `suggestions.server.test.ts`, `useSuggestions.test.ts` | signed-in, empty, declined/cap, mobile ✓ | invite-scoped suggestion (Crew) — flow ABSENT |
| RSVP | Built | rsvp paths inside `suggestions.spec.ts`, `vibe-vote.spec.ts`, `pin-where-i-am.spec.ts`; unit `rsvps.server.test.ts` (0012–0014) | signed-in, mobile ✓; unauthorized/revoked/stale ✗ | un-RSVP race across two devices |
| Vibe votes | Built | `vibe-vote.spec.ts` (cast→move→rescind; winner seeds favorites; DARK-until-0017 negative); unit `vibeProfile.server.test.ts`, `vibeNightCache.test.ts` | signed-in, empty(dark RPC), error, mobile ✓ | real-Staging vote visibility across accounts |
| Sharing (night share links) | Built | `share-card.spec.ts`, `night-page.spec.ts`; unit `share.test.ts`, `ShareNightButton.test.tsx`; window-bound by 0035 (unit `migration0035.test.ts`) | signed-in, signed-out(viewer), empty, error, mobile ✓ | revoked-link fetch from a genuinely different account on Staging |
| Unsharing / revocation | Built | revoke paths in `night-page.spec.ts`, `nights-history.spec.ts`, `profile-anon.spec.ts`; unit `sharedNightsLocal.test.ts` | signed-in, revoked(mocked), mobile ✓ | revoked/expired link fails safely on real Staging |
| Nights Out (history) | Built | `nights-history.spec.ts`, `night-page.spec.ts`; unit `nightLog.test.ts`, `nightArchive.test.ts`, `nights.server.test.ts` | signed-in, signed-out, empty, loading, error, mobile ✓; concurrent ✗ | two-device same-night write convergence |
| Public profiles (/u/[handle]) | Built (Phase A honest signed-out, g-4a0f81a5) | `profile-anon.spec.ts` | signed-out, private-account, empty, mobile ✓ | opt-in public profile surface (Phase B, g-c8b26779) |
| Lists / Want-to-Go | Built | `lists-flow.spec.ts`, `rankings-lists.spec.ts`, `want-to-go.spec.ts`, `want-to-go-writers.spec.ts` | signed-in, signed-out, empty, mobile ✓ (clipboard tests chromium-only by Playwright limitation) | shared-list viewer on real Staging |
| Pins (live venue presence) | Built locally; **migration 0038 draft NEVER applied** | `pin-where-i-am.spec.ts` (37 tests incl. epoch guard, owner-gating); unit `pins.server.test.ts`, `pinSignal.test.ts`, `migration0038.test.ts` (static) | signed-in, signed-out, empty, error, stale(epoch), mobile ✓ | attended 0038 apply + LIVE two-user SQL authz + Postgres DST proof |
| Close Friends | **NOT built** (Phase B `g-c8b26779` planned; migration 0039 reserved, no file) | none (planning evidence only) | none | entire feature + RLS review |
| Crews (reusable) | **NOT built** — no schema, no UI; "Invite friends" is a zero-server-state `/join` link | none | none | the 10-step acceptance chain in `docs/MORNING-HANDOFF-2026-08-05.md` block B, on real Staging with multiple accounts |
| Invited Night Outs | **NOT built** — `get_circle_suggestions` reads caller+followed users, NOT night-scoped invitees; existing suggestion E2E stubs Supabase and does NOT prove invited-member join/see/suggest/vote/removal | none (explicitly NOT counted per scope) | none | invite-scoped visibility + voting + removal + guest-does-not-join-Crew |
| Notifications (push) | Partial foundation: `push_subscriptions` (0009) + `push.test.ts` unit; push DISABLED (preflight-asserted); **native APNs ABSENT** | unit only; `analytics-silence.spec.ts` proves analytics dark | disabled-state ✓ only | APNs packet (overnight platform goal) then physical-device push |

## Incomplete-by-design tonight (attended gaps, every row)

1. Real protected-Staging multi-account behavior (all rows) — mocked only.
2. Physical TestFlight: login-on-open window, background behavior, safe areas,
   scrolling (operator-reported items remain OPEN).
3. Crews / invited Night Outs / Close Friends — not implemented; queued goals.
4. Pins Staging proof — blocked on attended 0038 apply.
