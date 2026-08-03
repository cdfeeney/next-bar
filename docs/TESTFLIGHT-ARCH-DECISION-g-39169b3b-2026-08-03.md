# Internal-TestFlight architecture decision + preflight readiness — g-39169b3b (2026-08-03)

T0 packet. Everything here is local documentation + local tooling; no Apple
resource, deploy, migration, DNS, credential, or analytics change was made.
Every repository fact below was verified by tool-result this session
(2026-08-03, attended). Canonical domain: **next-bar.com** (next-bar.app is
STALE everywhere it appears).

## 0. THE HEADLINE DISCOVERY — an iOS wrapper already exists on origin/main

The mission brief and TESTFLIGHT-READINESS-2026-08-02 both said no iOS
project existed. **That is no longer true.** Verified 2026-08-03:

- `origin/main` commit `ebbcd55` — *"feat: [T1] iOS TestFlight wrapper via
  Capacitor + cloud Mac CI (#90)"*, merged 2026-08-02 15:33 ET (checked out
  in the `nb-ios` worktree, branch `main`).
- It contains: `capacitor.config.ts`, a tracked `ios/` directory (26 files:
  `App/`, `capacitor-cordova-ios-plugins`, xcconfig), `native/shell/index.html`
  (offline fallback), and `.github/workflows/ios-testflight.yml`
  (manual-dispatch macOS-15 job: `cap sync ios` → fastlane `ios beta` →
  TestFlight upload using `ASC_KEY_*`/`APPLE_TEAM_ID` GitHub secrets).
- `capacitor.config.ts` sets **`appId: 'com.nextbar.app'`** — a Bundle ID IS
  committed on main — and
  **`server.url: 'https://next-bar-two.vercel.app'`** with
  `allowNavigation: ['next-bar-two.vercel.app']`.
- This overnight branch (`feat/overnight-2026-07-30`) does NOT contain
  ebbcd55 (`git merge-base --is-ancestor` → not an ancestor of HEAD).

**Unverifiable from this machine this session** (remote-write lock arms the
no-gh/no-network policy; Apple dashboards are attended-only): whether the
GitHub secrets are configured, whether the workflow has ever run, whether a
signed IPA or App Store Connect app record exists. Treat all four as
UNKNOWN, not absent.

### Why the merged wrapper is NOT a shippable release architecture

Official Capacitor documentation (capacitorjs.com/docs/config, fetched
2026-08-03) says of `server.url`: it is *"intended for use with live-reload
servers"* and — verbatim — **"This is not intended for use in production."**
The same caveat applies to `allowNavigation`. The merged wrapper is exactly
that design. Concrete consequences beyond the doc warning:

- The shell hard-codes `next-bar-two.vercel.app` — the OLD deployment host,
  not next-bar.com; shipping it would freeze the wrong origin into a store
  binary and make the later DNS cutover a forced app re-release.
- A remote-origin webview is the thinnest possible wrapper under Apple
  guideline 4.2 ("minimum functionality") — the highest-rejection-risk shape.
- Offline behavior is a static fallback page, not the app.
- Environment separation is impossible per-binary: the binary IS whatever
  the remote host serves; there is no fail-closed staging/production split.

**Conclusion: PR #90 is a legitimate CI/scaffold skeleton (the workflow,
fastlane lane, and ios/ project structure are reusable), but its
`server.url` release design must be replaced before any external release,
and ideally before the first internal TestFlight build that Apple reviewers
could ever see.** For a purely internal TestFlight group, App Review does
not gate builds (internal testing needs no review), so the wrapper may be
*acceptable as a dogfood vehicle* — but it must never graduate.

## 1. Readiness reconciliation (corrects TESTFLIGHT-READINESS-2026-08-02)

