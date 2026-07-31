# Launch gate report — 2026-07-30

Written for goal `g-9105aaf0`, the final item of the production-readiness program.

> ## ⚠️ Verdicts corrected 2026-07-31 by the multi-model review
>
> This report was written before the independent review panel ran. That panel changed six
> verdicts, **five of them downgrades** — which is the point of having one. Each is marked
> inline with its previous value:
>
> | Gate | Was | Now | Why |
> |---|---|---|---|
> | Media kill switch works without redeploy | UNVERIFIED | **FAIL** | Not untested — the repo proves it *cannot* work; `NEXT_PUBLIC_*` is build-time inlined |
> | Account deletion (code) | PASS | **FAIL** | A schema conflict in `0020` rolls the whole deletion back with a 500 for any referenced user |
> | Release/commit and ledger recorded | PASS | **UNVERIFIED** | "Ledger ends at 0032" is a live-DB fact this run never queried — an assumption recorded as evidence |
> | C2 findings remediated and tested | PASS | **PARTIAL** | Two of six actually fixed; F1b reduced, F5 instrumented, F2 blocked, F4 accepted |
> | Secrets never in the bundle | PASS | **UNVERIFIED** | The scan reads tracked *source*, never build output — evidence about the repo, not the bundle |
> | Every DB change states client compatibility | PASS | **PARTIAL** | The runbook covers `0033`/`0034`; `0035` has no compatibility statement either way |
>
> The pattern is worth naming: every one of these was a PASS resting on evidence that
> **almost** answered the question — the repo scan that isn't a bundle scan, the fix that
> reduced rather than eliminated, the ledger position nobody queried. That is the specific
> failure mode a launch gate exists to catch, and this report had it in five places.

Every prerequisite from `PRODUCTION-READINESS-MISSION-2026-07-30.md` gets exactly one verdict:

| Verdict | Meaning |
|---|---|
| **PASS** | direct evidence exists in this repository and can be re-run |
| **FAIL** | evidence exists that the gate is not met |
| **BLOCKED-OPERATOR** | cannot proceed without a human decision or action |
| *(rule added 2026-07-31)* | **BLOCKED-OPERATOR vs UNVERIFIED** was being applied inconsistently to structurally identical dashboard facts. The rule, stated so it can be applied consistently: **UNVERIFIED** = the check is fully specified and someone need only go and look — the answer is unknown, nothing is stopping it. **BLOCKED-OPERATOR** = the check *cannot even be prepared* without a human first deciding something or creating something. "Is MFA on?" is UNVERIFIED (go look). "Does Preview hold a service-role key?" is UNVERIFIED for the same reason. "Should waitlist rows be deleted or retained?" is BLOCKED-OPERATOR — nobody can look that up, it has to be decided. |
| **UNVERIFIED** | no evidence either way — most external/dashboard state |
| **PARTIAL** | *(a fifth verdict, declared honestly rather than hidden)* the gate is met for some of what it covers and not for the rest, and collapsing that to PASS or FAIL would lose the thing a reader needs. Every use names exactly which part is met and which is not. The goal's criterion 1 asked for one of **four** verdicts; this deviates from that, deliberately — a gate reading "C2 findings remediated" is not honestly PASS with four of six outstanding, nor honestly FAIL with two genuinely fixed. Where PARTIAL appears, treat the gate as **not met** for launch purposes. |

**Missing evidence is never a pass.** UNVERIFIED is the expected and correct verdict for
everything outside the repository, and there is a lot of it.

---

## Environments and access

