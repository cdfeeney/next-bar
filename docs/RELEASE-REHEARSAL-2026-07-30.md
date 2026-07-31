# Production services and release rehearsal — operator checklists

Written 2026-07-30 for goal `g-90dccd13`. **Every item is an operator action.** Nothing here
was provisioned, deployed or verified by the agent, and no item may be recorded as passing
without attended evidence.

Each row states the **proof**, not just the action. "Configured" is not evidence; the output
of a check is.

## Service setup

### Vercel
| Action | Proof required |
|---|---|
| Production project on `next-bar.app` | domain resolves and serves `/api/health` with the expected sha |
| Production env vars set | `npm run check-env --environment production` exits 0 |
| Preview env vars set **without** service-role/`DATABASE_URL` | `api/account/delete` on a preview URL returns **503**, not 200 |
| Deployment protection on preview (if wanted) | an incognito window cannot open a preview URL |
| Rollback procedure known | a rollback actually performed once in staging |

### Supabase
| Action | Proof required |
|---|---|
| Separate staging project | staging and production report different shas/refs from `/api/health` |
| Migrations `0000`→`0035` applied to staging | runner output, and `schema_migrations` ends at 0035 |
| Paid plan with backups before real user data | plan and retention visible in the dashboard |
| **Restore rehearsed** | a backup restored into a scratch project and the data checked |
| Production RLS reconciled against migrations | the verification SQL in `MIGRATION-0033-0034-RUNBOOK.md` returns the expected rows |

The restore rehearsal is the one people skip and the one that matters. An untested backup is
a belief, not a control.

### GitHub
| Action | Proof required |
|---|---|
| `main` protected, CI required | a PR cannot merge with a red check |
| Secret scan running | the new first CI step visible on a PR |

### DNS / TLS / email
| Action | Proof required |
|---|---|
| `next-bar.app` + TLS | valid certificate, canonical redirects behave |
| Supabase auth redirect allowlist per environment | a staging callback is **rejected** by production |
| Brevo DKIM/SPF on the production sender | a real signup email arrives and passes auth checks |

### Google
| Action | Proof required |
|---|---|
| Production key referrer-restricted | the key fails from an unlisted origin |
| Quota + budget alert | alert configuration visible; ideally one test breach |
| `ALLOW_GOOGLE_*_INGEST` unset in production | `check-env` output |
| Media kill switch | **This row previously claimed it "works without redeploy". It does not** — same false claim corrected in `OBSERVABILITY-AND-INCIDENTS-2026-07-30.md` on 2026-07-31. `NEXT_PUBLIC_GOOGLE_MEDIA` is a `NEXT_PUBLIC_` variable, **inlined at build time** (`src/lib/mediaPolicy.ts`), so flipping it changes nothing for any client already served. **Proof required:** set it, **redeploy**, then fetch a page and observe the media state change — the redeploy is the step, not an afterthought. The no-redeploy switch is an open design decision (D1), so this launch gate is **UNMET**, not merely untested. |

### Monitoring

Added 2026-07-31: a review found this surface was named in the goal but had **no checklist**,
appearing only as an admission further down that no alerting exists. An operator working this
document top to bottom would never be prompted to fix that before launch. The Google budget
row above covers *spend*, not application errors or uptime — it is not a substitute.

| Action | Proof required |
|---|---|
| Error tracking provisioned (browser + server) | a **deliberately thrown** test error appears in the tool, tagged with the release SHA |
| Uptime check on `/api/health` | the check's own history showing at least one successful poll, and the configured interval |
| Alert delivery proven | a test alert that **actually reached a human** — a configured alert that has never fired is not evidence |
| On-call owner named | a name, not a role. Today that is one person; see the single-owner gap in `SYSTEM-INVENTORY-2026-07-30.md`. |

**Current honest status: none of these exist — this surface is BLOCKING, not pending.**
See `OBSERVABILITY-AND-INCIDENTS-2026-07-30.md` for the design.

### Mobile (Connor is on Windows — no local `xcodebuild`)
| Action | Proof required |
|---|---|
| **1. Signing material owned and documented** *(must come FIRST)* | someone other than the build machine can rebuild. A TestFlight-bound build needs the signing identity configured **before** it can produce a distributable artifact — doing the build first yields something unusable and a wasted cycle, which is expensive precisely because there is no local Mac to retry on. |
| **2. Cloud Mac / Codemagic build** | a successful clean build from a fresh checkout |
| Staging bundle → staging backend | the app's `/api/health` shows the staging sha |
| TestFlight internal test | install on a real device and complete the core flow |

## What counts as proof

Added 2026-07-31 after a review found many items below stated an *action* with no *evidence*.
A step is only complete when it produces an artifact someone else could check:

- **Not proof:** "confirm it works", "check the dashboard", "verify nothing broke", or any
  tick an operator could make from memory.
- **Proof:** a recorded value (a SHA, a deployment id, a row count), a saved response body, a
  screenshot, or a command's verbatim output — with the time it was taken.

Where a step below cannot yet produce proof (because the environment does not exist), it says
so rather than offering a box to tick.

## Release rehearsal (run in staging, in this order)

> **Cannot be performed today.** There is no staging environment — `ENVIRONMENT-DESIGN`
> step 1 creates it. Recorded here so it is ready, and so nobody mistakes the existence of
> this list for a rehearsal having happened. **No item below may be marked done until staging
> exists.**

