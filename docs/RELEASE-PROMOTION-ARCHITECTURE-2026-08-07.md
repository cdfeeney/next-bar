# Release promotion architecture — environments, TestFlight, App Store, account continuity, rollback

**Written 2026-08-07. Base commit `b6a7957` (branch `docs/release-promotion-architecture`).**

Documentation only. **Nothing here was applied, deployed, migrated, submitted, or configured.** No
Apple, Vercel, Supabase, DNS, SMTP, email, or account action was taken, and this document authorizes
none. Every action it describes is an **attended operator** action.

## How to read the evidence labels

| Label | Meaning |
|---|---|
| **[V]** | **Verified** this session by tool-result against the repository at `b6a7957`. Cited with file:line. |
| **[A]** | **Operator-attested.** Supplied by the operator 2026-08-07. Plausible and used as input, but **not** checkable from this repository. |
| **[U]** | **Unverified — remote.** Requires access this goal is forbidden to use (Apple, Vercel, Supabase dashboards, workflow run logs). Listed, never assumed. |

A claim is never promoted from [A] or [U] to [V] by repetition. Where an older document asserts
something as settled, it is re-checked against current code before being repeated here.

---

## A. Current-state evidence

### A.1 Native shell identity and how its origin is chosen

| Fact | Evidence |
|---|---|
| Bundle identifier is `com.nextbar.app` in **both** build configurations | **[V]** `ios/App/App.xcodeproj/project.pbxproj:312,333` |
| Capacitor `appId: 'com.nextbar.app'`, `appName: 'Next Bar'` | **[V]** `capacitor.config.ts:52-53` |
| Display name is `Next Bar` | **[V]** `ios/App/App/Info.plist` (`CFBundleDisplayName`) |
| The shell's origin comes from `CAP_SERVER_URL`, **defaulting to `https://next-bar.com`** | **[V]** `capacitor.config.ts:18-19` |
| The origin is validated fail-closed: https only, credential-free, **origin only** — no path/query/fragment | **[V]** `capacitor.config.ts:29-49` |
| The **normalized** origin is what ships: `server.url = parsedOrigin.origin` | **[V]** `capacitor.config.ts:59` |
| An offline fallback shell is packaged and actually rendered on load failure (`webDir` + `errorPath`) | **[V]** `capacitor.config.ts:55,64`; `native/shell/index.html` exists |
| In-webview navigation is pinned to the built origin plus the canonical hosts | **[V]** `capacitor.config.ts:69-71` |
| The workflow takes an optional `server_url` dispatch input → `CAP_SERVER_URL`, and an empty input is unset so it cannot override the default | **[V]** `.github/workflows/ios-testflight.yml:15-18,47,50` |
| The origin is consumed at `npx cap sync ios` time — i.e. **binary build time** | **[V]** `.github/workflows/ios-testflight.yml:45-51` |
| Build number is `github.run_number` → `CURRENT_PROJECT_VERSION` | **[V]** `.github/workflows/ios-testflight.yml:66`; `fastlane/Fastfile:36` |
| Export is `app-store` method, Release configuration | **[V]** `fastlane/Fastfile:24-26` |

**The repository already forbids externalizing this design, in its own words.** `capacitor.config.ts:4-7`
states the remote-origin wrapper is an "interim remote-origin dogfood architecture" and that "this
design must never graduate to an external/App-Review build." `.github/workflows/ios-testflight.yml:10-11`
repeats it: "INTERNAL TestFlight groups only for any remote-origin build." **[V]** This is not a new
recommendation in this document; it is an existing in-repo constraint that section D upholds.

### A.2 Build 5 and Build 6 provenance

All build-level facts below are **[A]** — they come from the operator, and the artifacts live in
GitHub Actions and App Store Connect, which this goal may not read.

