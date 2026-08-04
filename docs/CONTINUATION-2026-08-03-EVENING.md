# CONTINUATION — 2026-08-03 EVENING attended session (Next Bar)

> **THIRD-WAVE UPDATE (operator-driven, ~21:00–21:30 ET).** With the
> operator directing live:
> - **Apple resources now EXIST (operator-created):** App ID
>   `com.nextbar.app` registered; App Store Connect app record "Next Bar"
>   created; Admin API key generated; all four GitHub secrets set and
>   verified (`gh secret list`: APPLE_TEAM_ID, ASC_ISSUER_ID, ASC_KEY_ID,
>   ASC_KEY_P8_BASE64).
> - **PR #91 MERGED** (squash `7cc7fea`): the wrapper-origin work is on
>   origin/main. **PR #92 MERGED** (squash `1514420`): workflow Node
>   20→24 (first-ever dispatch proved the #90 workflow had never run —
>   Capacitor CLI 8 requires Node ≥22).
> - Lock was disarmed ONLY for these operator-approved remote actions and
>   re-armed after each.
> - The ios project's existing AppIcon verified compliant (decoded:
>   1024×1024, colorType 2, no alpha) — first build NOT blocked on the
>   operator's separate Codex icon-artwork work (land that as its own PR).
> - **First real TestFlight dispatch IN FLIGHT** at update time:
>   `server_url=https://next-bar-two.vercel.app` (pre-DNS override).
>   3 internal testers planned (incl. operator).
> - Local nb-ios worktree: DIVERGED from origin/main by design (3
>   pre-squash commits + operator's uncommitted `.gitignore` edit +
>   Package.swift EOL noise). Do NOT reset --hard (would destroy the
>   uncommitted edit); reconcile next session by stashing the .gitignore
>   edit first.
> - Still open for the operator: DNS cutover (then blank-input canonical
>   build), Users-and-Access invites for the other 2 testers, Internal
>   Testing group creation once the build processes.

