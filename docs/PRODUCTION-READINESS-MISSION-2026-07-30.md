# Next Bar production-readiness mission

Prepared 2026-07-30. This is the consolidated launch-safety brief for Claude
Code. It combines the remaining development queue with environment separation,
security, recovery, observability, third-party services, App Store readiness,
CTO learning artifacts, and the operator approvals required before real users
depend on Next Bar.

This document does not claim that any external dashboard setting is complete.
Repository evidence cannot prove the current state of Vercel, Supabase, GitHub,
Apple, Google, Brevo, DNS, Codemagic, or monitoring accounts. Every external
claim must be verified and recorded.

## How to run it

1. Attend the worktree and migration preflight below. Review the proposed commit
   boundaries; do not launch the loop over unexplained edits.
2. Paste the `/mission` block near the end of this document into Claude Code.
3. Let `/mission` inspect the repository, reconcile current state, create ordered
   goal IDs, and print the exact `/goal` launch command.
4. Paste the complete generated `/goal ...` command. Do not invoke
   `/overnight` by itself.
5. The unattended run may complete code, tests, audits, documentation, proposed
   migrations, and security-test preparation. It must stop at live database,
   production, credential, dashboard, and active security-testing actions.

## What “production servers stood up” means here

Next Bar is largely serverless. The launch requirement is not a rack of literal
servers; it is a verified set of isolated production services with owners,
credentials, monitoring, recovery, and cost controls.

| Service boundary | Staging requirement | Production requirement | Proof before launch |
|---|---|---|---|
| Vercel | Protected staging deployment/domain with staging variables | `next-bar.app`, production-only variables, known rollback procedure | Recorded deployment IDs, smoke result, rollback rehearsal |
| Supabase | Separate project or isolated branch, synthetic users/data | Paid production project, RLS, backups, verified credentials | Live-policy query, backup status, restore rehearsal |
| GitHub | PR checks and preview workflow | Protected `main`, required checks, controlled production deployment | Branch/ruleset screenshots or exported settings |
| DNS/TLS | `staging.next-bar.app` if used | `next-bar.app`, valid TLS, canonical redirects | DNS/TLS check and domain ownership |
| Authentication/email | Staging callbacks and non-production sender behavior | Supabase allowlist, Brevo DKIM/SPF, delivery and reset tests | Signup, magic-link/reset, and sender-auth evidence |
| Google/maps/media | Staging key and conservative quota | Production-restricted key, quota, budget alert, runtime kill switch | Restriction and alert evidence; kill-switch drill |
| Observability | Test events reach the chosen provider | Browser/server/native errors, uptime and actionable alerts | Deliberate test error and alert-delivery proof |
| Mobile builds | Staging bundle/config connected to staging | App Store bundle/config connected to production | TestFlight build metadata and physical-device checklist |
| CI/build service | Repeatable preview/staging builds | Reproducible production/TestFlight build with protected signing material | Successful clean build and documented key ownership |

Production and staging must not share databases, service-role keys, users,
storage buckets, email recipients, or cost-bearing unrestricted credentials.
No raw production user data may be copied into staging.

## Verified repository baseline

Revalidate these before relying on them because active work may have changed the
repository:

- `.github/workflows/ci.yml` runs TypeScript, Vitest, and a production build on
  pull requests and pushes to `main`.
- The repository contains `0033_vibe_profiles.sql` and
  `0034_revoke_first_grants.sql`. The reported live migration ledger ends at
  `0032`; neither file may be treated as applied without a live ledger query.
- At the 2026-07-30 inspection, the active implementation slice had eight
  modified tracked files with 299 insertions and 55 deletions, plus new route
  tests, a migration test, and migration `0034`. These changes belong to the
  current development session. Review the proposed three commit boundaries;
  never use a blanket stage command or overwrite them.
- `docs/C2-RATE-LIMIT-AUDIT-2026-07-30.md` and
  `docs/C3-RLS-AUDIT-2026-07-30.md` contain reviewed security findings.
- `docs/APP-PRIVACY-LABELS-2026-07-30.md` is the authoritative code-evidenced
  App Privacy inventory and supersedes older sketches.
- The App Store plan chooses a Capacitor shell around the remote Vercel origin,
  cloud Mac builds, TestFlight, and real native functionality.
- The repository does not by itself prove staging exists, backups can be
  restored, production RLS matches migrations, production credentials are
  valid, monitoring is connected, or dashboard controls are enabled.

## Consolidated development finish queue

