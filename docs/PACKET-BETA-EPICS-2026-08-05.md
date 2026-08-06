# PACKET — Beta user epics, per-surface status — 2026-08-05 (goal g-6b9f79ec)

Maps every epic in `docs/EPICS-v0.6.md` to its real, evidence-backed state.
Sources: `docs/SOCIAL-EVIDENCE-MATRIX-2026-08-05.md` (Gate 3, mocked-localhost
e2e on iPhone 13 + Pixel 7 under the network fence), repository inspection on
`feat/overnight-2026-07-30` (HEAD at authoring: `4f9d444`), `git show
6ec5e5d:…` existence checks (Production/Staging both serve `6ec5e5d`),
`docs/STAGING-ACCEPTANCE-2026-08-05.md` (read-only pass), and
`docs/OVERNIGHT-TEST-REPORT-2026-08-05.md`.

**Evidence-class rule (inherited from the matrix, non-negotiable):** every
"Local-verified" mark below is *mocked-localhost* browser or unit evidence.
Nothing here is real-Staging multi-account proof, and nothing is
physical-device proof. Rows that need those say so.

## Surface definitions

| Column | Means exactly |
|---|---|
| Built | Implemented on `feat/overnight-2026-07-30` (or earlier main) |
| Local | Verified by unit + mocked-localhost e2e (both mobile viewports) |
| Staging | Behaviorally verified against protected Staging. **Only the read-only pass in `STAGING-ACCEPTANCE-2026-08-05.md` exists; NO write-path Staging acceptance has ever run** (continuation §5.4) |
| Prod | The code exists in the deployed `6ec5e5d` (existence ≠ verified; no Production behavioral verification has run) |

Deployment reality check: Production and Staging both serve `6ec5e5d`.
**Everything added on the overnight branch is deployed NOWHERE** — that
includes the login window, the mobile-shell pack's subjects, `/nights`
history, `/search`, pins, matcher v1.1, and the phase-adaptive changes made
after the fork. TestFlight build 5 wraps Production, so no branch feature is
device-testable today (`docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b`).

## The 8 acceptance states

Per the scope doc, each epic is assessed against: **happy · empty · loading ·
error · offline · unauthorized · stale · concurrent**. "✓" = covered at the
Local tier by a named spec; "✗" = uncovered anywhere; "n/a" = state cannot
arise for that surface.

## E0 — Foundations

| Sub | Built | Local | Staging | Prod | Evidence |
|---|---|---|---|---|---|
| E0.1 tagDisplay | ✔ | ✔ | read-only ✔ | in 6ec5e5d ✔ | unit per tag; enforcement grep test |
| E0.2 vibeAxes | ✔ | ✔ | read-only ✔ | ✔ | exhaustiveness unit |
| E0.3 nightPhase | ✔ | ✔ | — | ✔ (pre-fork shape) | rollover/override units. **Scope note (santa: Fable):** THIS branch has a single 6am rollover (`socialNight.ts`, `NIGHT_ROLLOVER_HOUR = 6`); the 5am-personal/6am-nightKey split exists ONLY in the `release/beta1-rc` worktree, whose composition reverted the pin commit's unification (continuation §2). Nothing on this branch rolls at 5am |
| E0.4 DESIGN-SYSTEM | ✔ | n/a (doc) | n/a | n/a | file present |

States: happy/empty/error ✓ (units); offline/unauthorized/stale/concurrent
n/a (pure functions). No gaps beyond deployment.

## E1 — Plan a night with friends (Partiful register)