| # | Item | 2026-08-02 said | Verified now (2026-08-03) |
|---|------|-----------------|---------------------------|
| 1 | Production build | PASS | Still PASS — `npm run build` exit 0 today (this branch). |
| 2 | Manifest 192 icon defect | FAIL sub-item | **FIXED** — c77428d (g-fb7b9f28, 2026-08-02) generates genuine 192×192 AND 512×512 via `generateImageMetadata` in `src/app/icon.tsx`, with decoded-PNG dimension tests (`e2e/manifest-icons.spec.ts`, `e2e/helpers/png.ts`, `src/app/manifest.test.ts`). |
| 3 | Service worker | PASS | Unchanged (`public/sw.js`). |
| 4 | Privacy labels Q1/Q3 | FAIL (open) | Still OPEN — waitlist deletion path (Q1) and analytics posture (Q3) remain operator decisions. Unchanged this session by design. |
| 5 | Account deletion (5.1.1(v)) | OPERATOR-BLOCKED | Unchanged — code path done; production `SUPABASE_SERVICE_ROLE_KEY` still invalid (B1); attended repair required. |
| 6 | Build-path decision | "documented, Capacitor recommended" | **SUPERSEDED by this ADR** — see §2. The old plan's remote-origin note is now known to be production-unsuitable per official docs. |
| 7 | 4.2 native surface | FAIL (needs shell first) | Shell now EXISTS on main (ebbcd55) but with zero native plugins — the 4.2 gap is unchanged in substance; see §5. |
| 8 | Apple Developer enrollment | OPERATOR-BLOCKED | **ACTIVE** — operator confirmed enrollment active (mission, 2026-08-03). |
| 9 | Certs/profiles | OPERATOR-BLOCKED | Still operator-owned; the merged workflow expects App Store Connect API-key secrets (names only: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8_BASE64, APPLE_TEAM_ID) — configured-or-not is UNKNOWN (unverifiable this session). |
| 10 | ASC app record + TestFlight group | OPERATOR-BLOCKED | UNKNOWN — may exist if the operator ran the #90 flow; verify attended. |
| 11 | Binary upload | OPERATOR-BLOCKED | UNKNOWN — same. |

Additional corrections to stale evidence:
- **Canonical domain is next-bar.com** (operator, 2026-08-03). APP-STORE-PLAN
  updated this session; `docs/APP-STORE-METADATA-DRAFT-2026-08-03.md` already
  uses next-bar.com.
- **A 1024×1024 no-alpha App Store icon does NOT exist** (no 1024 asset
  anywhere in the repo; `icon.tsx` renders 192/512; `apple-icon.tsx` renders
  180). This is a real submission gap — small, deterministic to fix later
  from the same brand glyph, needs no Apple access.
- `/privacy` and `/terms` routes exist; **`/support` does NOT exist**. The
  metadata draft's support URL assumes it (or /install as fallback).
- The six user-facing `hi@next-bar.app` mailtos (privacy ×1, terms ×1,
  settings ×2, plus copy references) are UNCHANGED pending the operator's
  mailbox decision (domain packet item 1) — deliberately not swapped.

## 2. Architecture decision record

Options compared for "Next Bar as an iOS app users install":