This is the deduplicated queue from the continuation and the latest handoff.
Revalidate it against the current tree before changing code.

### Attended gate before downstream release claims

1. Review and commit only the known active implementation slice using the three
   proposed commit boundaries. Preserve unrelated and generated-document work.
2. Prove a clean Staging Supabase can apply the migrations in this exact order:
   `0033_vibe_profiles.sql`, then `0034_revoke_first_grants.sql`.
3. Before any Production apply, record the live ledger, backup/restore point,
   compatible app commit, forward-fix plan, monitoring owner, and Change Risk
   Brief. Confirm the old application remains compatible with both migrations.
4. Apply each Production migration only in an attended window. Verify `0033`
   before applying `0034`; stop if verification fails.
5. Run the two-browser vibe-profile smoke against the real table, verify the
   revoke/grant behavior affected by `0034`, and record sanitized evidence.

Until `0033` is applied and verified, production vibe-profile sync remains
localStorage-only and its client path has not been proven against a live table.
The overnight loop may prepare the runbook and tests, but may not apply either
migration or claim the smoke passed.

### Overnight-safe engineering queue

| Order | Work | Required outcome |
|---|---|---|
| 1 | Audit all 28 browser-callable security-definer functions (C3 F2) | Per-function authorization matrix, adversarial tests where practical, findings, fixes, and evidence. RLS is not the control boundary inside these functions. |
| 2 | Fix the `/` async catalog reflow | Resolve the three diagnosed E2E failures without re-deriving the established cause; add a focused regression test. |
| 3 | Close test debt | Cover the photo-pruner delete path, pin `isReachable`'s carousel boundary, and make an evidence-backed serial/parallel decision for `bias-smoke`. |
| 4 | Finish small validation work | Add the padded-email rejection on signup with a focused test. |
| 5 | Reconcile documents | Correct the five recorded stale claims plus the implementation and migration facts from this session. |

If product impact is the immediate priority, item 2 may run before item 1.
Otherwise the security-definer audit is the highest-value remaining security
work.

### Security findings still open

- C2 F1b: narrow the middleware matcher so a forged auth cookie cannot trigger
  an outbound Supabase call on every `/api/*` request.
- C2 F2: document and enforce the `X-Forwarded-For` trust boundary. The solution
  depends on whether the origin is directly reachable around Vercel.
- C2 F4: replace per-warm-instance counters with an appropriate shared control;
  the effective cap is currently `limit × instances`.
- C2 F5: instrument the shared `unknown` IP bucket before selecting a fix.
- C3 F1: evaluate migration from `search_path = public` to the stricter empty
  search path with fully-qualified references.
- C3 F4: resolve or explicitly retain the two unreachable `follows` policies.

### Operator questions still open

1. Does `public.waitlist` get a deletion path, or what retention policy applies?
2. Should anonymized `photo_permissions.granted_by_user_id = null` records
   survive account deletion as an audit trail?
3. Are analytics flags enabled in Production?
4. What storage and retention policy applies to night-out photos?
5. Is Playwright 1.62 retained after focused verification?
6. Is the absence of a device-to-device deletion tombstone for vibe profiles
   acceptable?
7. Can the application origin be reached directly, bypassing Vercel's edge?

Questions 1 and 3 block final App Privacy answers. Question 7 gates the durable
resolution of C2 F2.

## Launch gates

Launch is blocked until all applicable gates have evidence.

### Environments and access

- Local, Preview, Staging, and Production have written purposes and owners.
- Staging and Production use separate Supabase projects and credentials.
- Preview deployments can never receive production service-role or database
  credentials.
- Every environment variable is classified as public, server secret,
  environment-specific, owner, rotation procedure, and failure consequence.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and never uses a `NEXT_PUBLIC_`
  name.
- Production access is limited, MFA-protected, and recoverable if the primary
  owner loses access.
- `LOOP_UNATTENDED` and other harness-only variables are absent from Production.

### Delivery and compatibility

- Pull requests run required CI before merge.
- Reliable bounded E2E coverage protects critical routes and mobile controls.
- A database-changing PR can rebuild a clean database from committed migrations.
- Migrations are additive/backward-compatible unless an attended exception is
  reviewed.
- Every database change states whether old app versions work with the new
  schema and whether new code works during rollout.
- The exact release/commit and migration ledger are recorded.
- Application rollback is rehearsed against the migrated schema.
- Destructive schema cleanup occurs in a later release after old clients are no
  longer supported.

### Data safety and recovery

- Production Supabase has an appropriate paid backup plan before real user data
  matters.