> **SECOND-WAVE UPDATE (same session, ~20:10 ET), supersedes §3's SHA
> block.** After the first handoff the operator directed three things
> (saved to harness memory `operator-priorities-testflight-social`):
> patch the wrapper host on main + prep the internal build; prioritize
> SOCIAL-FEATURE quality; next-bar.com is canonical everywhere. Executed:
>
> - **g-59f8cc16 COMPLETE (nb-ios worktree, LOCAL main):** wrapper origin
>   is config-driven, defaults https://next-bar.com, CAP_SERVER_URL
>   override (validated: credential-free https origin-only, normalized,
>   legible errors), workflow `server_url` dispatch input, errorPath
>   offline fallback actually wired (latent since PR #90), runbook
>   updated incl. external-groups ban for remote-origin builds. Commits
>   on LOCAL main: `666710c`, `2a18f71`, `127dcae` — **NOT pushed**; 3
>   review rounds (Fable APPROVE ×3, Codex clean ×2 + 4 verified MEDs
>   fixed). Operator steps to first internal build: approve+push these 3
>   main commits, verify ASC_* secrets, dispatch ios-testflight.yml
>   (blank input = canonical; pre-DNS: server_url=<current live host>),
>   INTERNAL TestFlight group only.
> - **g-0182f313 COMPLETE:** social quality audit
>   (`docs/SOCIAL-QUALITY-AUDIT-g-0182f313-2026-08-03.md`, commit
>   `d266df2`). Social e2e bundle 107/107 (+2 known skips). One CRITICAL
>   viral-loop gap found; solid elsewhere (unshare privacy verified to
>   SQL; consensus races; canonical links need no code change).
> - **g-4a0f81a5 COMPLETE (Phase A):** honest signed-out /u/[handle]
>   state (no more false "not on Next Bar" for real handles), the missing
>   signed-out e2e, ShareNightButton ref guard. Commits `046b36a`,
>   `7a86d94`; 2 rounds (Fable APPROVE ×2, Codex 1 MED fixed then clean).
> - **NEW QUEUED GOAL — social hardening Phase B (attended migration
>   session):** apply 0015 + settings opt-in + wire fetchPublicRatings;
>   author+apply list_my_shared_nights; apply 0035; share→unshare→visit
>   round-trip e2e; validated ?next= return path through /auth.
>
> **Final overnight-branch state: local HEAD `7a86d94`, 12 outgoing
> commits** (§3's list + `d266df2`, `046b36a`, `7a86d94`, and `5dcab5f`
> itself). **nb-ios main: local HEAD `127dcae`, 3 outgoing.** Origin tips
> unchanged (`edd9d8f` / `ebbcd55`). Vitest 1948/1948; the operator's
> Fable-reviewer directive is standing policy.

Supersedes `docs/CONTINUATION-2026-08-03.md` (the afternoon record) as the
system of record. Reconciled against live git, the goal store (workspace
`9c928dacfabc5299`), the lease registry, the lock, and recorded test/review
evidence at write time (2026-08-03 ~19:00 ET). Session: attended six-hour
pre-TestFlight block, started 16:00 ET.

## 1. Completed this session (store status `complete`, panel-reviewed)

| Goal | Title | Commits | Review |
|---|---|---|---|
| g-90f908bc | Fix the `/` mobile-controls e2e trio (was blocked since 7/31) | `276a258`, `4b3977d`, `0c8e62a` | 3 rounds; final: Opus APPROVE @ `0c8e62a`, Codex clean (proof fb14b12e). Round-1 panel: Opus+Codex gating, GLM+DeepSeek advisory. |
| g-39169b3b | T0: internal-TestFlight architecture + preflight readiness (NEW this session) | `7676fef`, `88c486d`, `06c90d8` | T0 panel: **Fable** APPROVE @ `88c486d` and scoped APPROVE @ `06c90d8`; Codex clean (proof 1f28c66d); Kimi K3 deep specialist (refinements folded in §10 of the ADR); Opus informational. |

**What the mobile-controls fix actually is:** the failing spec was RIGHT —
the pinned sticky search bar covered whichever card rested under it. The bar
now auto-hides on scroll-down and reveals on scroll-up/near-top/focus
(`src/lib/searchBarAutoHide.ts`, opt-in prop, `/` call site only). No e2e
assertion weakened; new discriminating spec `e2e/search-autohide.spec.ts`
(proven RED pre-fix, runs on all three device projects incl. iPhone 17).

**What the TestFlight packet is:** `docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b-2026-08-03.md`
(ADR + readiness reconciliation + operator checklist) and
`npm run preflight:testflight` (deterministic local gate; verified full run
13 pass / 3 known-gap warn / 0 fail at `88c486d`+).

## 2. HEADLINE DISCOVERY the operator must adjudicate

**origin/main already contains a merged iOS Capacitor wrapper** — `ebbcd55`
(PR #90, 2026-08-02): `capacitor.config.ts` with **committed Bundle ID
`com.nextbar.app`** and **`server.url` hard-coded to the OLD host
(next-bar-two…)**, a 26-file `ios/` project, and a manual-dispatch macOS
fastlane TestFlight workflow using ASC_* GitHub secrets. NOT on this branch.
Official Capacitor docs (fetched 2026-08-03): `server.url` is a live-reload
feature, "not intended for use in production." The reviewed ADR: reject as
release architecture; acceptable ONLY as internal dogfood after the stale
host is patched; target = locally-packaged assets + hosted APIs + PKCE
deep-link auth (PKCE must land BEFORE local packaging); native geolocation
bridge is the cheapest genuine 4.2 preemption. Unknown (attended check
needed): GitHub secrets configured? workflow ever run? IPA/ASC record exist?

## 3. Exact SHAs

- Branch `feat/overnight-2026-07-30`; **local HEAD `06c90d8`**.
- **Origin tip unchanged: `edd9d8f`** — NOTHING pushed this session.
- **8 outgoing local-only commits:** `a5ad62b`, `f4264aa` (pre-session) +
  `276a258`, `4b3977d`, `0c8e62a`, `7676fef`, `88c486d`, `06c90d8`.
- **Staging unchanged:** `edd9d8f…` (deployment `…5vv0oz6ox…`); deployment
  URL confirmed live this session (SSO-protected 302; body verification
  needs credentials — none used).
- Push/deploy of any of this requires fresh operator approval after
  reviewing the exact outgoing list above.

## 4. Test evidence at final source state (`0c8e62a` source / `06c90d8` docs)

- vitest **1946/1946**; `tsc --noEmit` clean; `next build` clean;
  `git diff --check` clean; secret scan clean (via preflight).
- Playwright full matrix by project shards: iPhone 13 122+121, Pixel 7
  123+124, iPhone 17 **79** (search-autohide added to its testMatch),
  Desktop 21. mobile-controls + search-autohide additionally 55/55 ×2
  repeats. **ZERO new failures.**
- Three **pre-existing/environment** failure classes, each evidenced at
  pre-diff HEAD via checkout-aside control runs (do NOT attribute to this
  session's diffs):
  1. `vibe-tweak-reachable` MapFilterSheet pair on /map — parallel-load
     contention; fails in shard context (3/3 at clean HEAD), passes
     isolated.
  2. `phase1-compliance` catalog-cap — **staging DB serves only [411,411]
     rows to anon** (needs >1000). Environment regression outside this
     branch; also note main's #89 fixed a PostgREST truncation and #88/#87
     grew the catalog — reconcile during integration.
  3. `bias-smoke` — documented contention flake (passed on retry).
  Related latent finding: with the 411-row geometry, a card can rest under
  the BottomNav raised tab ("covered by NEXT BAR? pill", seen once on
  iPhone 13) — the g-2c788c17 clearance class, NOT caused by the auto-hide
  change (opacity-only diff; reproduced ONLY under swapped-catalog
  geometry).

## 5. Operator decisions needed (exact next actions)

1. **#90 wrapper adjudication** (§2 above + ADR §9.1–.3): dogfood-now-with-
   host-patch vs hold; confirm Bundle ID `com.nextbar.app`; attended check
   of secrets/workflow/ASC state.
2. **B1** production `SUPABASE_SERVICE_ROLE_KEY` repair (submission-
   blocking: deletion route dark).
3. **Privacy labels Q1** (waitlist deletion) + **Q3** (analytics answer).
4. **Domain/DNS + mailbox** (DOMAIN-PREP packet items 1 & 5) → then swap
   the six `hi@next-bar.app` mailtos.
5. **/support route**: build (needs mailbox decision) or designate
   /install.
6. **1024×1024 no-alpha icon**: approve generating from the brand glyph
   (agent-executable after approval; preflight validates it once present).
7. **g-4ed5f834 numeric ranking** — answer the 3 questions in
   `docs/DESIGN-NUMERIC-RANKING-g-4ed5f834-2026-08-03.md`.
8. **Sign-out wipe scope**; **/search reachability** (6th-tab advisory);
   **cleanup packet** (superseded deployments + 8 synthetic bars rows) —
   unchanged from the afternoon record.
9. **Staging DB 411-row anomaly** (§4.2): decide whether staging data was
   intentionally pruned or needs repair before the phase1-compliance spec
   can pass again.

## 6. Blocked/queued goals (unchanged unless noted)

g-31f36bf8 (Pin where I am, T0-auth), g-e9d493e9 (night photos; 0038 draft
NEVER applied), g-35babba8 (paid photo sweep, attended, $250 cap),
`list_my_shared_nights` RPC + Close Friends schema (next migration number
after 0037), g-4ed5f834 (blocked on §5.7), g-12d33864, g-1cae785c,
g-52470455, g-7c12a62f, g-87cf2100, g-91db2f50, g-a020ae84 (reconcile vs
today's deploys rather than rerun), g-dc0588b0 (integration PR — push-
gated; NOTE: integration must now also reconcile main's #86–#90 catalog +
iOS work against this branch), g-e6067aab (worktree inventory).
Analytics/PostHog stays OFF. DNS untouched. No Apple resources exist from
this session; the #90 artifacts on main are the only native assets.

## 7. TestFlight readiness verdict

**NOT READY** for external TestFlight/App Review (blockers: B1, privacy
Q1/Q3, domain, 1024 icon, 4.2 surface, server.url architecture).
**READY WITH OPERATOR STEPS** for a first INTERNAL TestFlight dogfood
build: patch the wrapper host on main (~1h attended), confirm Bundle ID,
verify ASC secrets, dispatch the existing workflow. No iOS project exists
on THIS branch (proven); no signed IPA is known to exist anywhere
(unverifiable this session). Physical-iPhone checklist: install internal
build → cold-start offline behavior (expect stub) → geolocation prompt
behavior on / (the known iOS failure) → auth magic-link flow → share
sheet → add-to-home PWA parity comparison.

## 8. Protected operator documents — NEVER edit/stage/revert

`docs/MASTER-TODO-2026-07-30.md`, `docs/OPERATOR-BUGS-2026-07-28.md`
(modified), `docs/CTO-OPERATOR-PLAN-2026-07-31.md`,
`docs/STAGING-ACCEPTANCE-NOTES-2026-08-01.md` (untracked). Still the ONLY
dirty/untracked paths.

## 9. Session-boundary confirmation

Nothing pushed, deployed, migrated, or uploaded; Production untouched;
Staging rows untouched; no Apple resources created; analytics dark; no
paid API calls; no DNS/credential/email changes. Remote-write lock ARMED
throughout (mission's "lock absent" note was stale — 0-byte lock file +
live hook denial proven at session start; the hook also pattern-matches
words in command text: put payloads in files). Lease registry empty at
close. **Review-lane policy change (operator, this session): the fresh
Claude gating reviewer runs model FABLE going forward** (recorded in
harness memory).

## 10. Continuation prompt for the next session (copy-paste)

```
This is an attended Next Bar continuation.

Workspace: C:\Users\cdfee\projects\nb-overnight

Read CLAUDE.md and docs/CONTINUATION-2026-08-03-EVENING.md first. Treat
that file, Git history, and the stored goal system as the system of
record — not transcript memory.

Verify before any work: branch feat/overnight-2026-07-30; local HEAD
06c90d8; origin tip edd9d8f (8 outgoing commits); only the four protected
operator documents dirty; no lease; remote-write lock armed; Staging
identity edd9d8f. If anything differs, stop and report the exact
difference.

Gating reviewers: fresh Claude FABLE + Codex (T1); + mobile/security
specialist (T0). Sonnet is informational only.

Then show me: completed goals; blocked goals; the operator decision list
(section 5); and the recommended next goal. Do not create duplicate
goals. Do not push, deploy, apply migrations, create Apple resources, or
touch Production without explicit approval.
```
