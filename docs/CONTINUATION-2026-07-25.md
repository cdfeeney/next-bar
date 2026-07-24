# Continuation prompt — Next Bar overnight loop (paste after /clear)

Execute the unattended overnight loop for Next Bar. Goal id: `g-f04c56d0-9d61-40c0-978b-0b0751dcdc99`. Repo: `C:\Users\cdfee\projects\next-bar`.

START SEQUENCE:
1. `cd` to the repo. Bind the goal: `node ~/.claude/bin/harness-state.mjs bind g-f04c56d0-9d61-40c0-978b-0b0751dcdc99 --json`; launch the heartbeat in the background: `node ~/.claude/bin/harness-heartbeat.mjs g-f04c56d0-9d61-40c0-978b-0b0751dcdc99`.
2. Read `docs/NIGHTLOG-2026-07-25.md` (the authoritative loop contract + queue N1–N9) and `docs/BLUEPRINT-beta-enterprise-2026-07-23.md` (step specs). The nightlog can be executed cold from those two files.
3. **Every tick runs with `LOOP_UNATTENDED=1` in the environment** — this is the hard safety gate (scripts/loop-guard.mjs makes refresh-places.mjs / ingest-bars.ts / apply-migrations.ts abort under it). Never unset it.
4. Work the queue one 🟢 step per tick, in order N1→N9. Per-tick contract is in the nightlog: TDD, verify `npx vitest run && npx tsc --noEmit && npm run build` (stop any dev server on :3000 + `rm -rf .next` before the first build), dual-review (fresh Opus agent + routed DeepSeek via `~/.claude/bin/harness-consult.mjs`, small packets), fix confirmed HIGH/MED (max 3 rounds then escalate), commit locally `[T1]`/`[T2]` with the review verdict, append a tick line, then ScheduleWakeup(~180s) with this same prompt. NEVER push.

HARD RULES (from the DeepSeek/Codex security review — do not relax):
- MIGRATIONS ARE AUTHOR-ONLY: write + commit additive SQL + code + MOCK-client tests, but DO NOT run `npm run db:migrate`. Migrations (N1, N4) and the service-role account-deletion route (N3) go to the morning escalation queue for attended apply. Mark such steps `PARTIAL — needs migration apply` and continue.
- NO Google API calls, ever (ingest already done). NO service-role execution against live auth. Secrets stay in `.env.local`; never echo/commit `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_API_KEY`.
- Escalate-don't-fake: anything needing an operator key/account/decision → append to the nightlog escalation queue, skip to the next 🟢 step. If no heterogeneous reviewer is available for a substantial step, mark it NAUGHTY, log it, move on (fail-closed — never a same-model self-approval).

STATE SNAPSHOT (verified 2026-07-24 night):
- Done + committed local (~23 commits ahead of a2a1015, NOTHING pushed): B0 rank-order engine + 7 audit fixes, B1 catalog layer, B2 usernames (LIVE in DB), B3 real follows (LIVE), B4 comparison chains, B5 photo-first cards + 250 photos + 253 review sets, B6 tiered map, D3 Places data (LIVE: hours/open-now/closed-bar filter). Demo circle = Claire + John. Migrations 0000–0007 applied to live Supabase.
- Gates at handoff: 433 vitest, tsc 0, build clean, e2e green (friends/rankings/map/claim-handle/where-next).
- Dev server may be running on 192.168.1.158:3000 for the operator's phone — if a build needs it, TaskStop it and leave it stopped.

MORNING DELIVERABLE: the tick log in the nightlog, the escalation queue (migrations to apply, Google quota drop-down to 100/50/100, budget alert already at $2, and the "push to Vercel?" decision), and all overnight commits ready for review.

When the queue is exhausted (or `budget`/time runs out), append a MORNING SUMMARY to the nightlog and stop. Begin now with the START SEQUENCE, setting LOOP_UNATTENDED=1.
