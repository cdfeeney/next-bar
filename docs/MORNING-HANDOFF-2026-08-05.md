# Next Bar morning handoff — 2026-08-05

This is the attended morning runbook for completing the protected-Staging
census pilot, reconciling the beta/social state, and preparing a controlled
Production promotion. It supplements `docs/CONTINUATION-2026-08-04.md` and
supersedes that file's stale pre-TestFlight operator steps. Live Git, the goal
store, lease registry, remote-write lock, deployment identities, and database
ledgers remain authoritative over this document.

## Non-negotiable boundaries

- Product/census workspace: `C:\Users\cdfee\projects\nb-overnight`.
- Existing iOS worktree: `C:\Users\cdfee\projects\nb-ios` — inspect only until
  its dirty/diverged state is reconciled.
- Ignore `C:\Users\cdfee\projects\nb-testflight-node22`; do not clean, reset,
  move, fold, or delete it.
- Never reset, stash, clean, overwrite, stage, or edit the four protected
  operator documents. Never use `git add -A` or `git add .`.
- Production and Staging remain separate environments and databases. Do not
  copy the Staging database into Production or point Production at Staging.
- No push, PR, merge, deploy, GitHub Action, Apple action, migration, provider
  call, or remote write without approval for that exact action.
- Keep the common remote-write lock armed except for one explicitly approved,
  bounded write window; re-arm it immediately afterward.
- Production was untouched through the checkpoint. Do not infer Production
  approval from any Staging approval.
- Census migrations `0037` and `0041` are protected-Staging-only under census
  goal `g-7104aed0-7305-491e-8297-b47729cd1496`. Do not apply them to
  Production under that goal.
- `0038` remains reserved for venue pins, `0039` for Social Phase B, and `0040`
  for night photos. Do not apply or renumber them during the census closeout.
- Review policy: T1 requires fresh Claude FABLE plus Codex. T0 additionally
  requires one risk-routed specialist. Sonnet is informational only.

## Exact checkpoint

- Branch at checkpoint: `feat/overnight-2026-07-30`.
- Checkpoint commit: `cc58095e5566f1cd024085a49bd436cc4201f605`.
- Migration candidate commit: `48f9f93`.
- Census goal: `g-7104aed0-7305-491e-8297-b47729cd1496`, status `paused`.
- Lease: released (`live=false`).
- Common remote-write lock: armed.
- Protected Staging: `wqxovhiovgcijmfzxgby`, label `staging`.
- Declared Production: `nuhqlvneokucxomguxhi`; it is not the Staging target.
- Protected-Staging census state: migration `0037` applied and verified 25/25;
  `0041` applied nowhere; bars remain 411; no Lucinda's row was inserted.
- Production state from this session: untouched; no Production credential,
  connection, migration, or write occurred.
- Authoritative report:
  - run: `run-2026-08-05T00-25-06-752Z`
  - code SHA: `9480fb1463f052a5626609afc876cfe0b24653ae`
  - payload SHA-256:
    `4907940ed8faa134808d393059eb88a230fc255a22ac59ab70f656acb4fe9db6`
  - config hash begins `39d39ff8cb27`
  - 1,382 candidates; $0.00; Google untouched
- Lucinda's curation: `osm:node/13680449615`, price tier 2, tags
  `[live, cocktail, dance, buzzy]`, blurb "Live country, two-step nights, and
  Southern cocktails on Avenue A.", scope Lucinda's only.
- The earlier Lucinda's apply was explicitly approved but rejected by the
  existing `bars_source_check`; no row was written. Re-present the exact row
  after `0041` verification and ask the operator whether to re-issue the insert
  approval. Do not silently treat the `0041` approval as insert approval.

## Attended block A — finish the census pilot

Resume the existing goal; do not recreate it:

`/code g-7104aed0-7305-491e-8297-b47729cd1496`

1. Re-read `CLAUDE.md`, the continuation, this handoff, live Git, goal evidence,
   lease registry, and remote-write lock. Report every discrepancy before
   writing.
2. Reconfirm protected-Staging identity three ways and prove it differs from
   declared Production before accessing credentials.
3. With approval for the bounded read window, read the protected-Staging
   ledger. Require `0037` present and `0041` absent; stop on any difference.
4. Confirm `0041_bars_source_census.sql` at `48f9f93` is unchanged. Its full T0
   panel is complete: FABLE database lane APPROVE (two LOW), Codex APPROVE (no
   critical/high/medium; two LOW), DeepSeek clear after ledger-runner atomicity
   was proven.
5. Re-present the exact migration, checksum, target identity, rollback,
   verification plan, and the phrase:

   `APPLY 0041 TO PROTECTED STAGING APPROVED`

6. Without that exact approval, do not apply it. With approval, disarm only for
   the ledgered apply, run the idempotency check, re-arm immediately, and verify
   the allowed source set, all 411 existing rows, constraint integrity, grants,
   RLS, browser write denial, and zero unintended schema/data changes.
7. Re-present the exact hash-bound Lucinda's row and ask whether the prior
   failed-attempt approval carries or the operator wants a new explicit insert
   approval. Do not infer it from the `0041` approval.
8. Apply only Lucinda's after explicit confirmation. Verify expected counts,
   report/config/code binding, evidence/provenance, duplicate protection,
   catalog swap, search/map visibility, matcher behavior, paging behavior, and
   exact rollback scope. Leave no synthetic rows.
