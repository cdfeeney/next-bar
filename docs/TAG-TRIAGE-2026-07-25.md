# Tag-Queue Triage — 2026-07-25 (N5)

Source: the 88-row operator queue in `REVIEW-MINING-2026-07-24.md`
(confirmed-but-medium-confidence rows from the B5c-3 review-mining pass).
Ranked by evidence strength, judged solely from the quotes/reasons in that
doc — no web research, no catalog edits. Totals: **20 apply + 27 discard +
41 middle = 88**.

Apply mechanics when approved: `scripts/review-mining-apply.mts` (dry-run
default, all-or-nothing) — do NOT hand-edit tags. Note `the-frying-pan |
loud` is a REMOVE; everything else in the top-20 is an add.

## 1. TOP-20 RECOMMEND-APPLY

| # | bar | tag | quote (trimmed) | why it clears the bar |
|---|---|---|---|---|
| 1 | alameda | garden | "The patio seating is very cute and cozy" | Fixed physical patio, corroborated by a second review ("I sat outside"). |
| 2 | blueprint | garden | "Cute patio in the back" | Concrete back patio; physical amenities don't need multi-review patterns. |
| 3 | fourth-avenue-pub | garden | "nice little patio out back" | First-hand attestation of a real outdoor space, exactly what `garden` denotes. |
| 4 | high-dive | garden | "I love the decor, and back yard" | Backyard praised even inside a complaint — credible physical-feature evidence. |
| 5 | the-jeffrey | garden | "I had a little party in the patio out back… open, outdoors" | Reviewer used the open outdoor back patio; matches catalog `garden` usage (Sea Witch precedent). |
| 6 | dba | old-nyc | "It's old school (and we like it that way)." | Two independent "old school" reads + 1994 pedigree in blurb = pattern, not anecdote. |
| 7 | trinity-place | old-nyc | "The history of this place is really cool, it was the reason we decided to go" | Historic character is the stated draw across two reviews; 1904 bank-vault blurb corroborates. |
| 8 | iona | pub | "Perfect place to stop for a perfect Guinness pint" | Two reviews center on Guinness quality/hospitality — Irish-pub character as a pattern. |
| 9 | stumble-inn | locals | "a classic neighborhood bar and one of our longtime NYC go-tos" | Multi-year regular usage plus corroborating make-friends vibe; fits dive/cheap identity. |
| 10 | oak-and-iron | locals | "the regulars were very friendly" | Regulars observed first-hand, plus "neighborhood dive" framing in two reviews and a since-2018 repeat visitor. |
| 11 | oharas-restaurant-and-pub | tourist | "No better place to go immediately after visiting the WTC area and Museum" | 2 of 3 reviews are WTC/museum visitors; blurb (memorial pub near Ground Zero) corroborates. |
| 12 | the-frying-pan | loud (REMOVE) | "Lowkey relaxed atmosphere" | Two reviews explicitly contradict `loud`, zero noise evidence anywhere; also cures the loud+buzzy co-assignment violation. |
| 13 | uva | loud | "it does get quite noisy once the tables fill up" | Explicit habitual noise claim — the exact evidence `loud` requires. Operator must resolve tension with curated `chill`/`romantic`. |
| 14 | 169-bar | loud | "groups of 20-somethings drunkenly sing Willie Nelson songs in unison at 1pm" | First-hand, concrete noise scene; coheres with dive/rough curation. |
| 15 | death-avenue-brewing | date | "What a delicious date night spot." | Unambiguous first-hand date-night usage; miner itself rated confidence high. |
| 16 | sea-witch | date | "booths and corners great for datenight" | Names the physical features (booths, corners) that make it a date spot — concrete, not metaphor. |
| 17 | somewhere-nowhere-nyc | jazz | "I went on a Wednesday when they have swing jazz" | "When they have" = recurring weekly programming, attended first-hand. Caveat: weeknight slot at a DJ club — operator call. |
| 18 | haswell-greens | live | "We did the piano brunch." | First-hand attendance at a named standing program — live performance as a venue feature. |
| 19 | the-paris-cafe | live | "Enjoyed the backdrop of the live jazz singer." | Live performer witnessed first-hand; same single-mention strength as the applied bathtub-gin `live` row. |
| 20 | three-diamond-door | dive | "It's divey, lowkey" | Explicit first-hand "divey," same form as the applied the-diamond row; dive+trendy coexist in catalog (the-commodore precedent). |