| | Build 5 | Build 6 |
|---|---|---|
| Workflow run | `30958647881` **[A]** | `31142679072` **[A]** |
| Native shell SHA | `6ec5e5d` **[A]** | `6ec5e5d` **[A]** |
| Runtime web SHA | not separately recorded **[A]** | `efca486` **[A]** |
| Server origin | `https://next-bar-two.vercel.app` **[A]** | `https://next-bar-staging.vercel.app` **[A]** |
| Supabase project | Production-targeting **[A]** | Staging **[A]** |
| Distribution | internal TestFlight only **[A]** | internal-only; never approved for external TestFlight or App Review **[A]** |

**Both builds share one native identity** (`com.nextbar.app`) and differ only in the origin baked at
build time. That combination is **[V]** consistent with the config and workflow above: the same
committed `appId` with a per-run `server_url` input produces exactly this shape.

**A caveat the operator's summary does not state, and which matters.** The committed default origin
at `b6a7957` is `https://next-bar.com` **[V]** (`capacitor.config.ts:19`). Neither Build 5 nor Build 6
used it, so both must have passed an explicit `server_url` **[A]**. Any future build dispatched with
a blank input will target `next-bar.com` — which is only correct once that DNS resolves to the
intended deployment **[U]**.

### A.3 What is server-backed versus origin-scoped

This is the crux of the account-visibility incident, and it is fully verifiable locally.

- **Server-backed:** anything in Supabase — `auth.users`, and the tables the migrations define.
  Reached via `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` **[V]**
  (`src/lib/supabase/client.ts`, `server.ts`).
- **Origin-scoped browser storage:** **31 distinct `next-bar:*` localStorage keys** **[V]** (counted
  across `src/`), including `next-bar:lists:v1`, `next-bar:night-log:v1`, `next-bar:night-archive:v1`,
  `next-bar:pairwise:v1`, `next-bar:profile:v1`, and the `next-bar:account-content:*` family.

Browser storage is partitioned **per origin**. A WKWebView pointed at origin X cannot read storage
written at origin Y. That is a platform rule, not an app bug.

- **Migration `0042_account_content_state.sql` exists** and is precisely the fix for this: it is the
  "durable, cross-device write-through copy" of stores "the browser keeps ... in its existing
  synchronous localStorage" **[V]** (`supabase/migrations/0042_account_content_state.sql:1-6`). It
  applies cleanly directly after 0036 and has no dependency on the absent 0037–0041 **[V]** (same
  file, lines 8-12). It is **not authorized for Production** **[A]**.

### A.4 Why an account "disappeared" — the mechanism, stated precisely

**[V] mechanism + [A] specifics.** Build 5 and Build 6 are the same app identity pointed at different
origins, and each origin's web deployment carries its own Supabase project configuration. Therefore a
tester moving from Build 5 to Build 6 experiences **two simultaneous switches**:

1. **Identity world switch** — a different Supabase project means a different `auth.users` table.
   An account that exists in Production does not exist in Staging. **[A]** that the affected
   tester's account is in Production and not Staging.
2. **Local content switch** — a different origin means all 31 localStorage keys are a fresh,
   empty partition. **[V]**

**No user or row was deleted.** Nothing in the repository performs such a deletion as part of a build
or deploy, and none was authorized **[A]**. The data became *unreachable from that build*, which is a
different thing and is fully reversible by pointing a build back at the original origin. Proving the
Production rows are still present requires Supabase access this goal may not use — **[U]**, and it is
listed in section G as an attended check.

---

## B. Target environment matrix

Bundle IDs marked *(proposed)* do not exist yet — see section D.3 and backlog G.1.

