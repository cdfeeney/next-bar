# Contested-Closure Verdicts — 2026-07-25 (N4)

Re-verification of the 27 contested closures from
`CATALOG-CLEANUP-2026-07-25.md` (+ the `bright-room` no-place-id flag).
Method: 4 parallel web-verification agents, zero Google API cost, sources
= venue sites/Instagram, local press (Greenpointers, West Side Rag,
Gothamist, Eater, Brooklyn Paper…), Yelp/Foursquare status flags with
dates. NO catalog edits in this pass — verdicts + recommendation only.

## Headline

**26 of 27 CLOSED, 1 UNCLEAR, 0 OPEN.** Google's `businessStatus` was
right in every case where a verdict was reachable — including all four
"famous still-open" contests (Saint Vitus, Spuyten Duyvil, Achilles Heel,
Our Wicked Lady). The adversarial agent's model-knowledge simply predates
a brutal 2024–2026 closure wave (and in several cases the bars died in
2013–2019, i.e. **before this catalog was ever authored** — they should
never have been added).

**Recommended action:** one removal PR deleting the 26 CLOSED bars
(matching hard-filters CLOSED_PERMANENTLY already, so users never see
them — this is catalog hygiene, not a behavior change). Keep
`chelsea-music-hall` pending, keep `raines-law-room`
(CLOSED_TEMPORARILY), drop `bright-room` as a data error (26 + 1 = 27
removals if included). Say the word and the removal PR follows.

## Verdicts

### Batch A

| id | verdict | evidence | note |
|---|---|---|---|
| manhattan-cricket-club | CLOSED | Yelp CLOSED (Jun 2026); marshal seizure of the space (WestSideRag Jan 2020) | Host restaurant Burke & Wills also closed. |
| subway-inn | CLOSED | NY1/ABC7/Gothamist (Dec 2024, final day Dec 28); Yelp CLOSED (Jul 2026) | Had already moved 1140→1154 2nd Ave in 2022; no reopening as of Jul 2026. |
| gallow-green | CLOSED | McKittrick closed Jan 2025 with Sleep No More's final show (BroadwayWorld Jan 6 2025); Yelp CLOSED | Rooftop died with the building's operation. |
| achilles-heel | CLOSED | Greenpointers (Feb 10 2026): closed after 13 yrs, last service Feb 8 2026 | Recent closure — post-dates the adversarial agent's knowledge. |
| saint-vitus-bar | CLOSED | Gothamist/Hoodline/BrooklynVegan (Jul 2026): Greenpoint location shut; relocating to 428 Troutman St, Bushwick, fall 2026 | **RE-ADD CANDIDATE** at the new address once open (first shows Sept 2026). |
| pencil-factory | CLOSED | Greenpointers (Mar 2025): lease-end close Jul 27 2025; successor "Sonny's Corner" open in the space (Greenpointers Feb 23 2026) | **BENCH CANDIDATE**: Sonny's Corner, 142 Franklin St. |
| gotham-city-lounge | CLOSED | Bushwick Daily/Bleeding Cool (Apr 2019 final party); Yelp CLOSED (Jun 2026) | Closed 2019; space converted to private use. |

### Batch B

| id | verdict | evidence | note |
|---|---|---|---|
| our-wicked-lady | CLOSED | Gothamist + Time Out NY (Jul 17 2025); Yelp CLOSED (May 2026) | Closed Jul 21 2025 after landlord blocked sale despite $42k GoFundMe. |
| the-park | CLOSED | NY1 (Sep 6 2019); NY YIMBY: condo redevelopment at 118 Tenth Ave (Feb 2026) | Not a wrong-venue match — closed 2019, site being demolished. |
| vintry-wine-and-whiskey | CLOSED | Yelp CLOSED, successor Gran Via at same address (Apr 2026) | Gran Via itself has since closed too. |
| mission-dolores | CLOSED | Brew York (Feb 2021); Patch: Seven Bridges took the space | Pandemic casualty. |
| american-trash | CLOSED | Upper East Site (Dec 2024); Yelp CLOSED (Dec 2025) | The Raven Pub announced for the space. |
| the-rusty-knot | CLOSED | Eater (2020) + owner IG; Yelp CLOSED (Jun 2026) | Closed 2020, landlord dispute. |
| spuyten-duyvil | CLOSED | News 12 Brooklyn + Brew York (Apr 2024) | Closed for good Apr 21 2024 after 20 years. |

