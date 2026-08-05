# Continuation — 2026-08-02

Resume instructions for the Next Bar overnight queue. **Reuse the stored goal IDs below; never
recreate a goal that exists** — completed and in-progress goals are authoritative in the
multi-session store (`harness-state list --json` shows current status per worktree).

## Continuation contract (every tick)

1. Export `LOOP_UNATTENDED=1` before anything else.
2. Verify the remote-write lock is active and run BOTH worktree guards
   (`node ~/.claude/bin/worktree-guard.mjs check` + the overnight guard). Exit codes 2/3 = stop.
3. Stop before writing while another session's lease is live (bind exit 3 = LEASE_HELD → do not
   write here; read-only work only).
4. Reuse the stored goal IDs; resume only checkpoints whose version, config hash, and code SHA
   match the current tree. **Reject stale checkpoint configuration/code hashes** — a mismatch means
   start that unit fresh, never "probably fine".
5. Skip blocked work (unresolved Open Question, failed quorum, lease conflict) and continue with
   the next independent safe goal; record why in the goal's evidence.
6. Stop at 8:00 AM America/New_York, after six processed goals in a run, or when no safe runnable
   item remains.

## Goal IDs (canonical — do not recreate)

Completed prerequisites (never reopen):
- Goal zero `g-a345b6fc-885f-4878-81c8-caf33e0b1bd1` — auth stale-session fix, commit `9c80a8f`.
- Migration 0036 — commit `0f71333` (treated as a completed prerequisite, not a stored goal).

Queue (order binding):
1. `g-4531bbf0-9203-4f33-9b76-1643c5c1d446` census rewrite (T1)
2. `g-649592c7-52f1-48c4-b745-60709eb11f1f` PostHog foundation (T1)
3. `g-d494ba90-3e87-443b-814a-a061940b853f` feature safety/continuation (T1)
4. `g-f9a3e003-f316-44b3-bfd2-945573286724` Motion foundation (T1)
5. `g-c8da7452-89ad-406a-87f3-eabb900ffa1e` TestFlight/monorepo readiness (T2)
6. `g-8557db39-1684-4cb1-9a76-acf910cb9106` Want to Go writers (T1)
7. `g-6cc99120-a83f-4984-bc7d-db60e0c792eb` exact-filter recovery (T1)
8. `g-2c788c17-b944-45d0-9dc3-d10d451e63b2` Cancel/BottomNav overlap (T1)
9. `g-f81ccdfc-dc9d-43e7-a8a1-05472bc297dc` distance widening (T1)
10. `g-b4529acc-006a-4705-9a19-165264c05a3d` RLS/DEFINER static packet (T2)
11. `g-4914f4e9-3e73-4d73-b4a0-fad96def31a0` migration 0037 draft (T0, GATED on operator
    confirmation of 0036 attended acceptance — blocks this item only)

## Resume command

For the continuation run (goals 7–11, plus any of 1–6 not completed overnight), launch:

```text
/goal Use the global /overnight skill to process the remaining runnable goals from docs/CONTINUATION-2026-08-02.md in their listed order, reusing the stored goal IDs (never recreating goals). Apply the continuation contract in that file: LOOP_UNATTENDED=1, lock + both guards verified, no writes under a live foreign lease, compatible-checkpoint resume only with stale hashes rejected, skip blocked items, stop at 8:00 AM America/New_York or when no safe runnable item remains.
```

Per-goal work uses `/code <goal_id>` then `/santa-loop <goal_id>` — the real wrappers, never inline
equivalents. Only Santa marks a goal complete, and completion requires recorded evidence.
