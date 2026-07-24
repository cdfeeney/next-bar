# Catalog Cleanup — 2026-07-25 (N8 / B5c-2 identity + dead-bar pass)

Source: `scripts/refresh-report.json` (Places weekly refresh flags — 31
CLOSED_PERMANENTLY, 1 CLOSED_TEMPORARILY, 1 no-place-id) + the quarantined
wrong-venue match (`bootleg-bar`). Two-agent gate per the nightlog: first
pass proposed removal for all 31; an ADVERSARIAL second agent (fresh
context, no network, name+address reasoning only) then tried to refute
each. **Only removals confirmed by BOTH were applied.** Matching already
hard-filters CLOSED_PERMANENTLY, so every deferred flag costs nothing at
runtime.

## Applied removals (4 — confirmed by both agents)

| id | Venue | Verdict basis |
|---|---|---|
| `pier-a` | Pier A Harbor House, 22 Battery Pl (FiDi) | Operator bankruptcy + closure well-documented; name/address match. Demo circle reference swapped to `westlight` (open rooftop). |
| `max-fish` | Max Fish, 120 Orchard St (LES) | The relocated LES institution's permanent closure is well-known; arc matches the real venue. |
| `pouring-ribbons` | Pouring Ribbons, 225 Ave B 2nd Fl (EV) | Acclaimed cocktail bar's ~2020 permanent closure widely reported. |
| `ramona` | Ramona, 113 Franklin St (Greenpoint) | Venue churn: successor (`lulus`) took the space — closure confirmed by that succession itself. |

## Deferred to operator (27 CONTESTED + 3 non-removal flags)

The adversarial agent contested 27 removals — either it knows the venue as
still-operating (e.g. Saint Vitus, Spuyten Duyvil, The Rusty Knot,
Achilles Heel, Our Wicked Lady, West End Hall, McAleer's, Peoples Wine),
or the name is generic enough for a wrong-venue Google match (`the-park`,
`underdog`, `matchless`, `bar-4`), or it simply lacks closure knowledge
(default-CONTEST rule: a wrong removal deletes a live bar; a deferred
true-closure just waits, already suppressed from suggestions).

**Operator morning action:** spot-check the 27 against the live map/web.
Google's businessStatus is usually right — many of these are probably
genuine closures the agent's knowledge predates. But four famous "still
open" contests (saint-vitus-bar, spuyten-duyvil, achilles-heel,
our-wicked-lady) deserve a real look before deletion: if Google is wrong
about THOSE, the wrong-venue matcher needs attention, not the catalog.

Contested list: manhattan-cricket-club, subway-inn, gallow-green,
achilles-heel, saint-vitus-bar, pencil-factory, gotham-city-lounge,
our-wicked-lady, the-park, vintry-wine-and-whiskey, mission-dolores,
american-trash, the-rusty-knot, spuyten-duyvil, underdog, casa-mezcal,
peoples-wine-bar, the-rookery, chelsea-music-hall, lulus, matchless,
northern-territory, bar-4, kinsale-tavern, mcaleers-pub, the-parlour,
west-end-hall.

Non-removal flags, no action tonight:
- `raines-law-room` — CLOSED_TEMPORARILY: keep; refresh will resolve.
- `bright-room` — no-place-id: Places search found nothing; operator
  should verify the venue exists under a different name or drop it.
- `bootleg-bar` — QUARANTINED wrong-venue match: Google matched a
  "Bootleg Bar" at lat 40.63, lng −73.64 (Long Beach, LI — far outside
  the service bbox). Catalog entry retained untouched; the wrong patch is
  excluded. Operator: re-run the match with a tighter query or hand-pin
  the correct googlePlaceId.

## Churn-address note (the interesting case)

`ramona` and `lulus` both claim 113 Franklin St, Greenpoint. The gate
resolved them OPPOSITE ways on purpose: Ramona is the predecessor
(removed), Lulu's the live successor (kept, contested against Google's
closed flag — Google may be conflating the two listings). This is exactly
the "identity verification before trusting fetched data" failure mode the
B5c spec (pokeprice wrong-variant lesson) exists to catch.

## Mechanics

Removals were whole-entry deletions from `bars.ts` / `bars.extra.ts`
(multi-line blocks) and `bars.expansion.ts` (single-line entries),
verified by `bars.test.ts` integrity guards (unique ids, no duplicate
venues, bbox) plus the full gate run. Catalog count: 269 → 265.
