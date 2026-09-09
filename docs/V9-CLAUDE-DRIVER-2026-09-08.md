# V9 full Claude driver paste

Updated 2026-09-08 for Connor's requested work list, possible parallel lanes and integration plan. This replaces the earlier preparation-only handoff. No run, model call, worker, merge or deployment has been started by saving it. The versioned queue remains the detailed product input; this file describes execution preparation and the intended stages.

## Paste into the attended Claude driver first

```text
Drive Next Bar v9 using the installed Claude Code harness. Use Fable 5.1 for the driver and confirm the actual model identity.

Read:
D:/harness-worktrees/nb-overnight-20260907/v8-recommendations/CLAUDE.md
D:/harness-worktrees/nb-overnight-20260907/v8-recommendations/docs/V9-OVERNIGHT-QUEUE-2026-09-08.md
D:/harness-handoffs/nextbar-overnight-20260907/MORNING-HANDOFF.md
D:/harness-handoffs/nextbar-overnight-20260907/IOS-TESTFLIGHT-CORRECTION-2026-09-08.md

FOUNDATION FIRST: the owner's latest priority supersedes any earlier feature-first order. After plan review/admission, first repair misleading Playwright checks and establish trustworthy behavior/visual baselines. Then verify the previous refactor slice is present and perform the bounded shared-code refactor these fixes depend on, with one writer. Verify/review that foundation and record its exact commit BEFORE branching or launching dependent feature lanes. Store real goal dependencies, not just a prose order. Reuse completed refactor evidence where valid; no whole-app rewrite. If the run budget ends here, save the foundation and report features pending.

Preserve all twelve V9 requirement IDs and my corrections. Start with a critical visual/typography review and the Playwright coverage-gap audit. My approved design replaced Poppins with DIFFERENT header and body fonts: recover their exact names/weights from the later approved source, do not guess. Compare actual screens with my chosen designs. Explain why phone failures escaped tests; distinguish mocked browser checks, real staging integration and physical iPhone acceptance.

For the UI review, use current primary Apple Human Interface Guidelines AND applicable SDK documentation as an explicit rubric: custom-font legibility/hierarchy, larger text/Bold Text, touch targets/spacing, safe areas, keyboard and adaptive layout, sheets/navigation, contrast, VoiceOver/focus, reduced motion, corners, and permissions/recovery. Record the Apple source and actual screen evidence for each finding. Preserve my chosen brand fonts; do not replace them with system fonts merely to look native. Identify which fixes are native and which are HTML/CSS in WKWebView, and verify real iPhone behavior rather than claiming SDK adoption from web-only changes. The source links and detailed acceptance are in V9-10/11 of queue revision 0.5.

Audit existing goals, workstreams and leases before preparing a dedicated v9 workspace. Reuse matching goal IDs and their evidence; do not duplicate previous refactor work, steal leases, reset files or silently adopt the old v9 branch instead of the latest v8 baseline. Preserve the uncommitted queue/driver/CLAUDE.md edits. Pin the chosen baseline and versioned v9 contract; keep v8's frozen contract intact.

Prepare one small read-only Astra review packet with the proposed fixes, code evidence, relevant approved/actual images, test gaps, dependencies and acceptance criteria. Save its path and pause once for my Codex/Astra session to review it. No paid Astra call or model-routing change in this preparation step. After I return that review and tell you to continue, reconcile findings and use /mission for genuinely new stored goals, then launch the exact admitted IDs through the installed controller. No repeated permission questions for routine work inside those approved goals.

Proposed coding topology AFTER the foundation gate: at most TWO isolated implementation lanes from the SAME verified foundation commit, only after confirming the launch profile and repository policy permit delegation. If the required deep profile or capability is absent, use one sequential writer and report it; do not change profiles or policy silently.
- Lane A owns Night Out: form overflow, searchable groups/individuals, bottom primary action, specific-plan invites, bar suggestions/voting and finding created plans after returning/reloading. Keep these together because they share files.
- Lane B owns map name -> shared photos/hours -> top-right X -> preserved map state, recommendation copy/three-result diagnosis, and camera/native-permission fixes, with their focused tests.
- Shared typography/tokens and Playwright infrastructure have ONE owner and are completed serially before dependent lane changes. Audit first; do not let both lanes edit shared components/configuration. New shared dependencies serialize the affected work.
- Complete the necessary shared refactor before these feature lanes; later refactors are limited to newly evidenced in-scope dependencies. Icon redesign is a reviewable design exploration until I select the art. Missing font names or device access block only the affected acceptance, not independent work.

Generate the exact controller command from the installed command contracts and real admitted IDs. Never use invented IDs or “all runnable goals.” With two lanes, prepare a supported team manifest; with one lane, use the installed single-worktree overnight path. Pin the same base, goal dependencies, write scopes and owner per worktree before dispatch. Native /goal may drive the bounded controller; no recursively nested controllers.

Use a finite run: at most eight hours, stopping earlier at the next 08:00 America/New_York; resolve and save the absolute deadline. At most 20 controller action iterations and 12 additional routed review calls total, including failures and correction reviews, across the whole run. These limits apply when I paste the generated launch command, not to this preparation step. Check available usage accounting; report unavailable accounting rather than installing a paid service. If the selected controller cannot enforce an aggregate bound, report that before launch instead of pretending per-lane quotas are a shared cap.

One implementation attempt and one evidence-driven correction per slice. Run meaningful tests on the changed candidate; no repeated full-suite runs after documentation-only changes, no forced-click/retry/assertion weakening to manufacture green results. Use the repository's required final typecheck, Vitest and production Playwright gate. Verify actual visible journeys and preserve failures. Physical iPhone checks remain separate and mandatory where applicable.

Do not confuse repairing tests with making them accept broken product behavior. Keep known product failures and tests for new requirements visible and tied to their remaining goals. A foundation gate requires credible checks, reviewed shared code and no new regressions; it is not a claim the not-yet-implemented feature queue passes. Full release acceptance still requires the completed combined candidate to pass all required gates.

Use the frozen candidate's existing review policy. The installed overnight Codex lane is pinned to Sol; Astra's plan review does not replace that gate. Do not alter the harness to bypass a reviewer or relabel the model used. Stop at quota, timeout or policy limits with accurate unfinished status.

Workers produce local commits only. No production changes, pushes, migrations, real-user invites/messages, Google key/quota changes, live billable provider probes, TestFlight upload or App Store action in the unattended run.

When lanes finish, produce exact commit SHAs, review receipts, a dependency-respecting integration order and the combined-build test plan. Passing individual lanes is not release acceptance. Current /team integration/publish execution is unavailable: do not invent an auto-merge path or patch the harness. Leave the verified commits ready for the separate attended integration step. That step combines them on a local v9 integration branch, resolves any conflicts as new changes, runs the full combined gate and visual review, then stages physical iPhone acceptance before a release decision.

Persist RUN-INDEX.md and a morning report under D:/harness-handoffs/nextbar-v9-overnight/<unique-run-id>/ with exact worktrees, baseline, goals/revisions, owner sessions, controller/manifest path, deadline, quotas, current candidate/test/review evidence, blockers and next legal commands. Save checkpoints at phase and terminal-item boundaries. Report implemented, reviewed, integration-ready, device-pending and released separately. Stop safely and preserve work if nobody is available to unblock you.

First return the Fable model identity, proposed baseline/worktree and lane ownership, existing goal mapping, Astra packet path and real blockers. Do not launch implementation before that plan-review handoff is reconciled.
```