| Option | Preserves current functionality? | Windows-safe part | Verdict |
|---|---|---|---|
| **A. Remote-origin Capacitor shell** (what #90 merged: `server.url` → live site) | Yes 1:1 (it IS the site) | Everything except the Mac build | **REJECT for release** — Capacitor docs: "not intended for use in production"; hard-coded stale host; thinnest 4.2 shape; no per-binary env isolation. Acceptable ONLY as a short-lived internal dogfood vehicle. |
| **B. Locally packaged Capacitor web assets** (bundle a static export in the shell) | **No, not today** — the app depends on server surfaces (see §3): 4 API routes incl. account deletion + waitlist, `auth/callback` route, per-route `generateMetadata`, edge-runtime OG/icon image routes. `next export`-style static packaging would break auth callback and API-backed flows unless they are re-pointed at a hosted API origin. | All of it (npm build, cap sync) | Viable END-STATE only after C's refactor; not a shortcut. |
| **C. Native shell with explicit responsibilities** (Capacitor shell ships the UI as local assets; ALL data/auth goes to hosted next-bar.com APIs via absolute URLs; auth uses in-app browser callback or PKCE deep-link) | Yes, with bounded refactor: client code already talks to Supabase directly for most data (the API routes are narrow); auth callback needs a deep-link/universal-link flow; OG/metadata surfaces stay web-only (irrelevant inside the app) | UI refactor, config, tests all Windows-safe; only the signed build needs a Mac | **RECOMMENDED TARGET.** This is the architecture that satisfies Apple 4.2 (real native surface, §5), works offline-first, and gives per-binary env isolation (staging binary → staging API origin, fail-closed). |
| **D. PWABuilder packaging** | Same limits as A (it wraps the hosted PWA) | All (it's a web service + Windows tooling) | Fallback probe only; same 4.2 exposure; keep as experiment, not the plan. |
| **E. React Native / Expo rebuild** | No (full rewrite) | Development yes; builds via EAS cloud | v2 option; months of work; not a launch path. |

**Decision: adopt C as the release architecture; use the #90 skeleton (ios/
project + fastlane + workflow) as the build/CI substrate; treat A strictly as
the interim internal-dogfood vehicle with a hard graduation gate.** PWABuilder
(D) stays a fallback probe. B becomes C's packaging detail once the refactor
lands. This supersedes APP-STORE-PLAN's "remote origin" note.

### Migration path A → C (incremental, each step Windows-safe until the build)

1. Re-point the wrapper at a config-driven origin (kill the hard-coded
   vercel host) and gate `server.url` usage to dev builds only.
2. Introduce `NEXT_PUBLIC_API_ORIGIN` so client data paths work from a
   non-web origin (capacitor://localhost) — absolute Supabase URLs already do.
3. Auth: adopt Supabase PKCE flow with an app deep link (requires the
   Bundle-ID/universal-link decision — operator gate).
4. Package the UI as local assets (`webDir` = real build output; drop
   `server.url` from release config entirely).
5. Add the native-value surface (§5) behind the same shell.

## 3. SSR/API/auth dependency inventory (why "just export static" fails today)

Verified against `src/app/` this session:

- **API routes (need a server):** `api/account/delete` (Apple-mandated
  deletion; service-role, bearer self-deletion), `api/event` (dark analytics
  sink, OFF), `api/health` (deploy identity), `api/waitlist`.
- **Auth:** `auth/callback/route.ts` — server route completing Supabase
  auth; client builds callbacks from `window.location.origin` (inherits
  whatever host it runs on — this is what makes the deep-link change in §2
  step 3 necessary and sufficient).
- **Edge-runtime image routes:** `icon.tsx`, `apple-icon.tsx`, and five
  `opengraph-image.tsx` routes (root, `join`, `share/[barId]`,
  `u/[handle]`, `u/[handle]/night/[shareId]`) — web-only concerns; a
  native shell does not need them.
- **Dynamic metadata:** per-route `generateMetadata` incl. param-derived
  `/u/[handle]` and `/share/[barId]` — web/SEO surface, not needed in-shell.
- **Middleware:** `src/middleware.ts` exists (server-side).
- **Client data:** bars catalog + ratings/social flows talk to Supabase from
  the client (`NEXT_PUBLIC_SUPABASE_*`), which works from any origin — the
  main reason option C is a bounded refactor, not a rewrite.

## 4. Windows vs cloud-Mac responsibilities

**Operator can do on Windows (with this repo):** everything in §2's
migration path except signing/building; all web work; capacitor config +
`npx cap sync ios` (generates/updates the ios project deterministically);
icon/asset generation; the preflight command (§6); PWABuilder packaging.

**Requires cloud Mac (already scaffolded by #90):** `xcodebuild`/fastlane
signing + IPA + TestFlight upload via `.github/workflows/ios-testflight.yml`
(macOS-15 runner, manual dispatch). Codemagic remains an alternative. No
local Mac is assumed anywhere.

## 5. Apple guideline 4.2 native-value strategy (honest version)

No plugin list guarantees approval; 4.2 is a judgment call on whether the
app feels like an app. Ranked by real user value for THIS product:

1. **Native share sheet** (bar/night sharing already exists as web share —
   `@capacitor/share` makes it reliable in-shell) — real value, trivial.
2. **Location permission UX** — the wrapper's webview geolocation prompts
   are exactly the "iOS never asks" failure documented in LocationAccessHelp;
   `@capacitor/geolocation` with proper NSLocationWhenInUse strings is a
   genuine fix, not decoration.
3. **Haptics** on rating/pick interactions — cheap, appropriate for the
   product's tactile rating UX.
4. **Universal links** (next-bar.com/share/* opening in-app) — needs the
   apple-app-site-association + Team ID; operator-gated; high value for the
   share loop.
5. **App shortcuts** (Where next? / Rank last night) — cheap, real.
6. **Push (APNs)** — the 0009 scaffolding exists server-side; highest value
   long-term (RSVP/suggestion pings) but the largest scope; phase after
   internal TestFlight.
Offline-capable UI from option C is itself the strongest 4.2 argument.

## 6. Deterministic local preflight — `npm run preflight:testflight`

Implemented this session: `scripts/preflight-testflight.mjs` (see file for
per-check docs). Local/static only — no network, no paid APIs, no mutation.
Checks: typecheck; production build; manifest field + icon-entry
correctness; decoded 192/512 icon dimensions via the existing vitest suite;
1024×1024 no-alpha App Store icon (decoded when present; reported as a gap
while absent); privacy/terms/support route presence (support = known gap);
canonical-identity hygiene (no non-mailto next-bar.app refs in src;
siteIdentity resolves next-bar.com when NEXT_PUBLIC_SITE_URL says so);
staging/production isolation (production project ref must not appear in
.env.local/.env.example/src — checked without printing any env values);
analytics dark (no posthog dependency; `NEXT_PUBLIC_ANALYTICS`/POSTHOG flags
not enabled in committed env files); committed-secret scan (pattern-based,
tracked text files); native-config validation when a `capacitor.config.*`
exists in the worktree (FAILS a release config that sets `server.url`,
flags placeholder/foreign appId). Exit 0 = pass (gaps listed as WARN);
exit 1 = hard failure. `--quick` skips typecheck+build.

## 7. Environment isolation & rollback/kill-switch

- **Web (today):** staging and production are separate Vercel projects with
  separate Supabase projects; production ref `nuhqlvneokucxomguxhi` must
  never appear in staging config (preflight-enforced pattern). Rollback =
  Vercel deployment ladder (proven 3× on 2026-08-03).
- **Native (target, option C):** per-binary API origin baked at build time —
  an internal-staging binary can only ever talk to staging (fail-closed);
  release binary only to next-bar.com. Never a runtime toggle.
- **Interim (option A dogfood):** the binary is whatever the remote host
  serves — that IS the kill switch (fix the web deploy, every install heals
  instantly) and also why it is not isolation at all.
- **Broken beta build kill-switch:** TestFlight builds expire naturally
  (90 days); immediate stop = App Store Connect → TestFlight → expire the
  build / remove testers from the group (operator, attended). For option A
  builds, rolling back the WEB deploy rolls back every installed shell.
  Record each build's git SHA in the build number metadata (workflow already
  stamps `BUILD_NUMBER` = run number; add the SHA — follow-up).

## 8. Bundle ID (operator-gated — recommendation only)

`com.nextbar.app` is ALREADY committed on main (#90). It was not approved
through this session's gate, and Apple registration state is unknown.
**Recommendation: keep `com.nextbar.app`** — conventional reverse-DNS of the
brand, and churning an ID after ASC registration is painful (bundle IDs are
immutable per app record). But: do NOT register/confirm it anywhere until
the operator explicitly confirms it attended (checklist §9). This packet
deliberately writes it into no configuration.

## 9. Remaining operator + Apple actions (ordered)

1. **Adjudicate the #90 wrapper** (this packet §0/§2): keep as internal
   dogfood vehicle with the A→C migration plan, or hold TestFlight until C.
2. **Confirm Bundle ID** `com.nextbar.app` (or replace it now, before any
   ASC record exists).
3. Attended check: GitHub secrets (ASC_*, APPLE_TEAM_ID) configured? Any
   ios-testflight.yml runs? ASC app record/TestFlight group/IPA exist?
4. **B1**: repair production `SUPABASE_SERVICE_ROLE_KEY` (unblocks the
   Apple-mandated deletion route — submission-blocking).
5. **Privacy labels Q1** (waitlist deletion path — schema decision) and
   **Q3** (analytics answer; analytics stays dark until decided).
6. Domain: buy/point next-bar.com (DNS checklist in
   DOMAIN-PREP-DECISIONS-g-b83d1c77 §5), set NEXT_PUBLIC_SITE_URL, then the
   mailbox decision → mailto swap.
7. Approve building `/support` (or designate /install as the support URL).
8. 1024×1024 no-alpha App Store icon from the brand glyph (agent-executable
   once approved; no Apple access needed).
9. TestFlight internal group + first internal build (workflow dispatch —
   operator-triggered; cloud Mac).
10. 4.2 surface (§5) before ANY external/review-visible build.

## 10. Session boundary compliance

No Apple identifier/cert/profile/record created; no push/deploy; no
migration; analytics untouched (dark); no paid API calls; no DNS/credential
changes; no scaffold created in this worktree (Bundle-ID gate unmet →
correctly out of scope). The nb-ios worktree was READ, never written.