- Backup retention and Storage limitations are understood and documented.
- A backup is restored into a safe non-production project and the restored data
  is verified.
- Recovery point and recovery time expectations are written.
- Account deletion is live, authenticated, rate-limited correctly, and tested
  end to end.
- Waitlist deletion/retention and the surviving anonymized
  `photo_permissions` audit record have explicit operator decisions.

### Security

- Current production RLS/policies are queried and reconciled against committed
  migrations.
- All browser-callable security-definer functions are reviewed as
  authorization code.
- C2 rate-limit findings are remediated and tested, including account-deletion
  quota poisoning and health-probe amplification.
- C3 grants/RLS findings are remediated and migrations reviewed but applied only
  attended.
- Public API keys have appropriate platform restrictions; unrestricted secrets
  never enter browser bundles.
- Secret scanning passes before public release.
- Dependencies and runtime configuration receive a production security review.
- The runtime media kill switch works without a redeploy.
- Cost-bearing APIs have quotas, alerts, circuit breakers, and an owner.

### Authorized adversarial security assessment

Next Bar may receive an attacker-minded assessment after the target and owner
are explicitly authorized. The controlling document is
[`SAFE-SECURITY-TEST-ROE-2026-07-30.md`](SAFE-SECURITY-TEST-ROE-2026-07-30.md).

- Source review and test-plan preparation may run unattended.
- Active testing begins in Staging with synthetic accounts and data.
- Production confirmation is a separate attended approval with monitoring,
  request ceilings, an emergency contact, and explicit in-scope assets.
- Stop when a weakness is minimally proven. Never enumerate or download real
  user data to determine the full extent.
- Denial-of-service, brute force, social engineering, destructive writes,
  persistence, cost amplification, and attacks on provider infrastructure are
  outside scope.
- Every finding gets minimal redacted evidence, impact, detection, recovery,
  remediation owner, and retest status.

“Stop short of damage” is a safety objective, not a guarantee. Staging-first,
default-deny scope and mandatory stop conditions are the controls that make the
risk acceptable.

### Observability and incident response

- Browser, API/server, and native crashes reach the chosen error tracker with a
  release identifier.
- Uptime and critical-flow checks cover at least health, authentication, and
  account deletion availability without exposing sensitive data.
- Alerts are actionable and reach a named owner.
- A production incident runbook covers detection, triage, mitigation,
  rollback/forward-fix, communication, and postmortem.
- A simulated bad deployment and one dependency failure are rehearsed.
- The media kill switch and other emergency controls are exercised.

### Privacy, legal, and App Store

- `next-bar.app` hosts accurate privacy, terms, support, and marketing URLs.
- App Privacy answers match shipped behavior and every enabled third-party SDK.
- Analytics enabled/disabled status, log retention, Supabase region, backup
  retention, CARTO terms, and photo/location retention are confirmed.
- Apple Developer enrollment and App Store Connect access are complete.
- Capacitor has meaningful native functionality rather than only a thin web
  wrapper.
- Staging and Production native builds use the correct backend environments.
- TestFlight internal testing passes before App Store submission.
- Account creation includes discoverable in-app account deletion.
- App icon, screenshots, listing copy, review notes, seeded reviewer path, and
  age-rating answers are ready.
- A human completes the physical iPhone matrix: compact/large phone, portrait,
  landscape, keyboard open, sheets/modals, bottom navigation, permissions,
  Safari/PWA where applicable, and TestFlight.

## Mandatory Change Risk Brief

Every consequential change gets a preliminary brief before implementation and
a final report after verification. A change is consequential if it affects
schema/data, auth/RLS/access, credentials, production configuration,
deployment, privacy, location/photos/messages, cost-bearing services,
mobile/backend compatibility, critical user journeys, high-traffic work, or
kill switches. If uncertain, treat it as consequential.

For every factor include: risk (`none`, `low`, `medium`, `high`, `critical`),
plain-language explanation, evidence, mitigation, owner, and unresolved
questions.

1. **Blast radius:** If wrong, what systems, users, or data can it damage?
2. **Detection:** Which tests, logs, metrics, alerts, or user signals reveal it?
3. **Recovery:** Can it be disabled, rolled back, repaired, or forward-fixed?
4. **Data:** Could users lose data, receive wrong data, or expose private data?
5. **Access:** Which people, services, and credentials can perform or affect it?
6. **Cost:** Can abuse, retries, loops, or traffic create material expense?
7. **Compatibility:** Do old web/mobile clients still work with the new backend?
8. **Ownership:** Who responds outside working hours, using which runbook?
9. **Business value:** Which measured outcome justifies the risk?

