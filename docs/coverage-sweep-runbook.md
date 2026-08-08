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

### What a terminal status attests to

Per-cell `DONE` records carry a `detail` object, and for `cleared` it is the
only way to tell how the cell was finished:

| `DONE` record | What actually happened |
|---|---|
| `unsaturated`, `detail.count` | The cell was searched and came back under the cap |
| `cleared`, `detail.children` | The cell capped, was subdivided, and every child finished |
| `cleared`, `detail.resumed: true` | **No search happened on this resume.** The children's records already showed the subtree was covered, so the run recorded the parent's status and moved on |
| `saturated_at_floor`, `detail.reason` | Still capping at the floor — recall is knowably short here |
| `ack_terminal`, `detail.reason` | An operator waiver. Backed by a matching `ACK_TERMINAL` record; a `DONE` claiming this word without one is treated as unfinished |

A `cleared` parent's venues live in its **children**, not in its own page, so do
not read a settled parent's own place count as the coverage of that geography.

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
| subdivision is unfinished | acknowledge the outstanding children instead, or resume to finish them |
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
