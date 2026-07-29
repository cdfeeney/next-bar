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

## 2. Operator decisions — MOSTLY ANSWERED 2026-07-28 evening

**Only D1 is still open.** D3–D6 were answered late in the session; D3 and D4
are already implemented, D5 and D6 are answered but NOT yet built.

| # | Status | Detail |
|---|---|---|
| D1 | **STILL OPEN — the only thing blocked on Connor** | **H2 transport**: Vercel Edge Config vs Supabase `/api/flags`. Edge Config avoids the LCP first-paint penalty but needs dashboard setup only Connor can do. Blocks the kill switch, the last unmet half of criterion 13. |
| D2 | **REVISED — do not blanket-apply** | See §2a. Apply the 13 agreeing rows only; 33 need hand verification first. |
| D3 | **ANSWERED + BUILT** | Don't trust OSM blind — diff it against the Google hours still on the row, and flag (a) any difference and (b) any venue we're unsure of, for hand verification. Implemented in `osm-hours-sweep.mts`; Google is READ for comparison only, never persisted. |
| D4 | **ANSWERED + BUILT** | Refresh every **60 days**. `HOURS_STALE_AFTER_DAYS` is now 60. |
| D5 | **ANSWERED — not yet built** | **Fleming's is closed down; only Dominie's is there.** So `dominies-astoria` owns `ChIJUzyXVUdfwokRYzS5v4AZpYw`, `flemings-pub` should be marked closed, and the carve-out can come out of `bars_place_id_unique`. Needs a migration. |
| D6 | **ANSWERED — not yet built** | `the-slaughtered-lamb-pub` is at **182 West 4th Street, Greenwich Village**. Geocode via **Nominatim, not Google** (OSM-derived is what we may persist). `bar-coastal` **"seems closed"** — Connor's word was "seems", so VERIFY before deleting; the work ledger says Google's CLOSED_PERMANENTLY verdict has been right 42+ times, but this one is unconfirmed. Needs a migration. |

### 2a. The Google cross-check result — read this before applying any hours

Run `npx tsx scripts/osm-hours-sweep.mts` for the full list.

| Bucket | Count | Meaning |
|---|---|---|
| OSM **agrees** with Google | **13** | Two independent sources concur — safe to apply |
| OSM **DIFFERS** from Google | **33** | Hand-verify. Listed by name+id in the script output. |
| No Google baseline | 297 | Already swapped to OSM; rewriting is a no-op |

**The differences lean one way, and it is the dangerous way.** OSM tends to
claim later, rounder closing times than Google:

| Venue | Google | OSM |
|---|---|---|
| The Ten Bells | Mo–We 17:00–**00:00**, Su 15:00–**23:00** | every day to **02:00** |
| Sunshine Laundromat | Mon 08:00–**02:00** | Mon 08:00–**19:00** |
| Bathtub Gin | Fr/Sa 17:00–**03:00** | Fr 17:00–**04:00**, Sa 16:00–04:00 |

The parser was checked against the raw OSM strings and is reading them
correctly — these are genuine data disagreements, not parse bugs. But "The Ten
Bells closes at 2am every day" looks like a mapper's approximation, and an
over-late close makes the open-now badge say OPEN after the venue shut. That is
the one direction the badge is designed never to be wrong in.

**Recommendation: apply the 13 agreeing rows, hold the 33.**

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

3a. **The three data fixes Connor answered (D5/D6).** All are live-catalog
   writes, so they are ATTENDED work — prepare the migration and the evidence,
   but do not apply unattended.
   - `flemings-pub` → mark closed; `dominies-astoria` keeps the shared
     `place_id`; drop the carve-out from `bars_place_id_unique`.
   - `the-slaughtered-lamb-pub` → geocode **182 West 4th Street, Greenwich
     Village** via Nominatim (never Google) and write lat/lng. It is currently
     rendering at another venue's location.
   - `bar-coastal` → **verify** the closure before acting. Connor said "seems
     closed", which is not the same as confirmed.

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

Do NOT run any --apply, and do NOT write to the catalog, including the three
data fixes in §3 item 3a — those are attended work. You may PREPARE a migration
for them and leave it uncommitted-to-production for review.

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
