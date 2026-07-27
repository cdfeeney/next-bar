# Next Bar — Work Ledger

Durable queue for the MVP. Lives in the repo on purpose: a chat session
can end, a model limit can be hit, a machine can reboot — this file
survives all of it. Update it when an item lands, don't rewrite history.

Last updated: 2026-07-27 (GLM sweep round)

## State of the world

- **Catalog: 846 verified venues**, 844 Google-enriched (pin + hours +
  business status), 841 with photos. 35 neighborhoods wired.
- Prod: https://next-bar-two.vercel.app
- Migrations **0017 (vibe votes)** and **0018 (analytics)** are APPLIED to
  production as of 2026-07-27. Objects verified present: tables
  `vibe_votes`, `analytics_events`; functions `cast_vibe_vote`,
  `get_circle_vibe_votes`, `bump_analytics_event`.

## Needs the operator (I cannot do these)

1. **Analytics env vars in Vercel** — the 0018 migration is applied but the
   feature stays dark until `ANALYTICS_ENABLED=1` and
   `NEXT_PUBLIC_ANALYTICS=1` are set in the Vercel project, plus the
   one-line disclosure on `/privacy`. See `docs/ANALYTICS-DESIGN.md`.
2. **Verdicts on flagged venues** — see "Awaiting operator verdict" below.

## Coverage — open

- **Thin neighborhoods** after the GLM round: Battery Park City 1,
  Morningside Heights 2, Washington Heights 2, Hudson Square 2, Kips Bay 2,
  Chinatown 3, Hamilton Heights 3, Inwood 3, NoHo 5, Ridgewood 5,
  Gowanus 6, Gramercy 7, Tribeca 7.
- These are hard cases, not oversights: GLM **declined** Battery Park City
  outright ("I can't verify which bars are open without risking shipping
  wrong venues"), and its uptown/outer-borough recall is thin. The next
  pass for these should feed **live web results** (Perplexity from the main
  loop) into the GLM packet as context rather than relying on recall.
- **Windsor Terrace: deliberately SKIPPED** — operator: "too far for our
  mvp launch".
- Re-run the social sweep (Reddit / Eater / Infatuation / Time Out /
  Instagram) after the next import round to measure the remaining gap.
  **Lesson from the first run: old Reddit threads and listicles surface
  venues that have since closed** — 15 of the socially-sourced venues came
  back CLOSED_PERMANENTLY from Google. Always Google-check social finds.

## The sweep pipeline (use this — it works)

Operator rule 2026-07-27: **GLM generates, Claude and Codex only review.**
See `~/.claude/rules/common/data-sweep-routing.md`.

    node ~/.claude/bin/harness-consult.mjs --route glm < prompt.md    # names
    node scripts/verify-glm-sweep.mjs <scratchpad-dir>                # Google adjudicates
    npx tsx scripts/import-bars.mts <file> --apply
    npx tsx scripts/enrich-table-bars.mts --apply --budget N
    npx tsx scripts/photos-for-table.mts --apply --budget N

Ask GLM for **compact pipe-delimited lines**, not JSON — a full JSON
request with lat/lng and blurbs blew the launcher's 420 s ceiling, while
`name | address | price | tags` returns in about 14 s. Let Google supply
addresses, coordinates, and hours; GLM only needs to supply the *name*.

`verify-glm-sweep.mjs` is where the quality comes from, and it is
deliberately deterministic rather than model-judged:
- `businessStatus` drops closed venues (11 in the first round),
- `primaryType`/`types` decides "is this actually a bar" — this caught a
  barber shop, a spa, a candy store, an apartment building and a dozen
  restaurants GLM had listed as bars,
- coordinates decide the neighborhood, so a mis-filed venue gets
  reassigned instead of rejected.

Dedup on the Google **place_id**, which catches accent and punctuation
variants ("Le Chéile" vs "Le Cheile") that name matching misses — and
dedup the new batch against **itself** as well as against the catalog.

First round: 118 candidates → 51 passed Google → 25 new after catalog
dedup → 22 after internal dedup → all 22 imported, enriched, photographed,
and pin-audited (0 mispinned).

## Features — open

- **Ticket flag for live-music venues** (operator ask, SOB's-class): badge
  and/or buy-link on the card and lightbox.
- **Photo thumbnails** — photos are now WebP at 640px (~57 KB avg). A
  smaller card-sized variant would cut the results screen further.
- **Reviews pass** for imported venues — the table-row variant of the
  review ingest doesn't exist yet; lightboxes for imported bars are
  text-light. Good use of the Google credits.
- **Second metro** (Long Island / Boston / Scotch Plains NJ / Cincinnati)
  needs the region model — 1–2 sessions of refactor. See
  `docs/SCALE-PLAN.md`.

## Awaiting operator verdict

- **Esters Wine Shop & Bar (Greenpoint)** — Google's nearest match is "The
  Esters" 0.62 mi away. Possibly renamed, possibly a different venue. Row
  is live but UNPINNED (no place_id, no hours), so it rarely surfaces.
  Keep / rename / delete?
- **Sundown (Bushwick)** — operator previously confirmed "open its a bar",
  but Google's text search matches a *hospital* 0.67 mi away. Left
  deliberately unpinned. Same three options.
- **Loopy Doopy** — operator said "Add", Google is emphatic that it is
  CLOSED. Not added pending an explicit override.

## Standing rules (learned the hard way)

- **Never push to a branch after its PR squash-merges** — the commit is
  orphaned. Check `gh pr view N --json state` BEFORE pushing, not after.
  Hit four times now; each recovery is a cherry-pick onto a fresh branch.
- **Trust Google on CLOSED_PERMANENTLY** — the verdict has been right
  every time it has been checked (42+ venues). Delete, and list the
  deletions for operator override.
- **Mekelburg's is an operator override** — attested open, Google insists
  closed, so `business_status` is deliberately NULL. Do not blindly
  re-enrich it.
- **Never launder a deterministic file read through a subagent.** Twice on
  2026-07-27 an agent asked to relay a JSON file returned a truncated or
  empty list, which silently corrupted a coverage diff (20+ bars we
  already had were reported as missing). Read files in the main loop; give
  agents judgment work, not fidelity work.
- **Pin fan-out subagents to Sonnet** (`model: 'sonnet'`). Letting ~33
  agents inherit a premium session model exhausted the account's Fable 5
  limit in a single turn. Full rule:
  `~/.claude/rules/common/subagent-model-budget.md`.
- **Routed consultants (GLM/DeepSeek) have no repo access.** A DeepSeek
  review on 2026-07-27 fabricated tool calls and reviewed files that don't
  exist in this repo. Verify every routed suggestion against the actual
  files, or prefer a reviewer that can read them.
- The importer takes **camelCase** `priceTier`/`lastVerified`; the
  verification workflows emit `price_tier`. Convert before importing or
  every row fails boundary validation.