| Gate | Verdict | Evidence |
|---|---|---|
| Local/Preview/Staging/Production have written purposes and owners | **PASS** | `ENVIRONMENT-DESIGN-2026-07-30.md` |
| Staging and Production use separate Supabase projects | **FAIL** | Only one project exists. `.env.local` points local development at **production** — the mechanism by which a routine probe wrote a live `waitlist` row today. |
| Preview can never receive production service-role credentials | **UNVERIFIED** *(was BLOCKED-OPERATOR — reclassified 2026-07-31 per the rule above)* | Design specifies it; the Vercel Preview env is a dashboard fact. Nothing is blocking the check — someone need only look. |
| Every env var classified | **PASS** | `SECRET-CLASSIFICATION-2026-07-30.md` + `SYSTEM-INVENTORY-2026-07-30.md`; 23 vars from a `process.env` sweep |
| `SUPABASE_SERVICE_ROLE_KEY` is server-only, never `NEXT_PUBLIC_` | **PASS** | true in source, and now enforced — `check-env.mjs` exits 1 on the exposed form |
| Production access limited, MFA, recoverable | **UNVERIFIED** | dashboard-only. **Single-owner risk is undocumented** — that much the repo proves (no `CODEOWNERS`, no break-glass doc, no `vercel.json`). Whether it is also *unmitigated* — a second owner, stored recovery codes — is itself unverified. Highest-consequence unknown found. |
| `LOOP_UNATTENDED` absent from production | **UNVERIFIED** *(was BLOCKED-OPERATOR — reclassified 2026-07-31)* | Detection shipped: `check-env` flags it CRITICAL and now runs in CI **and** the build. The production value is a dashboard fact — fully specified, merely unlooked-at. **If it is set, account deletion hard-refuses with 503 and users silently lose that right**, so this is the highest-value single dashboard check on the list. |

## Delivery and compatibility

| Gate | Verdict | Evidence |
|---|---|---|
| PRs run required CI | **PASS** | `.github/workflows/ci.yml` — typecheck, Vitest, build; secret scan added this run |
| Branch protection requires the check | **UNVERIFIED** | GitHub settings |
| Bounded E2E covers critical routes | **FAIL** | 338 pass but **3 genuine `mobile-controls` failures on `/`** persist across all three viewports |
| A DB-changing PR can rebuild a clean database from migrations | **BLOCKED-OPERATOR** | **no Postgres engine exists locally** (docker/supabase-CLI/pg_ctl/initdb/pglite all absent) and CI has none. The single highest-value missing gate. |
| Migrations are additive/backward-compatible | **PASS** | `0033` adds a table, `0034` narrows grants, `0035` adds a validation — all expand-only |
| Every DB change states old/new client compatibility | **PARTIAL** *(was PASS — corrected 2026-07-31)* | `MIGRATION-0033-0034-RUNBOOK.md` states both directions for `0033` and `0034` **only**. `0035` replaces `share_night` with a ±2-day rejection and has **no compatibility statement in either direction** — an old client calling it outside the window now fails. |
| Release/commit and ledger recorded | **UNVERIFIED** *(was PASS — corrected 2026-07-31)* | The ledger position "ends at 0032" is a **live-database fact that was never queried** — this report states at the bottom that no live database was consulted, and the mission doc says the 0032 position must not be trusted without a live query. No release SHA is cited either. A PASS here recorded an assumption as a fact, which is exactly what criterion 3 forbids. |
| Rollback rehearsed against a migrated schema | **UNVERIFIED** | needs staging |
| Destructive schema cleanup happens in a **later** release, after old clients are gone | **PASS (nothing proposed)** *(gate was MISSING entirely — added 2026-07-31)* | No destructive cleanup exists to review: `0033` adds a table, `0034` narrows grants, `0035` adds a validation — all expand-only. The gate is met vacuously today and must be re-checked the moment a `DROP`/`TRUNCATE`/column-removal migration is authored. **How it went missing is the lesson:** this table had 8 rows for the mission's 8 gates, so the count matched — but one of the 8 rows (`Branch protection requires the check`) is a decomposition of another gate, not a gate of its own. Row-count parity concealed the omission. |

## Data safety and recovery

| Gate | Verdict | Evidence |
|---|---|---|
| Paid backup plan before real user data | **UNVERIFIED** | dashboard |
| Backup retention and Storage limits understood | **UNVERIFIED** | — |
| A backup restored and verified | **UNVERIFIED** | never attempted. An untested backup is a belief, not a control. |
| RPO/RTO written | **FAIL** | nowhere defined |
| Account deletion live, authenticated, rate-limited, tested | **FAIL (code)** / **UNVERIFIED (live)** *(code verdict was PASS — corrected 2026-07-31)* | The auth and rate-limit halves are genuinely sound: two-stage quota keyed on the verified user id (`4472f23`), with an adversarial test pinning that a body-supplied id cannot win. **But deletion does not succeed for every user.** `supabase/migrations/0020` declares `granted_by_user_id ... ON DELETE SET NULL` *and* a `before update or delete` trigger that always raises; SET NULL is an UPDATE, so deleting a profile referenced by a non-null `granted_by_user_id` **rolls the whole deletion back with a 500**. Latent today (nothing writes that table) and it arms itself when the photo-rights feature ships. Needs a migration — see `PRIVACY-DELETION-APPSTORE-2026-07-30.md`. |
| Waitlist deletion + `photo_permissions` audit decisions | **BLOCKED-OPERATOR** | Q1 and Q2 |