Unknown is not low risk. High or critical unresolved risk requires operator
approval. The goal cannot be completed until the final report reflects what was
actually implemented and verified.

## Operator-only decisions and actions

Claude must produce exact attended instructions and evidence requirements, but
must not perform these overnight:

- Create/upgrade Vercel, Supabase, Apple, Google, Brevo, monitoring, DNS, or
  build-service accounts and plans.
- Add, reveal, rotate, or revoke production credentials.
- Change billing, quotas, WAF/firewall controls, domains, DNS, signing
  certificates, App Store settings, or production access.
- Apply database migrations to Production.
- Copy or restore production data.
- Deploy/promote Production, push branches, open/merge PRs, or rewrite history
  unless separately authorized.
- Decide legal/privacy retention, photo licensing, analytics collection, or
  incident communication policy.
- Perform active network, API, mobile, authorization, or Production security
  testing without a completed and separately approved Rules of Engagement.
- Claim physical-device, dashboard, alert-delivery, backup-restore, or
  production-smoke evidence without the attended check.

## Paste this into Claude Code

```text
/mission Build an ordered production-readiness program for Next Bar from the
current repository state. First finish the remaining development queue, then
produce a launchable system with isolated Local, Preview, Staging, and Production
environments; safe delivery; recoverable data; verified security; observable
failures; controlled costs; a tested TestFlight/App Store path; and a prepared,
non-destructive adversarial security assessment.

Repository:
C:\Users\cdfee\projects\next-bar

Start with evidence, not assumptions. Read and reconcile:
- docs/PRODUCTION-READINESS-MISSION-2026-07-30.md
- docs/CONTINUATION-2026-07-30.md
- docs/C2-RATE-LIMIT-AUDIT-2026-07-30.md
- docs/C3-RLS-AUDIT-2026-07-30.md
- docs/APP-PRIVACY-LABELS-2026-07-30.md
- docs/APP-STORE-PLAN.md
- docs/SCALE-PLAN.md
- docs/SAFE-SECURITY-TEST-ROE-2026-07-30.md
- docs/CTO-LEARNING-PROGRESS.json
- .github/workflows/ci.yml

The worktree may contain another agent's active changes. Preserve them. Do not
discard, overwrite, stage, or commit unrelated work. Revalidate all dated
claims; external dashboard state is UNVERIFIED until attended evidence exists.

Create independently completable goals in this order:

1. Worktree and current-state reconciliation. Identify the active development
   slice, the proposed three commit boundaries, current tests, migration files,
   and the reported live ledger ending at 0032. Preserve every existing edit.
   Produce exact attended commit steps; do not stage or commit without authority.
2. Migration readiness packet for 0033 then 0034. Prove both against a clean
   local or Staging database, verify old/new client compatibility, and write the
   backup, apply, verification, two-browser vibe-profile smoke, revoke/grant
   check, stop, and forward-fix runbook. Never apply live migrations.
3. C3 F2 security-definer audit. Audit all 28 browser-callable functions as
   authorization boundaries. Produce a per-function identity, privilege,
   object-access, enumeration, abuse/rate, test, finding, and fix matrix. Do not
   assume RLS protects code running as the definer.
4. User-visible `/` async catalog reflow. Use the diagnosis already recorded in
   CONTINUATION; fix the three genuine E2E failures and add a focused regression
   without re-deriving the established cause.
5. Test and validation debt. Cover the photo-pruner delete path, pin the
   `isReachable` carousel boundary, make an evidence-backed serial/parallel
   decision for `bias-smoke`, and add padded-email signup rejection with a
   focused test.
6. Remaining C2/C3 work. Process C2 F1b/F2/F4/F5 and C3 F1/F4. Treat the direct
   origin question as an operator gate; instrument before guessing; distinguish
   a per-instance limiter from a deployment-wide limit.
7. Documentation and decision reconciliation. Correct the five recorded stale
   claims plus this session's implementation/migration changes. Carry forward
   all seven operator questions, explicitly marking waitlist deletion/retention
   and Production analytics as App Privacy blockers.
8. Current-state architecture, dependency, environment, credential, and
   production-access inventory. Produce a plain-language system map and identify
   every fact that requires dashboard verification.
9. Local/Preview/Staging/Production design. Define separate Vercel, Supabase,
   Auth, Storage, email, Google, monitoring, domain, and mobile-build boundaries.
   Produce synthetic staging-data requirements and exact operator setup steps.
10. Environment-variable and secret classification. Cover every referenced
    variable, public/server boundary, per-environment value source, owner,
    rotation, failure behavior, and leak consequence. Add safe validation and
    documentation where missing.
11. CI, release, database recovery, and compatibility gates. Preserve the
    typecheck/unit/build baseline; add only reliable bounded checks. Revalidate
    Playwright teardown, mobile controls, migration rebuild, secret scan,
    staging smoke, expand/contract behavior, backups, restore, and rollback.
12. Observability, incidents, and cost controls. Define release IDs,
    error/uptime alerts, owners, SLOs, runbooks, test events, quotas, budget
    alerts, circuit breakers, and incident simulations without inventing
    credentials or claiming dashboard evidence.
13. Privacy, deletion, and App Store declarations. Reconcile shipped data flows
    with the authoritative inventory. Surface operator decisions for waitlist,
    photo-permission audit retention, analytics, logs, backups, CARTO,
    location/photos, and data residency. Verify deletion code without live
    deletion.
14. Production services and release rehearsal. Produce attended setup and proof
    checklists for Vercel, Supabase, GitHub, DNS/TLS, Brevo, Google Maps/media,
    monitoring, Codemagic/cloud Mac, Apple/TestFlight, signing, kill switches,
    Staging, Production, smoke, rollback, and post-release review.
15. Safe adversarial assessment preparation. Using the Rules of Engagement,
    produce an asset inventory, trust-boundary model, synthetic accounts,
    staging test cases, Production-confirmation candidates, request ceilings,
    stop conditions, monitoring needs, evidence template, and attended
    authorization form. Static/source review is allowed; do not perform active
    network, API, mobile, or Production security testing.
16. Final launch gate report. For every launch and security-assessment
    prerequisite, report PASS, FAIL, BLOCKED-OPERATOR, or UNVERIFIED with direct
    evidence. Do not turn missing evidence into a pass.

For every consequential goal, enforce the Mandatory Change Risk Brief in the
source document: Blast radius, Detection, Recovery, Data, Access, Cost,
Compatibility, Ownership, and Business value. Produce it before implementation,
challenge it during /review-routed, verify mitigations in /santa-loop, and update
it after implementation. Unknown is not low risk.

Use the real wrappers: /code for implementation, /santa-loop for adversarial
review, and /review-routed for the multi-model panel prescribed by the tier.
Different model families should independently examine security, data,
compatibility, operations, cost, and product value. Do not compress away the
required review panel to fit the night.

Hard rules:
- No Production writes, migration applies, data copies, restores, deletes,
  deploys, promotions, pushes, PRs, merges, history rewrites, DNS changes,
  credential changes, billing changes, or external messages.
- No active adversarial traffic, authorization bypass attempts, vulnerability
  exploitation, or live security confirmation. Prepare these for a separately
  authorized, attended assessment under the Rules of Engagement.
- Never print, echo, commit, or place secrets in reports.
- Preview and staging must never use Production service-role/database secrets.
- Use synthetic staging data; never copy raw Production user data.
- Author operator instructions separately from agent-executable work.
- Continue to the next safe goal when an operator action blocks one item.
- Tests and audits must be bounded and evidence-backed.
- Do not claim dashboard state, physical iPhone results, backup restoration,
  alert delivery, or live smoke tests without attended proof.
- Stop at the time supplied by the generated /goal command, after all safe goals,
  or when no safe runnable item remains.

At the end of /mission, print:
1. The ordered goal IDs with tier and owner.
2. The exact /goal command that invokes the global /overnight skill.
3. A separate attended operator queue.
4. The current launch blockers in plain language.
5. The exact boundary between overnight-safe work, the attended 0033/0034
   migration window, and the separately authorized security assessment.
```

## Expected handoff

The overnight run should leave:

- A reconciled development queue and attended three-commit plan.
- A tested 0033/0034 migration packet, without a live apply.
- The security-definer function matrix and remaining C2/C3 disposition.
- The async catalog reflow fix and focused test-debt results.
- A current architecture/environment diagram.
- A service and credential matrix without secret values.
- A staging/prod provisioning checklist.
- Code and tests for safe engineering goals.
- Proposed migrations, never applied.
- Security matrices and remediations.
- Monitoring and incident runbooks.
- Privacy/App Store decision queue.
- A rehearsable release and rollback plan.
- A completed security-assessment plan and blank authorization record, without
  active testing.
- A final launch-gate report that distinguishes evidence from assumption.