9. Update goal evidence and the durable continuation with actual actions,
   tests, reviewer verdicts, approvals, remaining blockers, and confirmation
   that Production was untouched.
10. Mark the census goal complete only if every required verification passes;
    otherwise checkpoint honestly. Release the lease and leave the lock armed.

## Attended block B — reconcile the beta and social surface

Do not call the current suggestion feature an invited-group feature. Repository
evidence at the checkpoint shows:

- `TonightSuggestions` is mounted for signed-in server-mode users on
  `/friends/consensus`.
- `get_circle_suggestions` reads the caller plus followed users, not members
  invited to a particular Night Out.
- "Invite friends" is a zero-server-state `/join` link.
- Existing suggestion E2E tests stub Supabase and do not prove a real invited
  user can join, see, suggest, vote, be removed, or lose access on protected
  Staging.

Record the reusable Crew / invited Night Out flow as incomplete. Its required
acceptance chain is:

1. Owner creates a reusable Crew and invites two real accounts.
2. Invitees accept and appear in the reusable roster.
3. Owner starts a Night Out from that Crew and may alter that night's roster.
4. An invited member sees the Night Out on mobile and suggests a bar.
5. Every invited member sees and can vote on the suggestion.
6. A follower/nonmember cannot see the Night Out or its activity.
7. A removed or blocked member loses access; revoked/expired links fail safely.
8. A one-night guest does not silently join the permanent Crew.
9. Weekend coordination closes while the reusable Crew and permitted recap
   remain according to the approved retention policy.
10. The complete chain passes real multi-account protected-Staging testing,
    dual mobile viewports, and privacy/RLS review.

Also retain these two operator-reported beta items as open until behaviorally
verified:

- An unauthenticated installed-app open must show the intended login window.
- TestFlight shell feedback: background issue, oversized top/safe-area region,
  and wonky scrolling on the Next Bar surface.

Search the goal store before creating anything. Queue missing work without
marking it complete and do not fold Crew work into the census goal.

## Attended block C — prepare and, if approved, promote Production

The operator wants a Production update on 2026-08-05. This remains attended.
It is a release promotion, not "making Staging be Production."

1. Reconcile live remote Git, the exact Staging deployment SHA, exact Production
   deployment SHA, environment identities, feature flags, and both migration
   ledgers. Local remote-tracking refs may be stale; do not build a release
   packet from them without reconciliation.
2. Classify every outgoing change as web-only, native, schema-dependent,
   Staging-only, hidden/incomplete, or safe for the release candidate.
3. Run Staging acceptance for authentication, catalog, search/map, ratings,
   friends/follows, existing consensus/suggestions, shared-night links and
   revocation, Nights Out, mobile safe areas/background/scrolling, and
   unauthenticated app open. Report the invited-Crew flow as incomplete rather
   than substituting the followed-circle tests.
4. Choose an exact release candidate. Incomplete Crew, native APNs, venue pins,
   Social Phase B, night photos, and census-to-Production publication stay out
   unless independently completed, reviewed, approved, and compatible.
5. Show the exact outgoing commits, required Production migrations, environment
   changes by variable name (never secret value), test results, deployment
   identity, rollback target, and abort conditions.
6. Obtain separate approvals for:
   - any push/open-PR/merge action;
   - each exact Production migration set;
   - promotion of the exact verified deployment/SHA;
   - any new TestFlight dispatch if native code changed.
7. Apply Production migrations only through the ledgered runner and only after
   exact approval. `0037`/`0041` are not authorized for Production by the census
   goal.
8. Promote the exact tested web artifact only after approval. Verify health and
   build SHA, login/callbacks, catalog, social reads/writes, map/search, mobile
   shell behavior, cache refresh, and rollback readiness. Roll back on an abort
   condition.
9. Record every external action and confirm whether Production data changed.

Web-only fixes can reach TestFlight build 5 through its Production server URL
after a verified web deployment. Native push support or other native-shell
changes require a reviewed commit and a fresh TestFlight build.

## Local-only follow-on scope

After the attended blocks are checkpointed and all leases are released, create
or deduplicate bounded goals for:

1. Full beta epics/user stories with built/local/Staging/Production status and
   happy, empty, loading, error, offline, unauthorized, stale, and concurrent
   acceptance behavior.
2. Crew and ephemeral Night Out architecture, including roles, invitations,
   privacy, expiry, retention, moderation, and notification policy.
3. Native APNs packet: Capacitor plugin, entitlement, token lifecycle, sender,
   deep links, rate limits, manual test push, and physical-device matrix.
4. Mobile regression coverage for login-on-open, background, safe areas, and
   scrolling on both configured mobile viewports.
5. Production promotion packet automation that never performs the remote
   action.
6. A 20,000-concurrent-user architecture/capacity packet and localhost-only
   load harness that hard-refuses non-loopback targets.

Unattended work may produce reviewed local commits only. It must not access
credentials, touch Staging/Production/Apple/GitHub/Vercel, send notifications,
apply migrations, make paid calls, or claim physical-device/capacity proof from
mocked tests.

## Morning completion record

At each material checkpoint, update the continuation with exact SHAs,
deployment/workflow identifiers, environment and ledger results, approvals,
actions actually performed, tests/reviews, blockers, lease/lock state, and an
explicit statement of whether Production was untouched.