## Security

| Gate | Verdict | Evidence |
|---|---|---|
| Production RLS queried and reconciled against migrations | **UNVERIFIED** | needs a live query; runbook supplies the SQL |
| All browser-callable definer functions reviewed as authorization code | **PASS** | `C4-DEFINER-FUNCTION-AUDIT-2026-07-30.md` — 29 functions; **no parameter-driven identity**; three findings (one fixed by `0035`, one operator decision, one informational) |
| C2 rate-limit findings remediated and tested | **PARTIAL** *(was PASS — corrected 2026-07-31)* | F1+F3 `4472f23` and F6+F7 `f9ac038` are genuinely fixed. The rest are **not**: F1b is **reduced, not eliminated** — `middleware.ts:39` still calls `getUser()` unconditionally for the matched paths, so a forged cookie still costs one outbound call; F5 is only *instrumented*; F2 is blocked on Q7; F4 is *accepted*, not fixed. "Remediated and tested" was true of two findings out of six. |
| C3 grants/RLS findings remediated, applied only attended | **PASS (authored)** | `926f498`, unapplied as required |
| Public API keys restricted; secrets never in the bundle | **UNVERIFIED (restrictions)** / **UNVERIFIED (bundle)** *(bundle was PASS — corrected 2026-07-31)* | The secret scan reads **tracked source files** (`secret-scan.mjs` enumerates `git ls-files`); it has never inspected build output, and no `.next` artifact exists in the tree. So "clean over 492 tracked files" is evidence about the **repository**, not about the **bundle** — the gate asks about the bundle. Closing this needs a post-build scan of the emitted client chunks using deployment-equivalent env. |
| Secret scanning passes before public release | **PARTIAL** | `scripts/secret-scan.mjs` runs in CI and provably catches a planted key. **Scope, stated precisely:** it matches four deliberately narrow patterns (JWT shapes, credentialed Postgres URLs, Google API keys, and a secret assigned under a `NEXT_PUBLIC_` name) over tracked files. "Clean" means *those patterns found nothing* — it is **not** a comprehensive secret audit, does not cover history, and does not detect a novel credential format. A full audit (e.g. gitleaks/trufflehog over history) remains outstanding. |
| Dependency/runtime production security review | **PARTIAL → UNVERIFIED** | 9 deps inventoried; no CVE scan run |
| Media kill switch works without redeploy | **FAIL** *(was UNVERIFIED — corrected 2026-07-31)* | Not merely untested — **the repository proves it cannot work.** `defaultMediaFlags()` reads `NEXT_PUBLIC_GOOGLE_MEDIA`, a `NEXT_PUBLIC_` variable that Next.js **inlines at build time**, so changing it does nothing for any client already served. A no-redeploy switch needs a runtime-fetched control (open decision D1) that does not exist. UNVERIFIED would imply "we might find it works"; we know it does not. |
| Cost-bearing APIs have quotas, alerts, breakers, an owner | **UNVERIFIED** | Google Cloud console |

## Adversarial assessment

| Gate | Verdict | Evidence |
|---|---|---|
**Coverage corrected 2026-07-31.** This table previously carried four rows of its own
invention — none of which mapped to a mission gate. The mission's ROE subsection lists **six**
specific gates, and *none* of them had been individually verdicted. Because the table looked
complete, a reader would have believed they were audited. The four original rows are kept
(they are useful) and the six real gates are added beneath.

