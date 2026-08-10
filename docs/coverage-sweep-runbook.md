# Coverage sweep runbook — attended Manhattan + Brooklyn

**Do not run this unattended, and do not run it without `--max-calls`.** The
numbers below are produced by the same `estimateCalls()` the sweep prints at
start-up, not by hand.

## Cost first

| Region | Base nearby cells (360 m) | Expected calls | Uniform worst case |
|---|---|---|---|
| Manhattan (New York County) | 1,701 | ~2,967 | 35,721 |
| Brooklyn (Kings County) | 2,950 | ~5,145 | 61,950 |
| Text lane (11 queries × 2 regions) | 22 | 22 | 462 |
| **Total** | **4,673** | **~8,134** | **~98,133** |

"Expected" assumes 15% of base cells saturate and subdivision decays from
there (`estimateCalls` defaults, `--max-depth 2`). "Worst case" is every cell
saturating at every level: `(4^(D+1) − 1) / 3 = 21` calls per base cell.

**At Places API Nearby Search pricing this is a low-hundreds-of-dollars run.**
The bounding boxes are rectangles, so they include water and adjacent
boroughs; `--county` filters the *results*, not the *calls*. If that cost is
not authorized, use the corridor form below instead — it is the same code over
a smaller geography.

## Bounded command — Manhattan

```bash
node scripts/nearby-sweep.mjs \
  --bbox 40.882,-74.021,40.680,-73.907 \
  --label "Manhattan New York County NYC" \
  --county "New York" \
  --step 360 \
  --max-depth 2 \
  --min-cell-meters 90 \
  --max-calls 3500 \
  --manifest data/coverage/manhattan.jsonl \
  --out data/coverage/manhattan-candidates.json
```

## Bounded command — Brooklyn

```bash
node scripts/nearby-sweep.mjs \
  --bbox 40.739,-74.042,40.551,-73.833 \
  --label "Brooklyn Kings County NYC" \
  --county "Kings" \
  --step 360 \
  --max-depth 2 \
  --min-cell-meters 90 \
  --max-calls 6000 \
  --manifest data/coverage/brooklyn.jsonl \
  --out data/coverage/brooklyn-candidates.json
```

`--max-calls` is a hard stop, not a warning. Hitting it records
`errorClass: budget_exhausted` against the cell that could not run and the run
reports **incomplete**, never complete.

## Resume

Exhausting the budget, losing the network, or killing the process all leave a
resumable manifest. Continue with the **identical** flags plus `--resume`:

```bash
node scripts/nearby-sweep.mjs ... --manifest data/coverage/brooklyn.jsonl --resume
```

A resume refuses to start if any flag that changes the plan has changed — the
config hash covers the bbox, step, depth/floor, the effective `includedTypes`,
and the verbatim text queries. Change one and you get a new manifest, not a
silent merge of two different universes.

### What a resume costs

**The table at the top does not bound a resume.** Those numbers are for a run
starting from nothing. A resume only pays for cells whose records are genuinely
missing, and some outstanding cells cost **zero** calls:

- A cell whose capped page is already on record is subdivided *from that record*
  — the children cost calls, the parent does not.
