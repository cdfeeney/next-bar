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

## When a cell can never succeed

Resume handles the transient cases: quota resets, network blips, an exhausted
budget. But a cell Google will always reject — a permanent 400, a geometry it
refuses — would otherwise hold the run at `incomplete_failed` forever, because
the completeness gate is deliberately unwilling to look away from it.

Acknowledge that cell explicitly:

```bash
node scripts/nearby-sweep.mjs \
  --manifest data/coverage/brooklyn.jsonl \
  --ack-cell n:1:37:12 \
  --ack-reason "Google returns a permanent 400 for this cell"
```

It writes the acknowledgement and a terminal record, reprints the manifest
status, and exits. Repeat `--ack-cell` for several cells; `--ack-reason` is
mandatory and applies to all of them in that invocation.

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