| | Local | Preview | Staging web | Internal TestFlight | External TestFlight | App Store candidate | Production |
|---|---|---|---|---|---|---|---|
| **Web origin** | `localhost:3000` | Vercel preview URL | Staging host | Staging host | Production host | Production host | `next-bar.com` |
| **Supabase project** | local / Staging | Staging | Staging | Staging | **Production** | **Production** | **Production** |
| **Account class** | throwaway dev | throwaway dev | seeded testers | seeded testers | **real** | **real** | **real** |
| **Allowed data** | synthetic | synthetic | synthetic + seeded | synthetic + seeded | real user data | real user data | real user data |
| **Bundle ID / display name** | n/a | n/a | n/a | `com.nextbar.app.internal` / "Next Bar INT" *(proposed)* | `com.nextbar.app` / "Next Bar" | `com.nextbar.app` / "Next Bar" | n/a |
| **Deployment authority** | developer | CI on push | CI on merge | attended dispatch | attended | attended | **attended only** |
| **Credential scope** | local `.env.local` | Preview env | Staging env | baked origin only | baked origin only | baked origin only | Production env |
| **Permitted testers** | developer | developer | internal | internal only | invited external | Apple review | public |
| **Visual environment indicator** | dev banner | preview banner | **required** Staging banner | **required** + distinct icon/name | none | none | none |
| **Rollback method** | git | redeploy | redeploy previous | dispatch prior build | expire build | pull from review | **instant redeploy to prior immutable deployment** |

The "required" indicators do not exist yet — backlog **G.2**.

### B.1 "Should the app always point at Production?" — the explicit answer

**No — and also, for anything a non-employee can install, yes.** The question conflates two
populations, and the correct answer differs:

- **Any build reachable by an external tester or the public** — external TestFlight, App Review, App
  Store — **must** target Production. An external user's account, purchases, and content must live in
  the real system. Pointing such a build anywhere else means real people create real accounts in a
  disposable database.
- **Internal dogfood builds must be able to target Staging.** That is the entire value of Staging:
  rehearsing destructive changes (migrations, auth template changes, data backfills) against a system
  where being wrong is cheap. Forcing internal builds onto Production removes the only safe rehearsal
  surface and makes every migration a first-run-in-production event.

**The real defect is not which environment a build points at — it is that both share one bundle ID.**
With a single `com.nextbar.app` **[V]**, a device can hold only one of them. Moving a tester between
Staging and Production builds therefore silently swaps both their identity world and their 31 local
keys, with no visual signal and no warning. That is exactly the observed incident. Section D.3 fixes
it by separating identities, not by banning Staging.

---

## C. Promotion model — six independent lanes

**The central rule:** *promoting Staging to Production means promoting the **code and the schema
change**, never the data.* "Promote Staging to Production" must **never** mean copying the Staging
database, Staging `auth.users`, or any mutable Staging row into Production. Staging user rows are
synthetic; Production rows are real people. Copying in either direction destroys real data or
manufactures fake accounts. No script in this repository does this, and none should be written.

| Lane | What actually moves | Direction | Gate |
|---|---|---|---|
| **1. Web code / artifact** | an **immutable deployment** built from one commit SHA | Staging → Production | Staging green + release gate |
| **2. Database migrations** | forward-only SQL files, applied in lexical order | Staging → Production | rehearsed on Staging; backup taken |
| **3. Native binary** | a new `.ipa` from a dispatched workflow run | build → TestFlight → App Store | **the only way to change origin or bundle ID** |
| **4. Environment configuration** | env vars and dashboard settings — **not in git** | set per environment, never copied | attended; see C.1 |
| **5. Auth templates / SMTP / redirects** | dashboard config | set per project, never copied | attended, per project |
| **6. Users and account-owned data** | **nothing. Ever.** | — | — |

Migration mechanics are already sound: `scripts/apply-migrations.ts` hashes each file into
`public.schema_migrations`, so an applied migration is skipped by checksum and an edited-after-apply
file is reported as drift **[V]** (`CLAUDE.md`, "Database migrations"). A guard already exists —
`NEXT_BAR_DATABASE_ENVIRONMENT` and `NEXT_BAR_PRODUCTION_PROJECT_REF` **[V]**
(`scripts/apply-migrations.ts:118,121`; `scripts/lib/catalogBootstrap.ts:113,136`) — which refuses
bootstrap unless the environment is explicitly staging/development and fails closed when the
production project ref is unset.

### C.1 The sharp edge: environment configuration can retarget a build, and code promotion cannot