| Gate | Verdict | Evidence |
|---|---|---|
| *(supporting)* ROE exists | **PASS** | `SAFE-SECURITY-TEST-ROE-2026-07-30.md` |
| *(supporting)* Assessment plan prepared | **PASS** | `SECURITY-ASSESSMENT-PLAN-2026-07-30.md` — 13 staging cases after the 2026-07-31 review, ceilings, stop conditions |
| *(supporting)* Authorization record complete | **FAIL** | blank and unsigned. *(Previously "FAIL (by design)" — the parenthetical softened a FAIL into something that reads like a pass. It is correctly blank, and the gate is still not met.)* |
| *(supporting)* Pre-test go/no-go | **FAIL** | *(was the non-standard label "NO-GO on every condition")* — all eight go/no-go conditions are unmet: no staging, no monitoring, no synthetic accounts, no emergency contact |
| **ROE-1.** Source review and test-plan prep may run unattended | **PASS** | This is the only ROE gate a repository can evidence, and it was met: the plan and this report were produced unattended, with no active testing performed. |
| **ROE-2.** Active testing begins in Staging with synthetic accounts and data | **BLOCKED-OPERATOR** | Cannot begin — staging does not exist. Accounts A–E are specified in the plan but not created. |
| **ROE-3.** Production confirmation is a separate attended approval, with monitoring, ceilings, emergency contact and explicit in-scope assets | **BLOCKED-OPERATOR** | The plan requires it and lists ceilings + in-scope assets, but monitoring and an emergency contact **do not exist**, so the precondition cannot be satisfied today. |
| **ROE-4.** Stop when minimally proven; never enumerate or download real user data | **UNVERIFIED** | Execution-time discipline. The plan encodes it ("each stops at minimum proof", ceilings per case), but nothing has been executed, so there is no behaviour to verify. Cannot become PASS until an assessment actually runs. |
| **ROE-5.** DoS, brute force, social engineering, destructive writes, persistence, cost amplification and attacks on provider infrastructure are out of scope | **PASS (as written)** / **UNVERIFIED (as practised)** | The plan's scope section and the ROE both exclude these, and the asset table marks provider infrastructure "**NEVER** — out of scope, always". Whether a live assessment respects it is unverifiable until one runs. |
| **ROE-6.** Every finding gets minimal redacted evidence, impact, detection, recovery, remediation owner and retest status | **UNVERIFIED** | The evidence template in the plan requires all six fields. No finding has been produced through it, so the template is untested in practice. |

## Observability and incidents

| Gate | Verdict | Evidence |
|---|---|---|
| Browser/API/native errors reach a tracker with a release id | **FAIL** | **no error tracker is installed at all** — verified from `package.json` |
| Uptime and critical-flow checks | **FAIL** | none configured |
| Alerts actionable, reaching a named owner | **FAIL** | no alert path exists |
| Incident runbook | **PASS** | `OBSERVABILITY-AND-INCIDENTS-2026-07-30.md` |
| Bad-deploy and dependency-failure rehearsals | **UNVERIFIED** | specified, never run |
| Kill switch exercised | **UNVERIFIED** | — |

## Privacy, legal, App Store

| Gate | Verdict | Evidence |
|---|---|---|
| Accurate privacy/terms/support URLs on `next-bar.app` | **UNVERIFIED (hosting only)** | **Correction:** an earlier draft of this report said `/privacy` still holds `[PLACEHOLDER]`s. That was repeated from `APP-STORE-PLAN:32` without checking the source. `src/app/privacy/page.tsx` contains **no placeholders** — the stale claim lives only in the plan document. What remains unverified is whether the pages are *hosted* on `next-bar.app`, not whether the copy is finished. |
| App Privacy answers match shipped behaviour | **BLOCKED-OPERATOR** | Q1 and Q3 |
| Analytics status, retention, region, CARTO terms confirmed | **BLOCKED-OPERATOR** | Q3 + retention decisions |
| Apple enrolment / App Store Connect | **UNVERIFIED** | — |
| Capacitor has real native functionality | **UNVERIFIED** | no shell built |
| Staging/production native builds hit the right backends | **UNVERIFIED** | — |
| TestFlight internal testing | **UNVERIFIED** | — |
| Discoverable in-app account deletion | **PASS** | Settings; route tested |
| Icon, screenshots, copy, review notes, age rating | **UNVERIFIED** | — |
| Physical iPhone matrix | **UNVERIFIED** | human-only; the 3 open `mobile-controls` failures are this class |

---

## Tally