| Sub | Built | Local | Staging | Prod | Evidence |
|---|---|---|---|---|---|
| E1.1 Night object create (date+invitees) | ✘ (group Night Out object absent; personal nightLog exists) | — | — | — | matrix "Crews/Invited Night Outs: NOT built" |
| E1.2 Invite link + OG, no account | partial: `/join` is a **zero-server-state** link (not a night-scoped invite) | ✔ for `/join` | — | `/join` in 6ec5e5d ✔ | matrix; handoff block B |
| E1.3 RSVP "I'm in" | ✔ (bar_rsvps 0012–0014) | ✔ | ✘ write-path never run | ✔ | `suggestions.spec.ts` rsvp paths; `rsvps.server.test.ts` |
| E1.4 nominate→vote→lock | partial: suggestions votable (#28); **persistent async server votes, poll register, LOCK step remain unbuilt** | ✔ for shipped part | ✘ | shipped part ✔ | matrix Consensus/Suggestions rows. **Precision (santa: Fable):** "backing" a suggestion IS persistent server-side today (`suggest_bar`, capped, counts only) — what's absent is voting on someone else's pick without spending the cap, voter-name registers, and lock. **The remainder is expected to land AS the Crews night-vote/lock design** (`PACKET-CREWS-ARCHITECTURE-2026-08-05.md`), not as a widening of the followed-circle surface (santa: GLM) |
| E1.5 planning home phase | ✔ (chip only; no plan card — QA5-S1 keeps Plan Night Out on Friends tab) | ✔ | — | chip ✔ | `home-phase.spec.ts`; page.tsx comments |

States (shipped subset): happy/empty/error/mobile ✓; unauthorized ✓ (suggestion
caps/declines); **offline ✗, stale ✗, concurrent ✗ everywhere; real
multi-account board = attended gap**. The invited-group version of this epic
is **NOT built** — that is the Crews packet's subject, deliberately not
duplicated here (`docs/PACKET-CREWS-ARCHITECTURE-2026-08-05.md`).

## E2 — Start the night

| Sub | Built | Local | Staging | Prod | Evidence |
|---|---|---|---|---|---|
| E2.1 WhereNextFlow collapse | ✔ on branch | ✔ | ✘ | ✘ post-fork shape | `where-next-path.spec.ts`, `home-location-first.spec.ts` (incl. deleted-screen negatives) |
| E2.2 Inline axis adjuster + night vibe cache | ✔ | ✔ | ✘ | partial (pre-fork VibeTweak in 6ec5e5d; six-axis map surface is branch-only) | `vibe-tweak-reachable.spec.ts`, `vibeNightCache.test.ts` |
| E2.3 Photo-first result card | ✔ | ✔ | read-only ✔ | ✔ | `photo-card.spec.ts` |
| E2.4 starting phase | ✔ | ✔ | — | ✔ | `home-phase.spec.ts` |

States: happy/empty/loading/error ✓; offline partially ✓ (fence proves
no-egress render; true offline-PWA behavior untested); unauthorized n/a;
stale ✓ (vibe cache rollover unit); concurrent ✗ (two-tab vibe pick).
**Known open race (found 2026-08-05, g-b07c73bc santa): Permissions API
slower than the 400ms primer grace timer strands a denied user on the
location primer** — real users recover via "Pick a bar instead"; product may
want the step-decision effect to also route denied→picker from
`askLocation`. Carried OPEN.

## E3 — Already out

| Sub | Built | Local | Staging | Prod | Evidence |
|---|---|---|---|---|---|
| E3.1 Tonight-exclusion | ✔ | ✔ | ✘ | ✔ | `tonight-exclusion.spec.ts` |
| E3.2 Distance chips | ✔ | ✔ | read-only ✔ | ✔ | `distance-open-now.spec.ts`, `distance-widening.spec.ts` |
| E3.3 Open-now hard filter | ✔ | ✔ | read-only ✔ | ✔ | openNow boundary units; closed-bar-absent e2e |
| E3.4 out phase + one-tap next | ✔ | ✔ | ✘ | partial | `home-phase.spec.ts`, `recap-home.spec.ts` |

States: happy/empty/error ✓; loading ✓; offline as E2; stale ✓ (night
rollover refresh, useNightRefresh); unauthorized n/a; concurrent ✗
(two-device same-night exclusion divergence — matrix Nights row gap).

## E4 — Commemorate the night

| Sub | Built | Local | Staging | Prod | Evidence |
|---|---|---|---|---|---|
| E4.1 Night object + persistence | ✔ local-first (nightLog/nightArchive); server sharing via shared_nights 0016 | ✔ | ✘ write-path | nightLog ✔ / `/nights` route ✘ (absent at 6ec5e5d) | `nightLog.test.ts`, `nightArchive.test.ts`, `nights.server.test.ts` |
| E4.2 Auto recap card | ✔ | ✔ | — | recap lib ✔ (pre-fork), phase surface post-fork ✘ | `recap-home.spec.ts`, composition units |
| E4.3 OG share image | ✔ | ✔ | read-only ✔ | ✔ | `share-card.spec.ts` + bundle guard |
| E4.4 `/u/[handle]/night/[nightKey]` public page | ✔ (0035 window-bound; Phase A honest signed-out) | ✔ | ✘ revoked-link on real Staging | route ✔ | `night-page.spec.ts`, `profile-anon.spec.ts`, `migration0035.test.ts` |
| E4.5 recap phase | ✔ | ✔ | — | ✘ post-fork | `recap-home.spec.ts` |

States: happy/empty/loading/error/mobile ✓; unauthorized ✓ (viewer paths);
stale ✓ (revoked mocked); **concurrent ✗ (two-device night-write
convergence); revoked/expired on real Staging ✗** — both named attended gaps
in the matrix. **Cross-reference, not counted:** sibling branch
`feat/beta1-account-sync@f40783a` (worktree `nb-account-sync`) implements
account persistence for Want-to-Go/custom lists, night history, and
share-management records with migration `0042` — **unreviewed, unapplied,
never pushed; excluded from every status above until its own T0 review
passes.**

## E5 — App Store launch

| Sub | Status | Evidence |
|---|---|---|
| E5.1 Prerequisites | operator-tracked; domain/forwarding items with operator | EPICS table |
| E5.2 Capacitor + pipeline → TestFlight | ✔ build 5 exists BUT wraps Production (arch A); ADR adopts C (per-binary env) | `TESTFLIGHT-ARCH-DECISION-g-39169b3b` |
| E5.3 TestFlight dogfood | **blocked as proof surface**: device tests write Production data and cannot see branch code | same ADR; `MOBILE-SHELL-DEVICE-CHECKLIST-2026-08-05.md` |
| E5.4 Listing | app-store-pack e2e covers legal/marketing routes locally | `app-store-pack.spec.ts` |

## Operator-reported items — carried OPEN (per goal instruction)

| Item | Web-layer status | What remains OPEN |
|---|---|---|
| Unauthenticated installed-app open shows login window | ✔ built + santa-complete on branch (g-31c59158, `signin-gate.spec.ts`) | Behavioral device confirmation impossible until a build serves this branch; Production lacks SignInGate entirely (verified absent at 6ec5e5d) |
| Background issue | web analog pinned (g-b07c73bc: resume stability + deferred-swap-on-hidden) | True WKWebView suspension — attended checklist items 5–6 |
| Oversized top/safe-area region | web layer contributes zero top inset (pinned) | Real status-bar inset rendering — checklist items 3–4 |
| Wonky scrolling | autohide + resume + overflow pins | Touch momentum/rubber-band feel — checklist item 7 |

## Dedup declarations (goal requirement)

- Extends completed audit `g-0182f313` (social quality) and Phase A
  `g-4a0f81a5` (honest signed-out `/u/[handle]`).
- Does **not** duplicate planned Phase B `g-c8b26779` (public-profile opt-in,
  share management, auth return) — its scope appears here only as gaps.
- Crews / invited Night Outs live entirely in
  `docs/PACKET-CREWS-ARCHITECTURE-2026-08-05.md`.

## The short list that gates beta

1. Write-path Staging acceptance has never run (all social writes unproven
   off-localhost).
2. Nothing on this branch is deployed; device verification is structurally
   blocked until an ADR-C build or a release.
3. Crews/invited Night Outs and Close Friends are absent, not partial.
4. Concurrent/stale states are the systematically uncovered acceptance
   states across every social row.
5. Persistent async votes + poll register + lock (E1.4 remainder) are the
   biggest built-feature gap inside an otherwise-shipped epic.
