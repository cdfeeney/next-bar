# Night 8 loop runbook

Goal: `g-771384c2-7377-48d4-8225-ac60d0930649`
Pattern: `sequential` · Mode: `safe` · Started 2026-07-29 (local evening)
Branch: `feat/phase1-compliance-media` · HEAD at start: `1b268ff` · worktree clean

## Pre-flight (verified before iteration 1)

| Check | Result |
|---|---|
| Working tree | clean, on `feat/phase1-compliance-media` |
| Prior goal lease | released — `{"lease":null,"live":false}` |
| Unit suite | **1,160 passed / 78 files**, 27.2s, exit 0 |
| Dev server | **LIVE** on :3000 → `next build` is FORBIDDEN this session |
| `ECC_HOOK_PROFILE` | unset (default profile, not disabled) |
| e2e gate | **known broken** — WebKit workers force-killed at teardown, exit 1 on a green run. This IS queue item 0; it is not a pre-flight pass. |

## Loop mechanics

- One queue item per tick, in order 0 → 5.
- `LOOP_UNATTENDED=1` set at the head of **every** tick (PowerShell does not persist env).
- Local checkpoint commit after each coherent item, tier recorded in the message.
- `/review-routed` + `/santa-loop --unattended` on substantive slices.
- Subagents pinned to `sonnet`.

## Stop conditions (explicit)

Stop and write the morning summary when ANY of these holds:

1. Queue items 0–5 are exhausted.
2. Two consecutive ticks land no verified progress.
3. Anything requires operator authority or a production write (park it, continue elsewhere;
   stop only if everything remaining is parked).
4. The working tree reaches a state that cannot be checkpointed cleanly.

Morning summary → `docs/NIGHTLOG-2026-07-29.md`: commits, tests, reviewers, remaining risks,
high-risk venue queue, exact attended commands. Operator-only and physical-device criteria are
never claimed complete.

## Forbidden this session

`--apply` · `db:migrate` · any production write · push · PR · merge · deploy · branch switch ·
history rewrite · photo deletion · contacting venues · `next build` while the dev server is up ·
asking the operator questions overnight.