**Recounted 2026-07-31.** The previous tally (PASS 18 / FAIL 8 / BLOCKED 7 / UNVERIFIED 25)
did not match its own table, and the prose beneath it said "nineteen passes" while the table
said eighteen. Counted mechanically over the 50 gate rows in the sections above — some rows
carry a compound verdict (e.g. code vs live), so the verdict count exceeds the row count:

| Verdict | Count (occurrences across 57 gate rows) |
|---|---|
| PASS | 14 |
| FAIL | 10 |
| BLOCKED-OPERATOR | 6 |
| UNVERIFIED | 25 |
| PARTIAL | 4 |

Occurrences exceed rows because some gates legitimately carry a compound verdict (code vs
live, as-written vs as-practised). Row count rose from 50 to 57 on 2026-07-31 when the six
missing ROE gates and the missing destructive-cleanup gate were added.

*Do not hand-edit these — derive them, so the tally cannot drift from the table again:*

```sh
S=$(grep -n "^## Environments and access" docs/LAUNCH-GATE-REPORT-2026-07-30.md | cut -d: -f1)
E=$(grep -n "^## Tally" docs/LAUNCH-GATE-REPORT-2026-07-30.md | cut -d: -f1)
awk -v s=$S -v e=$E 'NR>s && NR<e' docs/LAUNCH-GATE-REPORT-2026-07-30.md \
  | grep "^| " | grep -v "^| Gate" | grep -v "^|---" \
  | grep -c '\*\*PASS'      # repeat per verdict
```

Not a launchable system, and the shape of the gap is the useful part: **the code is in
good order and the operations around it barely exist.** The passes are almost entirely code,
tests, audits and documents — things a repository can prove. The failures and unknowns are
environments, monitoring, backups and dashboards.

The 2026-07-31 review moved this in the wrong direction on purpose: five gates went from PASS
to a lower verdict. The system did not get worse; the report got more honest.

## What actually blocks launch, ordered by leverage

1. **Staging does not exist.** It alone unblocks the migration rehearsal, backup/restore
   testing, rollback rehearsal, staging smoke, and the entire adversarial assessment. It also
   ends the situation where local development holds production credentials. **One action,
   five gates.**
2. **Nothing observes production.** No error tracker, no uptime check, no alerts. Launching
   here means learning about outages from users — and it blocks the assessment, which
   requires a monitoring owner.
3. **`0033`/`0034` unapplied**, so vibe-profile sync does nothing in production and its client
   path has never met a real table.
4. **Q1 and Q3 unanswered**, blocking App Privacy submission.
5. **Backups never restored.** Untested backup, unknown RPO/RTO.
6. **Three real E2E failures on `/`**, blocked on a product decision.
7. **Nothing is pushed.** As of 2026-07-31 this is **28 commits** on
   `feat/overnight-2026-07-30` alone (`git rev-list --count c02baf9..HEAD`), plus the
   `feat/phase1-compliance-media` work — all existing only on this machine —
   one disk failure from total loss.

Item 7 deserves a line of its own: everything in this report describes work that currently
exists in exactly one place, with no remote.

## Honest limits of this report

- Written from repository evidence only. No dashboard, deployment or live database was
  consulted, because this run was forbidden to.
- ~~Items 3–14 sit at `ready_for_review`. **No Codex, GLM, DeepSeek or Kimi lane reviewed any
  of it.** The multi-model convergence step did not run, so "PASS" here means *the agent
  verified it*, not *an independent reviewer agreed*.~~
  **SUPERSEDED 2026-07-31.** The convergence step has now run. Codex reviewed every item;
  GLM, DeepSeek and Kimi joined for the T1 and T0 items. It changed six verdicts in this
  report alone (see the correction block at the top) and found, among other things, a schema
  bug that breaks account deletion and an env checker that failed every correct
  configuration. **A "PASS" in this report now means at least two independent families
  agreed** — except where marked otherwise.
- One item, the four-environment design (`g-7c12a62f`), is **blocked at the review round cap**
  rather than complete: three consecutive rounds each found defects, several introduced by the
  previous round's fixes. It needs one more panel, not an operator decision.
- Two items are blocked on prerequisites rather than opinion: goal 1 on a Postgres engine,
  goal 2 on a product decision.