| # | Step | Proof required |
|---|---|---|
| 0 | **Before anything:** capture a data baseline | Row counts (or checksums) for `profiles`, `ratings`, `follows`, `shared_nights`, recorded with a timestamp. Step 7 is meaningless without this. |
| 1 | Record the current SHA and deployed artifact | The SHA **and** the Vercel deployment id, written down. "The current one" is not an identifier you can roll back to. |
| 2 | Deploy to staging | The new deployment id and its build log result. |
| 3 | Smoke the new build | The verbatim `/api/health` body showing **`supabase: "ok"`** (not merely `ok: true` — see the Production-smoke note on `unconfigured`), plus the sha, compared against the **deployment id** from step 1 rather than the sha alone. Two limits worth knowing: `/api/health` reports **no project identity**, so this proves *which build*, not *which project* — confirm the target separately; and a same-commit redeploy legitimately leaves the sha unchanged. |
| 4 | Exercise the money-adjacent path | For each of sign-in, rate a bar, share a night, delete a test account: the record id created (or deleted) and the observed result. A partial write that "seemed fine" is the failure this step exists to catch. |
| 5 | **Roll back** to the previous deployment | Source and target deployment ids, and the time. |
| 6 | Smoke the rolled-back build | The verbatim `/api/health` body showing the **old** sha. |
| 7 | Prove nothing was lost | Re-run step 0's counts and **diff them against the recorded baseline**. Equal counts, or an explained difference. Without step 0 this is unfalsifiable. |
| 8 | Prove old code is safe against the new schema | The rollback returns *code*, not the database — migrations stay applied. So confirm the **old build works against the migrated schema**: exercise step 4's flows again on the rolled-back build. This is the half a code-only rollback silently skips. |

Step 5 is the whole point. A release process that has never rolled back is a release process
with an untested half — and step 8 is the half that a code-only rollback hides.

## Production smoke (run against production, after every deploy)

The rehearsal above is staging-only and cannot run yet. **This one can, and must, run on every
production deploy** — it needs no staging environment. It deliberately mirrors rehearsal
steps 1, 3 and 4 so the two are comparable:

| # | Step | Proof required |
|---|---|---|
| 1 | Record the deployment id and SHA **before** promoting | Both values, written down. This is the revert point; "the previous one" is not an identifier. |
| 2 | Fetch `/api/health` | The verbatim body showing `ok: true`, plus the sha. **Compare the DEPLOYMENT ID from step 1, not the sha.** A same-commit redeploy — which is exactly what the media kill-switch remedy requires, since `NEXT_PUBLIC_*` needs a rebuild — produces a **new deployment id and an unchanged sha**. Rejecting a deploy because the sha did not move would fail that flow every time. The sha answers "which code"; only the deployment id answers "which deploy". |
| 3 | Confirm the backend | Same body showing **`supabase: "ok"`** — require exactly that string. Do **not** accept "not `unreachable`": the route computes `ok = supabase !== 'unreachable'` (`route.ts:73`), so a deployment missing its Supabase env vars returns `supabase: "unconfigured"`, `ok: true`, HTTP 200 — and would pass both this step and step 2 while the backend is not proven reachable at all. That is precisely the green-check-that-proves-nothing this section exists to prevent. |
| 4 | Exercise one real user path end to end | Sign in and load `/` — the record loaded, and the time. A green health check proves the process is up, not that the product works. |
| 5 | If any step fails | **Roll back first, diagnose second**, using the id from step 1. |

## Post-release review

| Question | Proof required |
|---|---|
| What did `/api/health` report immediately after deploy? | The verbatim body and the time it was fetched. |
| Did any alert fire? | **Currently unanswerable, and "no" must not be recorded.** No alerting exists in anything we control (goal 11), so "no alert fired" and "no alerting is configured" are indistinguishable. Once alerting exists: the queried time window and the notification ids, or an explicit empty result. |
| Anything in the logs that was not there before? | Provider, release SHA, time window and the exact filter used, plus the saved output. Two people querying different ranges is not a comparison. |
| Is the rollback path still one step? | Only answerable by **having just done it** — cite the deployment ids from rehearsal step 5. Answering from memory or from how the dashboard looks proves nothing about whether access still works. |

## Physical iPhone matrix — human only

No agent can produce this evidence. A person holds a phone.

**Record device + iOS version + mode for each row, with a pass/fail and a screenshot on
fail.** A prose list of surfaces is not a matrix: without recorded combinations, nobody can
tell which were actually exercised.

| Combination | Pass criterion |
|---|---|
| Compact phone (e.g. iPhone SE/13 mini), portrait | Every interactive control is fully visible and tappable — nothing hidden behind the fixed bottom nav or the home-indicator safe area |
| Large phone, portrait | Same |
| Either phone, **landscape** | Same, plus no horizontally-scrolling page body |
| Keyboard open | The focused input and its submit control both remain visible |
| Sheets and modals | Dismiss works, and dismissing does not navigate away |
| One-handed reach | Bottom navigation reachable with the thumb without shifting grip |
| Permission prompts: location, notifications, photos | Each prompt appears once, and **declining leaves a usable app** rather than a dead end |
| Safari **and** installed-PWA mode | Both, separately — they are different code paths and have regressed independently |
| TestFlight build | Core flow completes on the real build, not just the web app |

The three known `mobile-controls` failures on `/` are exactly this class of defect, and they
are still open — see `CATALOG-REFLOW-ANALYSIS-2026-07-30.md`.

## Status

**Every row above is UNVERIFIED.** The repository cannot evidence external state, and this
document existing changes nothing about the world. It becomes useful only when an operator
works through it and records the proofs.