### Batch C

| id | verdict | evidence | note |
|---|---|---|---|
| underdog | CLOSED | Yelp CLOSED (Jul 2026) + Foursquare, both address-matched | Not a wrong-venue match. |
| casa-mezcal | CLOSED | Yelp CLOSED (Jul 2026); Gayot closure notice | No recent activity anywhere. |
| peoples-wine-bar | CLOSED | Market Line food hall closed entirely Apr 1 2024 (Lo-Down/Time Out); Yelp CLOSED | Died with its host food hall. |
| the-rookery | CLOSED | Owners' own IG closure announcement (Oct–Nov 2023); Yelp CLOSED (Jul 2026) | The 2021 "Rookery Returns" piece is a stale COVID-reopening story. |
| chelsea-music-hall | **UNCLEAR** | Chelsea Market still lists it; own site live but "no upcoming events"; zero 2025–26 public events anywhere; Yelp does NOT flag closed | Private-events venue gone publicly dormant. Keep pending; re-check next refresh. |
| lulus | CLOSED | Gothamist: Lulu's closed Aug 9 **2014**; space is restaurant Sereneco since Aug 2021; Yelp CLOSED | **CLEANUP-DOC CORRECTION: the succession was backwards — Ramona followed Lulu's, not vice versa. Both rightly gone; 113 Franklin is not a bar.** |
| matchless | CLOSED | Closed 2018 (Brokelyn/Patch); building DEMOLISHED Jun 2023 (Greenpointers/BKMAG) | The building no longer exists. |

### Batch D

| id | verdict | evidence | note |
|---|---|---|---|
| northern-territory | CLOSED | Greenpointers (Apr 2019): 12 Franklin redeveloped into offices; Yelp CLOSED (Apr 2026) | Never reopened. |
| bar-4 | CLOSED | Brooklyn Paper/Patch: final day Aug 15 **2013**; Yelp CLOSED (Jul 2026) | Address-matched; dead 13 years. |
| kinsale-tavern | CLOSED | DNAinfo (Nov 2015): handed to new operators; Yelp CLOSED (May 2026) | Listing dead a decade. |
| mcaleers-pub | CLOSED | West Side Rag (Apr 2018): closed after 65 years; space now Frank Mac's | **BENCH CANDIDATE**: Frank Mac's, 425 Amsterdam Ave. |
| the-parlour | CLOSED | Own Facebook farewell + storefront on rental market (Oct 2021); Yelp CLOSED (Jun 2026) | 23-year run ended 2021. |
| west-end-hall | CLOSED | West Side Rag (Mar 2019): abrupt closure; Yelp CLOSED (May 2026) | No reopening since. |
| bright-room | **UNCLEAR — likely no such venue** | Zero hits across Yelp/Untappd/Greenpointers/Time Out/Infatuation/2025-26 opening roundups — not even a stale listing | Places' no-place-id was correct. Likely a catalog data error or misspelled name. Recommend removal with the 26. |

## Successor / re-add leads (for the bench)

- **Sonny's Corner** — 142 Franklin St, Greenpoint (ex-Pencil Factory), open since ~Feb 2026.
- **Frank Mac's** — 425 Amsterdam Ave, UWS (ex-McAleer's), Irish pub.
- **Saint Vitus** — 428 Troutman St, Bushwick relocation, target fall 2026 (watch; not open yet).
- (Historical: Gran Via replaced Vintry at 57 Stone St but has itself closed — no lead.)

## Process lesson

Model-knowledge adversarial contests are systematically stale for venue
liveness: 26/27 wrong here. The two-agent gate correctly protected
against wrong-venue matches (its real job), but "I know this bar as
open" should carry near-zero weight against a dated `businessStatus`
flag + web verification. Future dead-bar passes: web-verify FIRST, use
the adversarial pass only for identity/address mismatches.