These two are constantly conflated, and the distinction is the whole answer to objective question 3.

- Promoting **web code** to an origin changes *what that origin serves*. It cannot change *which
  origin a binary loads*. **[V]** — see D.1.
- Changing **environment configuration** at an origin — specifically `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` on that Vercel project **[V]** (`src/lib/supabase/client.ts`,
  `server.ts`) — **does** change which Supabase project every installed build pointed at that origin
  talks to, with **no new binary and no App Store involvement**.

So: an installed Build 6 cannot be moved to Production by shipping web code, but it *could* be moved
there by editing the Staging Vercel project's environment variables. That is a one-field change with
production blast radius, invisible in git history, and it is why lane 4 is a separate lane with its
own attended gate rather than a footnote of lane 1. **Never repoint a Staging origin at the
Production Supabase project** — stand up a correctly-configured Production build instead.

---

## D. Recommended native architecture

### D.1 Proof: Build 6 cannot be retargeted by promoting web code (objective question 3, AC 4)

The chain is fully verifiable in this repository:

1. The workflow reads the dispatch input into the environment: `CAP_SERVER_URL: ${{ inputs.server_url }}`
   **[V]** `.github/workflows/ios-testflight.yml:47`.
2. It then runs `npx cap sync ios` with that variable set **[V]** lines 50-51.
3. `capacitor.config.ts` reads `process.env.CAP_SERVER_URL` **at config-load time**, i.e. during that
   sync, and resolves a single origin **[V]** lines 18-19.
4. That resolved origin is written into `server.url` **[V]** line 59, and `cap sync` copies it into
   the native iOS project, which is then compiled and signed into the `.ipa`.

**Therefore the origin is a compile-time constant of the binary.** There is no runtime lookup, no
remote config, and no over-the-air origin switch anywhere in the config **[V]**. Nothing a web
deployment can do reaches it — a web deploy changes bytes served *at* an origin, while the origin
itself is already frozen inside the installed app.

**Corollary:** retargeting Build 6 requires **a new native binary from a new workflow run, uploaded
and installed** — or, as C.1 warns, an environment-configuration change at the origin it already
points to, which is a different and far more dangerous lever.

### D.2 The three candidate architectures

| | Remote-origin `server.url` *(current)* | Bundled web assets | Controlled hybrid |
|---|---|---|---|
| Web updates without resubmission | yes | no | yes, for the bundled layer |
| Works offline | fallback shell only **[V]** `capacitor.config.ts:55,64` | yes | partly |
| App Review risk | **high** — see D.3 | low | medium |
| Rollback of web layer | instant (redeploy origin) | requires new binary | mixed |
| Session/cookie behavior | ordinary web cookies on one origin | app-local | mixed |
| Origin-scoped storage | **strands on origin change** **[V]** (31 keys) | stable | needs explicit migration |
| Deep links | must match the baked origin **[V]** `capacitor.config.ts:69-71` | app-controlled | app-controlled |

**A constraint that rules out the simple version of "bundle everything."** This app cannot be
statically exported: there are **8 server route handlers** under `src/app` **[V]**, an active
`src/middleware.ts` **[V]**, and 3 dynamic route segments **[V]**, and `next.config` sets no
`output: 'export'` **[V]**. `/auth/confirm` and `/auth/callback` are *server* routes that must run
somewhere. So "bundled web assets" can only ever mean *bundling the client shell while continuing to
call a hosted API* — not shipping the whole application inside the binary. Any plan that assumes
otherwise is wrong.

### D.3 Decision

**Keep the remote-origin wrapper for internal use only. Do not ship it externally.** This upholds the
constraint the repository already states in two places **[V]** (`capacitor.config.ts:4-7`,
`.github/workflows/ios-testflight.yml:10-11`) rather than inventing a new policy.

**Separate native bundle identities are required (objective question 4, AC 7).** Recommended:

| | Internal | Public |
|---|---|---|
| Bundle ID | `com.nextbar.app.internal` *(proposed)* | `com.nextbar.app` **[V]** today |
| Display name | "Next Bar INT" *(proposed)* | "Next Bar" **[V]** |
| Icon | visibly distinct *(proposed)* | current |
| Origin | Staging, via `server_url` | Production |
| ASC record | separate | existing |
| Distribution | internal group only | external / App Store |

Rationale, in order of force: (1) both builds can then coexist on one device, so a tester is never
*moved* between environments — the incident in A.4 becomes structurally impossible; (2) the
environment is visible on the home screen instead of inferred; (3) the internal app can keep the
remote-origin architecture the repo forbids externally while the public app uses a compliant one;
(4) entitlements, deep-link domains, and push credentials stay scoped per environment.

**The App Store-safe replacement (objective question 5, AC 8).** The public build must not be a thin
wrapper whose only content is a remote website — that is the Apple 4.2 "minimum functionality" risk
this repo already flags **[V]**. The graduation path:

1. Register the separate internal bundle ID and move all current dogfood builds onto it. The public
   `com.nextbar.app` record then never carries a remote-origin build again.
2. Land **0042** so account content is server-backed (D.4/E) — this is a **prerequisite**, not a
   parallel track.
3. Build the public app as a Capacitor app with **bundled client assets** plus a hosted API, per
   D.2's constraint, so first paint and offline behavior come from the binary rather than the network.
4. Add genuine native capability (push, share, offline reading of saved lists) so the app is not a
   website in a frame.
5. Set deep-link domains and entitlements per bundle ID.
6. Only then submit for external TestFlight / Beta App Review.

Whether any specific form satisfies Apple review is **[U]** — it depends on Apple's judgment and
cannot be settled from this repository. Steps 1–5 reduce the risk; they do not guarantee approval,
and this document does not claim they do.

### D.4 Why 0042 gates the whole native plan

Any origin change strands 31 origin-scoped keys **[V]**. `0042_account_content_state.sql` converts
that content into account-owned server state **[V]**. Until it is applied and the write-through path
is live, *every* origin change — internal→public, Staging→Production, or a DNS cutover to
`next-bar.com` — silently discards local content. **0042 must land before any origin change reaches
real users.**

---

## E. Account and cache continuity

**E.1 Existing Production users into the App Store build.** They need no migration *provided* the
public build points at Production and keeps bundle ID `com.nextbar.app` **[V]**. Their identity lives
in Production `auth.users`; their password and session are unchanged. What they *can* lose is
origin-scoped local content if the public origin differs from the one they used — mitigated only by
0042 (D.4).

**E.2 Staging tester provisioning.** Create Staging accounts explicitly in the Staging project. Never
copy Production users in. Testers install the *internal* bundle (D.3) and hold both apps at once.

**E.3 Why Staging and Production passwords and UUIDs stay independent.** They are separate Supabase
projects with separate `auth.users` tables **[A]**. A user's UUID is that project's primary key;
the same person has unrelated UUIDs in each, and every foreign key is scoped to one project.
Synchronizing them would mean copying credential material between a disposable system and a real one
— forbidden by lane 6. They must diverge.

**E.4 Safeguards against apparent deletion (AC 6).** Ranked:

1. **Separate bundle IDs** (D.3) — the structural fix; a tester is never silently moved.
2. **Visible environment indicator** in-app and on the icon, so "my account is gone" is immediately
   legible as "this is the Staging app."
3. **Never repoint an origin's Supabase configuration** (C.1).
4. **A fail-closed account-preservation gate** before any Production deploy or migration: record the
   Production account count and a saved-content sample beforehand, re-check after, and **stop and roll
   back on any unexplained decrease**. Fail closed — an unavailable count blocks the release rather
   than passing it.
5. **Never claim data loss without checking.** A.4's mechanism explains invisibility; it is not
   deletion, and the two must not be conflated in user communication.

