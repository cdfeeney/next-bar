# Launch gate report — 2026-07-30

Written for goal `g-9105aaf0`, the final item of the production-readiness program.

Every prerequisite from `PRODUCTION-READINESS-MISSION-2026-07-30.md` gets exactly one verdict:

| Verdict | Meaning |
|---|---|
| **PASS** | direct evidence exists in this repository and can be re-run |
| **FAIL** | evidence exists that the gate is not met |
| **BLOCKED-OPERATOR** | cannot proceed without a human decision or action |
| **UNVERIFIED** | no evidence either way — most external/dashboard state |

**Missing evidence is never a pass.** UNVERIFIED is the expected and correct verdict for
everything outside the repository, and there is a lot of it.

---

## Environments and access

| Gate | Verdict | Evidence |
|---|---|---|
| Local/Preview/Staging/Production have written purposes and owners | **PASS** | `ENVIRONMENT-DESIGN-2026-07-30.md` |
| Staging and Production use separate Supabase projects | **FAIL** | Only one project exists. `.env.local` points local development at **production** — the mechanism by which a routine probe wrote a live `waitlist` row today. |
| Preview can never receive production service-role credentials | **BLOCKED-OPERATOR** | Design specifies it; Vercel env state is unverifiable from here |
| Every env var classified | **PASS** | `SECRET-CLASSIFICATION-2026-07-30.md` + `SYSTEM-INVENTORY-2026-07-30.md`; 23 vars from a `process.env` sweep |
| `SUPABASE_SERVICE_ROLE_KEY` is server-only, never `NEXT_PUBLIC_` | **PASS** | true in source, and now enforced — `check-env.mjs` exits 1 on the exposed form |
| Production access limited, MFA, recoverable | **UNVERIFIED** | dashboard-only. **Single-owner risk is unmitigated and undocumented** — highest-consequence unknown found. |
| `LOOP_UNATTENDED` absent from production | **BLOCKED-OPERATOR** | detection shipped (`check-env` flags it CRITICAL); the production value is unverifiable from here |

## Delivery and compatibility

| Gate | Verdict | Evidence |
|---|---|---|
| PRs run required CI | **PASS** | `.github/workflows/ci.yml` — typecheck, Vitest, build; secret scan added this run |
| Branch protection requires the check | **UNVERIFIED** | GitHub settings |
| Bounded E2E covers critical routes | **FAIL** | 338 pass but **3 genuine `mobile-controls` failures on `/`** persist across all three viewports |
| A DB-changing PR can rebuild a clean database from migrations | **BLOCKED-OPERATOR** | **no Postgres engine exists locally** (docker/supabase-CLI/pg_ctl/initdb/pglite all absent) and CI has none. The single highest-value missing gate. |
| Migrations are additive/backward-compatible | **PASS** | `0033` adds a table, `0034` narrows grants, `0035` adds a validation — all expand-only |
| Every DB change states old/new client compatibility | **PASS** | `MIGRATION-0033-0034-RUNBOOK.md`, both directions |
| Release/commit and ledger recorded | **PASS** | ledger ends at **0032**; `0033`–`0035` authored, unapplied |
| Rollback rehearsed against a migrated schema | **UNVERIFIED** | needs staging |

## Data safety and recovery

| Gate | Verdict | Evidence |
|---|---|---|
| Paid backup plan before real user data | **UNVERIFIED** | dashboard |
| Backup retention and Storage limits understood | **UNVERIFIED** | — |
| A backup restored and verified | **UNVERIFIED** | never attempted. An untested backup is a belief, not a control. |
| RPO/RTO written | **FAIL** | nowhere defined |
| Account deletion live, authenticated, rate-limited, tested | **PASS (code)** / **UNVERIFIED (live)** | two-stage quota keyed on the verified user id (`4472f23`); adversarial test pins that a body-supplied id cannot win; never exercised against production |
| Waitlist deletion + `photo_permissions` audit decisions | **BLOCKED-OPERATOR** | Q1 and Q2 |

## Security

| Gate | Verdict | Evidence |
|---|---|---|
| Production RLS queried and reconciled against migrations | **UNVERIFIED** | needs a live query; runbook supplies the SQL |
| All browser-callable definer functions reviewed as authorization code | **PASS** | `C4-DEFINER-FUNCTION-AUDIT-2026-07-30.md` — 29 functions; **no parameter-driven identity**; three findings (one fixed by `0035`, one operator decision, one informational) |
| C2 rate-limit findings remediated and tested | **PASS** | F1+F3 `4472f23`, F6+F7 `f9ac038`, F1b `9bd3a29`, F5 instrumented; F2 blocked on Q7; F4 accepted with reasoning |
| C3 grants/RLS findings remediated, applied only attended | **PASS (authored)** | `926f498`, unapplied as required |
| Public API keys restricted; secrets never in the bundle | **UNVERIFIED (restrictions)** / **PASS (bundle)** | secret scan clean over 484 tracked files |
| Secret scanning passes before public release | **PASS** | `scripts/secret-scan.mjs` in CI; verified it catches a planted key |
| Dependency/runtime production security review | **PARTIAL → UNVERIFIED** | 9 deps inventoried; no CVE scan run |
| Media kill switch works without redeploy | **UNVERIFIED** | never exercised |
| Cost-bearing APIs have quotas, alerts, breakers, an owner | **UNVERIFIED** | Google Cloud console |

## Adversarial assessment

| Gate | Verdict | Evidence |
|---|---|---|
| ROE exists | **PASS** | `SAFE-SECURITY-TEST-ROE-2026-07-30.md` |
| Assessment plan prepared | **PASS** | `SECURITY-ASSESSMENT-PLAN-2026-07-30.md` — 10 staging cases, ceilings, stop conditions |
| Authorization record complete | **FAIL (by design)** | blank and unsigned, as required |
| Pre-test go/no-go | **NO-GO on every condition** | no staging, no monitoring, no synthetic accounts, no emergency contact |

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
| Accurate privacy/terms/support URLs on `next-bar.app` | **UNVERIFIED** | `/privacy` still holds `[PLACEHOLDER]`s per `APP-STORE-PLAN` |
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

| Verdict | Count |
|---|---|
| PASS | 19 |
| FAIL | 8 |
| BLOCKED-OPERATOR | 7 |
| UNVERIFIED | 25 |

Not a launchable system, and the shape of the gap is the useful part: **the code is in
good order and the operations around it barely exist.** Nineteen passes are almost entirely
code, tests, audits and documents — things a repository can prove. The failures and unknowns
are environments, monitoring, backups and dashboards.

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
7. **Nothing is pushed.** Fifteen commits across two branches exist only on this machine —
   one disk failure from total loss.

Item 7 deserves a line of its own: everything in this report describes work that currently
exists in exactly one place, with no remote.

## Honest limits of this report

- Written from repository evidence only. No dashboard, deployment or live database was
  consulted, because this run was forbidden to.
- Items 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 and 14 of the run sit at `ready_for_review`.
  **No Codex, GLM, DeepSeek or Kimi lane reviewed any of it.** The multi-model convergence
  step the protocol requires did not run, so "PASS" here means *the agent verified it*, not
  *an independent reviewer agreed*.
- Two items are blocked on prerequisites rather than opinion: goal 1 on a Postgres engine,
  goal 2 on a product decision.
