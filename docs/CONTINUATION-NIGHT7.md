# Continuation — Night 7 loop brief

Written 2026-07-28 (evening). Branch `feat/phase1-compliance-media`.
Everything below is local; nothing pushed, no PR.

Goal store: `g-f8b2101a-7922-48c4-8bf6-f69c74ec18f9`
(Playwright triage + H3 slice 6). Parent: `g-e32c61a4`, `g-3eedd7a1`.

---

## 1. State at hand-off (verified today)

| Fact | Value |
|---|---|
| Unit tests | **1,160 passing** |
| Playwright | **309 passed / 0 failed / 1 flaky**, iPhone 13 + Pixel 7 |
| `tsc --noEmit` | clean |
| `next build` | clean |
| Hours: `osm`/`reported` | **275 live** — parser now clears **343** (not yet applied) |
| Hours: `google`/`unverified` | **910** |
| Hours: none | 71 |
| Catalog | 1,256 venues |

Shipped today: WebKit auth-lock deadlock fix, three e2e baseline corrections,
SSRF-safe fetch core, venue-site crawl + correlation gate, OSM parser comma
expansion (275 → 343 parseable, refusals 83 → 15).

---

## 2. Blocked on Connor — do NOT guess these

| # | Decision | What it blocks |
|---|---|---|
| D1 | **H2 transport**: Vercel Edge Config vs Supabase `/api/flags`. Edge Config avoids the LCP first-paint penalty but needs dashboard setup only Connor can do. | The kill switch — last unmet half of criterion 13 |
| D2 | **Run `osm-hours-sweep --apply`?** Writes 343 rows, takes `google` from 910 → ~842. Same operation already approved for the first 275. Overwrites those venues' Google hours **irreversibly**. | H3 coverage 21.9% → 27.3% |
| D3 | **`verified` corroboration rule.** The correlation gate currently treats site==OSM as correlated, so an OSM+site pair caps at `reported` and `verified` is unreachable without a third source type. | Whether `verified` is ever attainable |
| D4 | **Staleness window** — keep 30 days? | `demoteIfStale` behaviour |
| D5 | **Pair 3 `place_id` owner** — `dominies-astoria` vs `flemings-pub` share `ChIJUzyXVUdfwokRYzS5v4AZpYw`. | Removing the carve-out from `bars_place_id_unique` |
| D6 | **Coordinates** for `the-slaughtered-lamb-pub` and `bar-coastal`. No source exists for where they actually are. | They render at another venue's location on the map and in distance ranking, right now |

---

## 3. Outstanding engineering — unblocked, ordered by value

### Tier 1 — do these first

1. **Verify `e2e/mobile-controls.spec.ts` on the `iPhone 17` project.** WRITTEN
   TODAY BUT NEVER SUCCESSFULLY RUN — the run exceeded 10 minutes and was
   killed. It may fail, and it may be finding real bugs. Treat any failure as a
   genuine finding until proven otherwise.
   `npx playwright test e2e/mobile-controls.spec.ts --project="iPhone 17"`
2. **Playwright exits 1 with zero failures.** WebKit workers are force-killed at
   teardown (`worker-N did not exit within 300000ms`). Any loop tick that gates
   on exit code reads every run as failed, and it adds ~5 min of dead wait per
   run. **This is the single biggest blocker to a useful night loop.**
3. **B1 — distance widening does nothing.** Walkable → Worth a cab → Anywhere
   must **re-run the pick against a wider radius** (Connor confirmed: not a
   re-filter of bars already in hand). Today you must press Run again manually.
   See `docs/OPERATOR-BUGS-2026-07-28.md`.

### Tier 2 — real value, well-scoped

4. **OSM matcher.** 659 of 2,084 OSM venues match nothing in our catalog
   (52.5%). This is now the hours ceiling — parsing is 96% solved, matching is
   not. OSM caps at ~358/1,256 (28%) until this improves. Highest-yield hours
   work remaining.
