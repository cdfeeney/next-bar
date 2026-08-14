# V8 overnight handoff

This is a prepared handoff, not a running queue. Run only from
`D:/harness-worktrees/nb-v8-integration-20260813` on `release/v8` after the
reconciled design/PRD commit is clean. The authoritative design source is
`docs/design-reference/README.md`; only files under `approved/` are approved
implementation input.

## Step 1: create the stored goals

Paste this as one command in Claude Code:

```text
/mission Create this ordered V8 internal-TestFlight queue from docs/V8-PRD-2026-08-13.md and docs/V8-CHECKLIST-2026-08-13.md. Work only in D:/harness-worktrees/nb-v8-integration-20260813 on release/v8. Use one stored goal per independently completable item and no parallel lanes or extra worktrees. 1) Implement the locked Map / Rankings / Next Bar? / Social / Account visual system from docs/design-reference/approved, plus the native scroll, safe-area, overlay-lock, focus-restoration, and overflow contract. Do not build Night editor, Route after dark, or any exploratory canvas. 2) Establish V7-to-V8 continuity before database-backed feature work: preserve current storage keys, define the server owner and merge/conflict rule for ratings, tied scores, named lists, vibe profile, night history, shared nights, and notification devices, and extend the existing offline fixture where needed. 3) Implement the canonical Night Out lifecycle with member-scoped access, authenticated accept and Not tonight, suggestions/votes, link preview and auth-context return, plus RLS/RPC tests while reusing existing share/social code. Do not implement pre-signup RSVP or unapproved invite-recipient visuals. 4) Implement staging-only native iOS invitation notifications with Capacitor/APNs registration, server-owned device tokens and idempotent outbox, the four PRD event types, preferences, sign-out revocation, deep links, and real-device test instructions; keep web push dark and credentials server-only. 5) Add the approved venue-tag presentation with deterministic five-tag priority. Do not add Hoboken or another expansion catalog until the V8 core passes and expansion is separately approved. Shared constraints for every goal: inspect current code first; additive migrations only; zero retries; approved screenshots are canonical; exploratory screenshots are not implementation approval; no production database write, production alias change, catalog import, deployment, push, TestFlight upload, App Store action, credential logging, destructive cleanup, automatic integration, goal recreation, or extra model consultation. Stop on an attended decision, missing credential/capability, genuine product failure, live lease, dirty unexplained worktree, or any need to broaden scope. Record exact commits, tests, residual blockers, and the next command. Do not implement during /mission.
```

Record the returned goal IDs in order. Do not launch by title or by “all
runnable.”

## Step 2: start the bounded overnight driver

Replace the placeholders with the exact returned IDs:

```text
/goal Use the global /overnight skill to process these goal IDs in order: <locked-ui-id>, <continuity-id>, <night-out-id>, <native-notifications-id>, <venue-tags-id>. Stop at 08:00 America/New_York, after one implementation and review cycle per runnable item, or when no safe runnable item remains. Do not bypass exploratory-design or attended-device gates, perform attended-only actions, recreate goals, add lanes/worktrees, integrate branches, push, deploy, migrate, upload, or change production.
```

Expected attended stops are founder approval for any exploratory presentation,
physical iPhone verification, and APNs capability or credential work. A morning
handoff must report each exact goal status and candidate SHA;
`ready_for_review` is not complete.
