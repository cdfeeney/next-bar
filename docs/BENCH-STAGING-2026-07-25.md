# Bench Staging List — 2026-07-25 (N6)

The ready-to-enrich bench: expansion-4 bench (24) + expansion-5 bench (9)
+ 1 successor lead, ALL re-verified open web-side today (agents, zero
Google cost), deduped against the live catalog (401 entries).
**Staging total: 33** (ardesia dropped — already landed via expansion-5;
Frank Mac's lead dropped — closed 2021, space has churned twice since).

NO enrichment and NO catalog merge in this pass. Landing them is the
attended step:

    node scripts/refresh-places.mjs --only <ids...>   # dry-run first

then the standard expansion mechanics (entries into a new
`bars.expansion6.ts` → registered in **bars.ts AND catalog.slim.ts AND
refresh-places BAR_FILES** — the three-places rule).

## Conflicts / caveats for the enrichment run

- **madelines @ 113 Franklin St, Greenpoint**: conflicts with today's
  N4 finding that 113 Franklin = restaurant Sereneco since 2021 (the
  Lulu's/Ramona space). Either Madeline's succeeded Sereneco or an
  address is wrong — let the Places dry-run adjudicate before merge.
- **alibi-lounge**: open but chronically at-risk (past lease/GoFundMe
  scares) — trust the fresh Places businessStatus over the bench row.
- **international-bar**: canonical address is the NEW 102 1st Ave (the
  old 120½ 1st Ave listing shows closed — that's the move, not a
  closure).
- **lanterns-keep**: relaunched Mar 2 2026 as a Da Toscano aperitivo
  concept inside the Iroquois — name/blurb may need updating at merge.
- **sonnys-corner**: new this pass (ex-Pencil Factory space); no bench
  entry data yet — draft tags `locals, cocktail, chill`, priceTier 2,
  from Greenpointers/Infatuation coverage.

## Staging list (33)

### Expansion-4 bench (23 after ardesia dedupe) — all OPEN (verified 2026-07-25)

| id | name | hood | address | evidence |
|---|---|---|---|---|
| bar-americano | Bar Americano | Greenpoint | 180 Franklin St | Yelp Apr 2026; own site live |
| madelines | Madeline's | Greenpoint | 113 Franklin St ⚠ | Yelp Jul 2026; own site live — see conflict above |
| hide-and-seek | Hide & Seek | Greenpoint | 593 Manhattan Ave | Yelp Jun 2026; jazz/DJ events ongoing |
| amity-hall-uptown | Amity Hall Uptown | UWS | 982 Amsterdam Ave | Yelp Jul 2026; own site live |
| the-hoptimist | The Hoptimist | UWS | 422 Amsterdam Ave | Yelp Jun 2026; own site live |
| westland-roe | Westland Roe | UWS | 174 W 72nd St | Yelp Jul 2026; own site live |
| purgatory | Purgatory | Bushwick | 675 Central Ave | JamBase Jul 2026 shows; Yelp Jul 2026 |
| carousel | Carousel | Bushwick | 36 Wyckoff Ave | Yelp Jul 2026; 2026 events on dice/RA |
| rebeccas | Rebecca's | Bushwick | 610 Bushwick Ave | Own site "Open Daily 4pm-4am"; Yelp Jun 2026 |
| club-cumming | Club Cumming | East Village | 505 E 6th St | 11 upcoming Eventbrite events; 2026 schedule |
| the-scratcher | The Scratcher | East Village | 209 E 5th St | Yelp Jun 2026 with hours |
| international-bar | International Bar | East Village | 102 1st Ave ⚠ | Yelp Jun 2026 at NEW address; own site live |
| bar-veloce-chelsea | Bar Veloce | Chelsea | 176 7th Ave | Own site lists Chelsea + hours; Yelp Jul 2026 |
| eagle-nyc | The Eagle NYC | Chelsea | 554 W 28th St | Own site "Mr. Eagle NYC 2026"; Yelp Jul 2026 |
| fleur-room | The Fleur Room | Chelsea | 105 W 28th St (Moxy) | Moxy site active; Jul 4 + NYE 2026 listings |
| stout-nyc-fidi | Stout NYC FiDi | FiDi | 90 John St | Own FiDi page live; Yelp Jul 2026 |
| the-press-room | The Press Room | FiDi | 28 Liberty St (Alamo) | Alamo actively showing films Jul 2026 |
| ryan-maguires | Ryan Maguire's Ale House | FiDi | 28 Cliff St | Yelp Jul 2026; own site + trivia league |
| lanterns-keep | Lantern's Keep | Midtown | 49 W 44th St (Iroquois) ⚠ | Relaunched Mar 2 2026 (What Now NY) — new concept |
| nothing-really-matters | Nothing Really Matters | Midtown | 50th St 1-train entrance | Yelp Jul 2026 (202 reviews); own site live |
| treadwell-park | Treadwell Park | UES | 1125 1st Ave | Own UES page live; Yelp reviews thru Jun 2026 |
| plug-uglies | Plug Uglies | UES | 1495 1st Ave | Yelp Jul 2026; Infatuation review of new location |
| drunken-munkey | The Drunken Munkey | UES | 338 E 92nd St | Own site live w/ reservations; Yelp Jul 2026 |

### Expansion-5 bench (9) — all OPEN (verified 2026-07-25)

| id | name | hood | address | evidence |
|---|---|---|---|---|
| the-waylon | The Waylon | Hell's Kitchen | 736 10th Ave | Yelp Jul 2026 hours to 4am; OpenTable 2026 |
| mercury-bar-west | Mercury Bar West | Hell's Kitchen | 659 9th Ave | Yelp Jun 2026; active IG. Sports bar est. 1998 |
| pearl-box | Pearl Box | SoHo | 357 W Broadway | Yelp Jul 2026; Infatuation live; OpenTable active |
| 161-lafayette | 161 Lafayette | SoHo | 161 Lafayette St | Yelp Jul 2026; active IG. Karaoke dive |
| alibi-lounge | Alibi Lounge | Harlem | 2376 Adam Clayton Powell Jr Blvd ⚠ | Yelp Apr 2026; at-risk — see caveat |
| the-wolfhound | The Wolfhound | Astoria | 38-14 30th Ave | Yelp Jul 2026; own site live. Irish pub |
| olivers-astoria | Oliver's Astoria | Astoria | 37-19 Broadway | Yelp Jul 2026; own site w/ 2026 events |
| icon-bar | Icon Bar | Astoria | 31-84 33rd St | Yelp Jul 2026; active IG. Gay bar/club |
| record-room | Record Room | LIC | 47-09 Center Blvd | Yelp Jul 2026; own site w/ hours. Vinyl lounge |

### New this pass (1)

| id | name | hood | address | evidence |
|---|---|---|---|---|
| sonnys-corner | Sonny's Corner | Greenpoint | 142 Franklin St | Greenpointers Feb 23 2026 "now open" (ex-Pencil Factory); Infatuation review; active IG |

## Future watch (not staged)

- **Saint Vitus** — Bushwick relocation (428 Troutman St), target fall
  2026, first shows announced Sept 2026. Re-add when actually open.