5. **B2–B4 — vibe-tweak re-layout** (design together, don't land piecemeal):
   banner stays pinned at top; the vibe-tweak entry moves to where "Run
   anywhere" sits; neighborhood becomes an option *inside* vibe tweak; "Run
   again" becomes an action inside vibe tweak, offered after settings are done.
6. **H3 slice 7 — scheduling.** Incremental, rate-limited, never user-triggered.
   Staleness demotion applied on read as well as write.
7. **Crawl B10 gap** — no unit test pins the no-demote-on-missing rule. It holds
   structurally (a failed fetch never enters the write list) but nothing guards
   it. Add before `--apply` is ever run.

### Tier 3 — known debt

8. **H4** — retire the remaining ~842 `google`/`unverified` rows once H3 covers
   more. **Audit every reader of `bars.hours` first.**
9. **M1** — ESLint module boundary so importing `barVisual`'s URL builders
   outside `mediaPolicy.ts` is a build failure. One caller today is an accident,
   not a constraint.
10. **M2** — `expires_at` on `bar_photos` + deletion job, so the 3,435 legacy
    Google photo files have forced rather than optional expiry.
11. **L4** — the client still receives the whole 1,256-venue catalog. The real
    100k-users/day ceiling. Phase 2.
12. **L3** — review text remains in git history. `filter-repo` is irreversible
    and resets every clone/PR/CI cache. Own maintenance window.
13. **`BarMedia` is still unmounted** — adopt it on a real surface or delete it.
14. **15 OSM specs still refused** — mostly the open-ended `+` suffix
    (`17:00-23:00+`). Deliberately refused: reading it as a hard close would let
    the badge say CLOSED while the venue is open. Don't "fix" without deciding
    that trade explicitly.
15. **Site crawl yield is ~1.7%** (1 parse in 60). Built and safe, but it is not
    the lever — item 4 is.

### Documentation corrections owed

16. **`CLAUDE.md` is wrong about the `/rankings` flake.** It says cold-compile
    race; it was actually `clearStorage()` navigating to `/` and aborting the
    next `goto`. Reproduced 3/3 on a warm server, now fixed. The `/quiz` note
    may be equally wrong — worth re-testing before trusting it.
17. **`phase1-compliance.spec.ts` coverage boundary** — it no longer asserts the
    Google-specific "Hours not verified" string (its premise became false when
    280 venues moved to OSM). That mapping is owned by
    `src/lib/openNow.test.ts:254`. Recorded in the spec.

---

## 4. Night-loop hard rules

- **`LOOP_UNATTENDED=1` on every tick.** PowerShell does not persist env between
  ticks — set it each time. This is the gate that makes `apply-migrations.ts`,
  `ingest-bars.ts`, `refresh-places.mjs`, `osm-hours-sweep.mts` and
  `site-hours-crawl.mts` refuse to write.
- **No `--apply` anywhere.** Writing hours is an attended step. D2 above is
  Connor's call, not the loop's.
- **Never run `next build` while the dev server is live.** They share `.next`.
  Doing this tonight corrupted the dev server and produced **267 false test
  failures** that looked exactly like a catastrophic regression. If a tick needs
  both, stop the dev server first.
- **No push, no PR, no merge, no rebase, no branch switch.** Local commits only.
- **Subagents pinned to `sonnet`.** Never let a fan-out inherit the lead model.
- **Codex review** = `codex exec --sandbox read-only -m gpt-5.4 -C "$(pwd)" -`.
  Never `codex:codex-rescue` for review — it dispatches and never reports. Read
  the BODY, not the exit code; an exit 0 with a `Blocked:` body is a failed lane.
  (Its shell sandbox is broken on this machine; it falls back to `node_repl` and
  still produces real repo-grounded findings — it found a HIGH bug today.)
- **DeepSeek packets under 800 words, ~3 questions.** Exit 124 means the packet
  was too heavy, not that the route is down.

---

## 5. Loop prompt (paste verbatim)

```
Continue on next-bar, branch feat/phase1-compliance-media. Read
docs/CONTINUATION-NIGHT7.md FIRST — it lists state, what is blocked on me, and
the ordered work queue. Set LOOP_UNATTENDED=1 on every tick.

Ground rules, learned the hard way — do not rediscover them:
- Never run `npm run build` while the dev server is running. They share .next
  and it produces hundreds of false test failures.
- Playwright currently exits 1 even when 0 tests fail, because WebKit workers
  are force-killed at teardown. Judge runs by the PASSED/FAILED counts, not the
  exit code, until item 2 is fixed.
- No --apply on any script. No push, no PR, no branch switch.
- A green unit suite is not evidence a surface renders. Run the relevant
  Playwright spec before claiming any user-visible change works.

Work the queue in docs/CONTINUATION-NIGHT7.md §3 in order:

1. Run e2e/mobile-controls.spec.ts on the iPhone 17 project. It was written
   today and has NEVER completed a run. If it fails, diagnose before editing —
   it asserts that every visible control is on-screen, at least 44px tall, and
   not covered by the bottom nav, so a failure is likely a real mobile layout
   bug, not a bad test. Do not loosen an assertion to get green.
2. Root-cause the WebKit worker teardown hang so the suite exits 0 when it
   passes. This unblocks every future automated run.
3. Fix B1: widening the distance filter must RE-RUN the pick against a wider
   radius, not re-filter the set already in hand. Connor confirmed this.
   Add e2e coverage on both viewports, including the negative assertion that
   widening does not silently leave the result set unchanged.
4. Then take item 4 (OSM matcher) — 659 unmatched OSM venues is now the hours
   ceiling, worth far more than any further parser or crawl work.

Commit locally after each item with a [T0/T1/T2] tier in the message. Append a
MORNING SUMMARY to docs/NIGHTLOG-2026-07-29.md when the queue is exhausted or
budget runs out: what landed, what broke, what you learned that contradicts
this brief, and anything newly blocked on me.

Do NOT touch: anything in §2 (blocked on my decision), any --apply path, or
git history.
```

---

## 6. What I would flag if you only read one thing

Item 2 — Playwright's non-zero exit. Every other item is normal work. That one
makes an automated loop unable to tell success from failure, and it will waste
the night quietly.