## 2. RECOMMEND-DISCARD (27)

| bar | tag | why |
|---|---|---|
| boxers-chelsea | dance | "Supposedly" — secondhand rumor of a dance floor the reviewer never saw. |
| coppelia-bar | tourist | Quote describes the neighborhood, not the bar's clientele; contradicts curated `locals`. |
| marquee-new-york | rough | Security-conduct grievance, not "rough dive" venue character — tag-mismatch. |
| kind-regards | buzzy | Quote is from a $30-cover scam complaint — engineered scarcity, wrong context. |
| kettle-of-fish | rough | One hostile smell complaint vs friendly/family-like other reviews — grievance, not character. |
| manhatta | instagrammable | View praise; no photo behavior mentioned — not the tag's meaning. |
| overstory | instagrammable | Panorama description, no photo evidence; redundant with `rooftop`. |
| the-frying-pan | instagrammable | Scenic views only; nobody mentions photos or shareability. |
| the-skylark | instagrammable | Generic "gorgeous/awesome views" praise — no photo-driven appeal shown. |
| trailer-park-lounge | instagrammable | Decor praise with zero photo/share evidence; proposal itself concedes this. |
| smalls-jazz-club | old-nyc | "Authentic and timeless" is vague vibe metaphor; club dates to 1994. |
| house-of-yes | house | EDM ≠ house; genre stretch, and the cited house DJ cancelled. |
| jungle-bird | speakeasy | Quote is about a speakeasy room *inside* an open tiki bar — would mislabel the whole venue. |
| warsaw | pub | Passing turn of phrase for a beer-hall concert venue; redundant with `beer`. |
| troost | live | Reviewer explicitly unsure: "live music sometimes… not sure how often" — stale/uncertain in-source. |
| the-sampler | dance | DJ presence with no dancing described; clashes with supported `chill`. |
| magic-hour | date | "Friends or as a couple" is an either-or; other reviews show groups/kid brunch. |
| cowgirl-seahorse | post-work | Hedged "seemed like" — speculation, not observation. |
| 230-fifth-rooftop-bar | post-work | "After-work drinks" appears in a generic list of uses — passing mention. |
| amsterdam-ale-house | buzzy | Crowded ≠ buzzy, and the same review says "everyone in their own little world." |
| babys-all-right | loud (remove) | "Low-key atmosphere" is vibe, not volume — no contradiction of `loud` at a live venue. |
| blondies-sports-bar | loud (remove) | One "chill" game day cannot overturn a sports bar's blurb-supported noise. |
| burp-castle | indie (remove) | Quiet doesn't contradict `indie` (independent/offbeat); quote also partially garbled. |
| oak-and-iron | cocktail (remove) | Absence-of-mention reasoning; "strong drinks, cheap prices" contradicts nothing. |
| pearls-social-and-billy-club | cocktail (remove) | Quote proves cocktails ARE served — self-defeating remove. |
| pianos | buzzy (remove) | Hedged "I feel like" in an angry cover-charge review, contradicted by blurb and another review. |
| young-ethels | buzzy (remove) | Actively contradicted in-doc: review 1 "BLAST"/music night and blurb curate the buzz. |

## 3. MIDDLE (41 — optional review, lower priority)

bar-sixtyfive(romantic), bar-toto(locals), becketts-bar-grill(locals),
birdys(buzzy), black-horse-pub(buzzy), bondurants(chill),
caledonia-bar(locals), clandestino(buzzy), dante-west-village(tourist),
death-avenue-brewing(cocktail), four-horsemen(buzzy), freddys-bar(chill),
hotel-delmano(old-nyc), jg-melon(tourist), killarney-rose(chill),
las-lap(post-work), left-hand-path(locals), little-branch(chill),
manhatta(romantic), maries-crisis-cafe(buzzy), metropolitan-bar(old-nyc),
monarch-rooftop(romantic), niagara(dance), owl-farm(cocktail),
palace-cafe(buzzy), parcelle(romantic), peter-mcmanus-cafe(chill),
pony-bar(chill), raines-law-room(post-work), refinery-rooftop(tourist),
rocka-rolla(buzzy), rum-house(tourist), russian-vodka-room(dive),
skinny-dennis(chill), skinny-dennis(dance), the-double-windsor(post-work),
the-full-shilling(chill), the-paris-cafe(jazz), the-spaniard(buzzy),
the-ten-bells(buzzy), young-ethels(chill)