- A parent whose children all finished but whose own terminal record was lost
  (a kill in the one-record window between the last child's `DONE` and the
  parent's) is settled from the records: the run writes its `DONE` and spends
  nothing.

So a resume that reports progress with `callsUsed: 0` for a cell is working
correctly, not stalling. The one exception is a cell carrying an unrecovered
transient failure — that is retried with a real call, because a waiver must
never be the answer to something a retry can fix.

## Reading the result

The run exits **non-zero** unless every planned cell reached a terminal state.
Statuses:

| Status | Meaning |
|---|---|
| `complete` | Every planned cell finished; nothing failed, blocked, or still saturated |
| `incomplete_failed` | A cell was quota-blocked, 5xx'd, or exhausted the budget |
| `incomplete_missing_work` | A cell never finished, or a saturated cell was not subdivided |
| `incomplete_saturated` | Subdivision hit the 90 m floor and the cell still caps — recall is knowably short there |
| `manifest_inconsistent` | A completion record exists but the invariant fails — treat as corrupt |

### Reading the counts

The resume banner prints `finished / plannedCells`, `outstanding`, and `failed`.
They are not four disjoint buckets, so **do not expect them to sum to
`plannedCells`**:

- `finished` counts cells that finished **and** that no clause reported against.
  A cell carrying a completing status word is *not* counted while it still owes
  a subdivision, or still holds an unrecovered failure. This is stricter than
  the status word alone, so a manifest can show fewer finished cells than its
  DONE records suggest — that is the count being honest, not work being lost.
- `outstanding` counts **distinct** cells that owe work. A capped cell with no
  DONE is both "missing" and "capped-but-uncleared"; it is one outstanding cell,
  not two.
- `failed` is a **diagnostic overlay**, not a bucket. A quota-blocked cell with
  no terminal record is counted once in `outstanding` and *also* named in
  `failed`, so `finished + outstanding + failed` can exceed `plannedCells`. The
  overlap is telling you *why* a cell is outstanding.

To judge a run, read `status` and `outstanding`. Use `failed` and
`saturatedAtFloor` to decide what to do about it, not to check arithmetic.

### What a terminal status attests to

Per-cell `DONE` records carry a `detail` object, and for `cleared` it is the
only way to tell how the cell was finished:

| `DONE` record | What actually happened |
|---|---|
| `unsaturated`, `detail.count` | The cell was searched and came back under the cap |
| `cleared`, `detail.children` | The cell capped, was subdivided, and every child finished |
| `cleared`, `detail.resumed: true` | **The parent itself was not re-searched** — its status was settled from its recorded page plus its children's outcomes. This does *not* mean the resume was free: two of the three writers of this flag (cap recovery and continuing a started subdivision) search the children during that resume and pay for them. Only the settle case, where every child was already finished, costs zero calls |
| `saturated_at_floor`, `detail.reason` | Still capping at the floor — recall is knowably short here |
| `ack_terminal`, `detail.reason` | An operator waiver. Backed by a matching `ACK_TERMINAL` record; a `DONE` claiming this word without one is treated as unfinished |

A `cleared` parent's venues live in its **children**, not in its own page, so do
not read a settled parent's own place count as the coverage of that geography.

**A `DONE` is a claim; a successful `ATTEMPT` is the evidence for it.** That rule
applies to every row above, not just `ack_terminal` — a `DONE` saying
`unsaturated`, `cleared`, or `saturated_at_floor` with no successful attempt
behind it is treated as unfinished by every part of the system. `ack_terminal`
is the one status a search cannot back, and its evidence is the operator's
`ACK_TERMINAL` record instead. Nothing legitimate is excluded: a floor status is
only ever written after a capped response, and a capped response *is* a
successful attempt.

That judgement is made in exactly one place — `classify()` in
`scripts/lib/coverage-manifest.mjs`, which returns a `Verdict` (`kind` is one of
`unfinished` / `unbacked` / `floor` / `complete`, plus `blocked`). The engine,
the completeness invariant, the summary counts and the waiver check are all
views over that one verdict. If you are adding a caller that needs to know
whether a cell is finished, read the verdict; do not test `terminalStatus`
yourself. Every defect this file documents was two pieces of code answering that
question differently.

## When a cell can never succeed

Resume handles the transient failures — quota resets, network blips, 5xx, an
exhausted budget. Those are the ones that show as `incomplete_failed`, and they
need no waiver.

A cell Google will always reject is different. A permanent 400 or a geometry it
refuses is an HTTP 4xx, which is **not** a transient class, so such a cell is
reported under **`incomplete_missing_work`**, not `incomplete_failed`. Look
there — the run will otherwise sit at that status forever, because the
completeness gate is deliberately unwilling to look away from it. A cell stuck
at `incomplete_saturated` on the floor is the other case a waiver can clear.

> That `http4xx` routing depends on one property: the transport must put the
> HTTP status **on the thrown error**, because `classifyError` reads
> `error.status` and silently means `network` — a blocking class — without it.
> It did not, for a while: `scripts/nearby-sweep.mjs` threw a bare `new Error`,
> so every permanent 4xx classified as `network`, the `http4xx` branch was dead
> code in production, and this paragraph described behaviour that did not
> happen. The transport now lives in `scripts/lib/google-fetch.mjs` precisely so
> it can be tested — the old one was unreachable from a test, and the fixture
> double set `.status` by hand, so the offline suite passed over the broken
> path.

Three classes reach the waiver as **permanently failed**, and all three are
deliberately *outside* `BLOCKING_ERROR_CLASSES`, because every blocking class
promises that a retry might help:

| Class | What it means |
|---|---|
| `http4xx` | Google rejects this request and always will |
| `manifest_corrupt` | a `SUBDIVIDE` names a child but carries no geometry for it, so there is nothing to search and no resume can supply it |
| `types_exhausted` | Google rejected every `includedType` we know how to ask for, so there is nothing left to request |
| `api_rejected` | the API answered, rejected the request, and the transport declined to retry it — a non-retryable 5xx (501, 505–511, the Cloudflare 520–530 family), or an envelope status matching none of the classifier's numeric guards such as an HTTP 200 wrapping an error body |

**Every lane is in the PLAN.** The seed-name and SLA lanes are not cells — there
is no geometry to search and nothing to subdivide — but they are planned as
units (`seed:<region>`, `sla:<region>`) and must reach a terminal `DONE` like
anything else. They previously wrote nothing at all, so the invariant never
asked anything of them and a run could print COMPLETE while a whole lane had
failed. `classify` reads records rather than geometry, so a lane unit is judged
on the same evidence rule as a cell: a `DONE` is a claim, a successful `ATTEMPT`
is the evidence for it. A seed lane that hit its 5-result cap without a
confident match records `saturated_at_floor` — knowably short, and waivable once
the operator has checked those names by hand.

**`--max-calls` counts requests, not cell visits.** The transport retries
internally, so counting one "call" per cell visit let a run spend up to four
times the stated ceiling. The budget now gates on requests actually billed, and
a resume seeds its counter from the attempts already on record so the ceiling is
plan-level rather than a fresh budget per pass. The SLA lane is deliberately not
billed against it: that lane reads data.ny.gov, and this is a Google budget.

**How the class is chosen.** Retryability is the *primary* axis and it comes from
the transport, which is the only component that knows what actually happened.
`classifyError` asks "would the transport try again?" before it looks at status
families, because the blocking-ness is the contract and the class name is only
diagnostics. Ordering it the other way — status buckets first — inverted the
invariant in both directions at once: a non-retryable 5xx was filed as blocking
`http5xx` and could never be waived, while a transient 408/425 was filed as
non-blocking and offered to the operator as permanent.

Two details worth knowing when reading a manifest:

- A `error.code` below 100 is a gRPC canonical code, **not** an HTTP status.
  4, 8, 10 and 14 mean "try again later", so they stay blocking even when the
  HTTP envelope is a healthy 200.
- A 2xx whose body never parses is retried like any truncated read, but once
  every attempt is spent it becomes waivable rather than blocking — four
  consecutive failed reads are evidence, not a blip.

A cell whose **geometry is missing from the manifest entirely** is waivable for
the same reason, and is granted ahead of the never-attempted refusal — it can
never have been attempted, and refusing it would leave it visible, outstanding
and unsatisfiable forever.

Acknowledge the cell explicitly:

```bash
node scripts/nearby-sweep.mjs \
  --manifest data/coverage/brooklyn.jsonl \
  --ack-cell n:1:37:12 \
  --ack-reason "Google returns a permanent 400 for this cell"
```

It writes the acknowledgement and a terminal record, reprints the manifest
status, and exits `0` if the manifest is now complete, `2` if other work is
still outstanding, `1` if it refused. Repeat `--ack-cell` for several cells;
`--ack-reason` is mandatory and applies to all of them in that invocation.

**It refuses anything that is not genuinely stuck**, and says why:

| Refusal | Meaning |
|---|---|
| never been attempted | run or resume the sweep first — waiving it would report COMPLETE over a geography nobody searched |
| most recent attempt succeeded | the cell is not stuck |
| subdivision is unfinished | acknowledge the outstanding children instead, or resume to finish them — this walks the whole subtree, not just direct children |
| last failure was transient | quota windows reopen and networks recover, so resume handles it. Raise `--max-calls` or wait rather than waiving real geography |
| last failure was a rejected `includedType` | `unsupported_type` is the one class the engine resolves *within* a run, by dropping the rejected type and re-querying with what remains. A resume rebuilds the type list and finishes the cell, so waiving it discards geography that is still reachable |
| already acknowledged | no double-waivers |

A waiver **survives resume**: an acknowledged cell is not re-queried and its
status is not overwritten.

This is a **waiver, not a fix**. The cell's venues are not in the results and
the manifest says so permanently: every waiver is recorded against the cell id,
attributed to the operator, and carries its reason. Reach for it only when a
resume genuinely cannot clear the cell — never to make a red run go green
before a sweep.

## Review, then score

```bash
node scripts/adversarial-review-coverage.mjs \
  --input data/coverage/brooklyn-candidates.json \
  --borough brooklyn \
  --out data/coverage/brooklyn-reviewed.json \
  --csv data/coverage/brooklyn-reviewed.csv

node scripts/coverage-evaluate.mjs --input data/coverage/brooklyn-reviewed.json
```

`--borough` pins the whole queue's review scope. Omit it and each row is scoped
from its own address or SLA county, which is the right default for a mixed
queue.

## Offline check before spending anything

```bash
node scripts/coverage-fixture-run.mjs
```

Zero network calls. Exercises saturation subdivision, interruption, resume,
quota blocking, floor saturation, and the evaluator against the golden
fixtures. Run it after any change to the sweep before authorizing a paid sweep.
