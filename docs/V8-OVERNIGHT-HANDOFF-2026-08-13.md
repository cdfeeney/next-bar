# V8 overnight handoff

This is a prepared handoff, not a running queue. The Claude harness store is
currently empty and Agent View is clean. Run from the chosen clean V8
integration worktree after the operator's reference images are available.

## Step 1: create the stored goals

Paste this as one command in Claude Code:

```text
/mission Create this ordered V8 internal-TestFlight queue from docs/V8-PRD-2026-08-13.md and docs/V8-CHECKLIST-2026-08-13.md. Use one physical integration worktree and one stored goal per independently completable item; do not create parallel lanes or extra worktrees. 1) Enforce the locked native interaction contract: one vertical scroll owner per route, no accidental horizontal overflow or visible browser scrollbars in the Capacitor WebView, correct safe-area header/bottom-nav behavior, correct overlay scroll lock/focus restoration, and bounded screenshots/tests on all primary routes. 2) Build only the two bounded representative visual pilots, Night editor and Route after dark, using the same real Home result and Bar lightbox content; stop for operator selection and do not propagate either direction. 3) After that selection is recorded, implement the canonical Night Out invitation lifecycle with member-scoped access, accept and Not tonight, suggestions/votes, link landing, and RLS/RPC tests while reusing existing share/social code where valid. 4) Implement staging-only native iOS invitation notifications with Capacitor/APNs registration, server-owned device tokens and idempotent outbox, four approved event types, preferences, sign-out revocation, deep links, and real-device test instructions; keep the existing web-push feature dark and keep credentials server-only. 5) Add the V7-to-V8 continuity fixture and verification for authentication, Bar 54, named lists, tied numeric scores, night history, and shared state. Shared constraints for every goal: inspect current code first; additive migrations only; zero retries; no production database write, production alias change, catalog import, deployment, push, TestFlight upload, App Store action, credential logging, destructive cleanup, automatic integration, or goal recreation. Stop on an attended decision, missing credential/capability, genuine product failure, live lease, dirty unexplained worktree, or any need to broaden scope. Record exact commits, tests, residual blockers, and the next command. Do not implement during /mission.
```

Record the returned goal IDs in order. Do not launch by title or by “all runnable”.

## Step 2: start the bounded overnight driver

Replace the placeholders with the exact returned IDs:

```text
/goal Use the global /overnight skill to process these goal IDs in order: <native-shell-id>, <visual-pilots-id>, <night-out-id>, <native-notifications-id>, <continuity-id>. Stop at 08:00 America/New_York, after one implementation and review cycle per runnable item, or when no safe runnable item remains. Do not bypass the visual-selection gate, perform attended-only actions, recreate goals, add lanes/worktrees, integrate branches, push, deploy, migrate, upload, or change production.
```

The expected overnight stop is the visual-selection gate unless the operator has
already recorded a chosen direction. A morning handoff must report each exact
goal status and candidate SHA; `ready_for_review` is not complete.