**E.5 Local cache inventory before any origin change.** The 31 keys **[V]** are the inventory. Before
an origin change reaches users: land 0042; confirm write-through covers the `next-bar:lists:*`,
`next-bar:night-log/archive:*`, `next-bar:pairwise:*`, and `next-bar:profile:*` families; and provide
an export path for anything still local-only. Anything not server-backed at cutover is lost —
say so plainly rather than discovering it afterwards.

**E.6 Upgrade / downgrade / reinstall / build-switch expectations.**

| Action | Server-backed data | Origin-scoped local data |
|---|---|---|
| Upgrade within one bundle + origin | preserved | preserved |
| Downgrade to an earlier build, same origin | preserved | preserved (schema-permitting) |
| **Reinstall** | preserved (re-login) | **lost** — iOS deletes the container |
| **Switch to a build with a different origin** | *invisible*, not lost | **inaccessible** |

Rows 3 and 4 are the user-visible cliffs, and both are only softened by 0042.

---

## F. Exact release sequence — attended, numbered

Each step names its gate. A failed gate **stops the sequence**; it does not downgrade to a warning.

1. **Freeze an immutable candidate.** One commit SHA. Record it. Every later artifact refers to this
   SHA, never to "latest".
2. **Local verification.** Typecheck, full unit suite, production build, secret scan, Playwright on
   both mobile projects. *Gate: all green.*
3. **Deploy the candidate to Staging web.** *Gate: deployment ID recorded and immutable.*
4. **Rehearse the migration on Staging.** Apply the packet with `npm run db:migrate`; confirm the
   ledger records it and reports no drift **[V]**. *Gate: clean apply + rehearsed rollback.*
5. **Staging functional verification**, including the attended cross-container auth flow that has
   never been run **[A]**: request a reset in the internal build, open the link in Mail/Safari, land
   signed in. *Gate: observed, not inferred.*
6. **Record the Production revert point.** Current deployment ID, current migration head, and a fresh
   database backup. *Gate: backup verified restorable — an unverified backup is not a revert point.*
7. **Record the Production account-preservation baseline** (E.4.4). *Gate: baseline captured.*
8. **Apply the migration to Production** in a quiet window. *Gate: ledger clean; no drift.*
9. **Deploy the candidate to Production web.** *Gate: health path fresher than the deploy.*
10. **Post-deploy smoke check — authoritative.** Load a real listing; sign in; confirm saved content.
    Re-check the account baseline from step 7. *Gate: pass, or roll back to step 6 first and diagnose
    second.*
11. **Internal TestFlight acceptance** on the internal bundle against Staging, and on the public
    bundle against Production. *Gate: both accepted.*
12. **Backward compatibility with installed shells.** Confirm the oldest installed native build still
    functions against the new Production web — its origin is frozen **[V]** (D.1), so a breaking web
    change strands it. *Gate: confirmed.*
13. **External Beta App Review** for the public bundle only, after D.3 steps 1–5. *Gate: approved.*
14. **App Store submission.** *Gate: approved.*
15. **Post-release smoke + monitoring window.** Watch `auth.confirm.failure` diagnostics
    (`docs/AUTH-EMAIL-TEMPLATES-2026-08-06.md`, "Reading the server logs") for a template or auth
    regression.

**Rollback / roll-forward decision points.** Web: roll back immediately (cheap, instant). Database:
prefer roll *forward* with a corrective migration — a down-migration on live data risks more than it
fixes; restore from step 6 only for genuine corruption. Native: expire the build and dispatch a new
one; there is no instant native rollback. Configuration: revert the single field. **Never** roll back
by moving data between environments.

---

## G. Follow-up backlog