## What the run aims to accomplish

1. Repair misleading Playwright coverage and establish current/approved visual evidence, including font identification (V9-12/11).
2. Verify existing refactor work, complete the bounded shared-code refactor and freeze a reviewed foundation commit before feature lanes (V9-08).
3. Remove unwanted routing-count commentary and diagnose short recommendation results without padding or raising provider budgets (V9-01).
4. Repair Night Out overflow, recipient selection, creation/discovery, plan invitations and bar voting (V9-02/03/04/05).
5. Repair native camera prerequisites and preserve denied/library/retry paths, ready for a later physical-device test (V9-06).
6. Open the shared photos/hours view from light-blue map venue names and restore the map on close (V9-07).
7. Restore the approved typography when identified and apply documented Apple SDK behavior where relevant (V9-11/10).
8. Prepare tile-icon design options/brief; do not replace chosen art without a selection (V9-09).

These are the targets, not a promise that all twelve items can finish within the chosen time/call limits. Exact fonts, icon selection, credentials or a physical iPhone may leave specific items pending. Save partial verified progress honestly.

## Monitoring

Claude is the sole execution controller and owns checkpoints/terminal receipts. Codex can perform a bounded read-only status watch after the exact run index exists and the owner requests a duration. No monitor runs merely because this file exists, and Codex cannot promise continued supervision after its active session ends.

Use the actual run's installed controller status command, not a guessed session name. Check phase transitions, source identity, failed gates, repeated unchanged verification, quota/deadline state and token-fenced leases. Do not repeatedly run expensive whole-fleet diagnostics when routine controller status is enough. A separate watch need not poll more often than every five minutes absent a specific failure. A long test is not by itself a dead writer.

Intervention must follow the current goal state and ownership: record failure, preserve candidate/evidence and advise the next legal recovery. Never bypass review, steal a lease, kill an unrelated process, recreate a blocked goal or expand budgets simply to keep the run moving. The loop must remain safe without a second model watching it.

## Integration boundary and contract evidence

The installed `C:/Users/cdfee/.claude/commands/team.md` says that “publish and integration execution remain unavailable” and workers produce local candidate-bound commits. Therefore a request to plan parallel coding does not make automatic overnight integration executable. The proposed final integration is a separate attended operation, not a reason to rewrite the harness or claim completion without testing the merged source.

The installed `C:/Users/cdfee/.claude/skills/overnight/SKILL.md` pins Codex review to `gpt-5.6-sol`. Fable/Astra plan review remains advisory unless a separately approved supported review-policy change is made. Missing/failed review receipts are not approval.

When this handoff changes after a driver has read it, send the amendment to the existing driver and refresh its task packet/contract digests. Do not start another driver or duplicate goals to pick up the revision.