| # | Item | Priority | Attended-only |
|---|---|---|---|
| G.1 | Separate internal bundle ID + ASC record (`com.nextbar.app.internal`) | **P0** | yes (Apple) |
| G.2 | Visible Staging labeling — distinct icon, display name, in-app banner | **P0** | no (code) |
| G.3 | Production account-preservation gate (E.4.4) wired into the release runbook | **P0** | partly |
| G.4 | Land 0042 on Staging, verify write-through, then Production — prerequisite for any origin change (D.4) | **P0** | yes |
| G.5 | Native-shell graduation to bundled client assets + hosted API (D.3) | **P1** | partly |
| G.6 | Local-cache export / origin-migration path for anything 0042 does not cover (E.5) | **P1** | no |
| G.7 | Password-recovery Staging template activation + attended cross-container device test (step 5) | **P1** | yes |
| G.8 | Tester provisioning controls — Staging accounts created explicitly, never copied (E.2) | **P1** | yes |
| G.9 | Canonical promotion scripts + CI gates enforcing the six lanes of section C | **P1** | no |
| G.10 | Full Production release rehearsal against a restored copy | **P2** | yes |
| G.11 | Confirm `next-bar.com` DNS before any build using the default origin (A.2) | **P2** | yes |
| G.12 | Verify Production rows are intact (A.4 **[U]**) | **P2** | yes |

---

## H. Stale and contradictory prior documents (objective question 10, AC 10)

Checked against current code rather than repeated. **This list is not exhaustive** — 19 release/
environment documents exist in `docs/` and only the load-bearing claims were re-verified.

| Document | Claim | Status |
|---|---|---|
| `TESTFLIGHT-ARCH-DECISION-g-39169b3b-2026-08-03.md` | `server.url` is `https://next-bar-two.vercel.app` | **STALE.** The committed default at `b6a7957` is `https://next-bar.com` **[V]** `capacitor.config.ts:19`. The doc's *architectural* conclusion — remote-origin is internal-only — remains correct and is upheld here. |
| `CONTINUATION-2026-08-03-EVENING.md` | no iOS project exists | **STALE**, and already corrected by the 2026-08-03 decision doc, which found the wrapper on `origin/main`. |
| Six documents referencing `next-bar-two` as the current origin | current origin | **STALE as "current"**, accurate as history. Treat every `next-bar-two` reference as a past state. |
| Various docs referencing `next-bar.app` | canonical domain | **Superseded** — canonical is `next-bar.com`. |
| The support-mailbox `mailto:` links in `src/app/{privacy,terms,settings}` (7 occurrences, on the older domain) | contact address | **NOT stale — deliberate.** The 2026-08-03 decision explicitly scoped its cleanup to "no *non-mailto* next-bar.app refs in src" and deliberately kept the registrar mailbox. Verified before reporting **[V]**; flagged here only because it *looks* like staleness and must not be "fixed" by someone who skips that check. |
| Operator summary, 2026-08-07 | Build 5/6 provenance | **Not independently verifiable** — recorded **[A]**. The *mechanism* it describes is **[V]** (A.4). |

**A meta-finding.** Several of these documents were written as authoritative and then contradicted by
later repository changes without being amended. Documents in `docs/` are snapshots, not live state.
This document will be stale too — its verifiable anchors are the file:line citations, which can be
re-checked, not its prose.

---

## I. Answers to the ten objective questions — index

1. Environment targeting → **B**, with the explicit "always Production?" answer in **B.1**.
2. What is actually promoted → **C** (six lanes).
3. Can promoting web code retarget a build? **No** — proof in **D.1**; the *configuration* lever that
   can is in **C.1**.
4. Separate bundle IDs / names / assets / entitlements? **Yes** — **D.3**.
5. Graduation path for the wrapper → **D.3**.
6. Accounts, testers, UUIDs, caches without copying Production data → **E.1–E.3**, lane 6 in **C**.
7. Changing origin without stranding local data → **D.4**, **E.5**.
8. Independent rollback per lane → **F** (decision points) and **B** (per-environment method).
9. Exact ordering → **F**.
10. Stale or contradictory documents → **H**.

## J. Scope statement

No remote action was taken or authorized. No Production migration, deployment, environment change,
template or SMTP change, TestFlight action, account operation, or external release is approved by
this document. Every **[U]** item requires attended access. Independent review is a separate,
operator-initiated step.
