---
decision: How should Next Bar be monetized, and should the next 3-6 months build a revenue path or a proprietary AI/ML asset?
depth: full
kill_criterion: Abandon Next Bar as a business if, by 2026-12-31, BOTH of these fail — (a) fewer than 50 weekly-active users inside ONE chosen NYC neighborhood, where weekly-active = opened the app in the prior 7 days and has completed >=10 pairwise comparisons, AND (b) fewer than 15 self-maintaining claimed venues, where self-maintaining = the venue updated its own hours/specials at least once in the prior 14 days. If exactly one passes, do not kill — re-scope to the side that worked.
exit: No inventory at risk. Cash stop-loss = $600 total out-of-pocket through 2026-12-31 (Google Places API + Vercel + any in-person onboarding spend); if exceeded before the kill date, stop spending and finish the experiment on free tiers only. Time stop-loss = 8 hrs/week; if Next Bar routinely exceeds that against a demanding full-time job, cut scope rather than sleep.
revisit_when: Beli announces a working revenue model (invalidates the "nobody has solved this" premise) OR any competitor ships venue-claimed specials in NYC OR the app crosses 1,000 MAU (promoted placement becomes modelable for the first time) OR the operator's available hours change materially.
fresh_until: 2026-10-25
updated: 2026-07-25
---

# Next Bar monetization — Living Decision Doc

## Recommendation

**Do not build either proposed path. Both are gated by the same missing input — users — and the sim shows
neither pays anything at current scale.** Kill the sentiment-ML idea outright: it is the textbook non-moat.
Do *not*, however, simply "focus on retention and wait" — that advice is calibrated for apps that have a
top-of-funnel, and Next Bar has none. Three months of retention work on <20 users produces a polished <25 users.

Instead, build the one venue-side product that is **accretive to growth rather than a tax on it**: a **free
claimed-venue surface** (venue claims its listing, corrects its hours, posts tonight's specials). This is the
Untappd mechanism at $0 — it gives venues daily-use operational value, gives the consumer app decision-time
content that cannot be scraped, and turns venue staff into the acquisition channel the operator cannot
otherwise afford. Money comes later, from that relationship, and never from discounts. Concurrently, **narrow
from 18 neighborhoods to one**; ~15 bars per neighborhood is too thin for the vibe-matcher to feel like magic.

## Why

The operator proposed (1) promoted placement + exclusive deals, and (2) a proprietary consumer-sentiment ML model.

**Path 2 dies on the evidence.** Foundation models are now classed as "strategic commodities" (Gartner); the
consensus test for a data moat is whether a well-funded competitor could buy or scrape equivalent data in 90
days. Public review/sentiment text is explicitly named as failing that test, and generic sentiment-classification
vendors were obsoleted by foundation-model endpoints. Building this is negative EV — it consumes the scarcest
resource (operator hours) on a capability that is free to competitors.

**Path 1's "deals" half dies on history.** Groupon and LivingSocial collapsed as daily-deals businesses;
merchants reported margin destruction and that deal users never became regulars. Bar-specific deal apps mostly
died. The mechanism is documented: discounts recruit users loyal to the discount, not the venue. Bars are the
worst case, because drinks are only high-margin at full price.

**Path 1's "promoted placement" half isn't wrong, it's just early** — worth ~$500/yr at today's scale.

**Where I was wrong.** My first draft said defer all monetization and pour 3-6 months into retention. Both
routed critics attacked this on the same grounds and I accept it: that is advice for a product with an
acquisition funnel. Next Bar's binding constraint is not retention — it's that almost nobody has ever opened it.
GLM and DeepSeek independently converged on a venue-side wedge as the fix, and independently converged on
"abandon the ML, narrow the geography." The convergence from two models attacking from different angles is
what moved me.

**Where the critics disagreed, and how it resolved.** GLM wanted claimed-venue *specials*; DeepSeek wanted
verified *hours*. Hours is the smaller, more honest first step (the venue is the only party who cares more
about correct hours than the consumer does, and wrong hours is a real trust problem for bar discovery), and
specials is the natural second. Ship hours-verification first, specials second — same surface either way.

## Evidence

- **Beli — the closest comparable, and the most important fact here.** Same pairwise mechanic, restaurant
  vertical. Raised ~$12M; ratings grew 2.5M (late 2022) → 6M (Q2 2023) → 58M (Q2 2025). As of Dec 2025 the
  Ivey Business Review states Beli "lacks a coherent revenue model," with OpenTable/SevenRooms partnerships
  and a paid Supper Club described as "insufficient revenue sources." Founders publicly refuse in-feed ads and
  say they would never charge for the base product. (iveybusinessreview.ca; startupsignals.substack.com;
  founder interview.) Third-party App Store estimates ~$11–61k/month, flagged low-confidence
  (rev.now; appcurrents.com, updated 2026-07-19). **Read: massive scale in this exact category has not
  produced a revenue model. Do not assume you will find one at n=20.**
- **Partiful** — free, no visible ads, no credible reported revenue product; pre-meaningful-revenue.
- **Untappd — the one clear success in the category.** Untappd for Business: $899–$1,199/yr per venue
  (~$75–100/mo), two tiers, no free plan, "tens of thousands" of venues. It sells (a) daily-use operational
  value — digital draft menus and TV displays — and (b) access to an existing consumer audience. It sells
  neither deals nor ads. (beermenus.com; brewlytics.ai; taplist.io comparison; help.untappd.com.) Paying-venue
  count is not disclosed — "tens of thousands" is vendor-comparison language, treat as approximate.
- **Deals graveyard.** Groupon/LivingSocial: merchants reported losing money and no conversion to regulars;
  LivingSocial sold to Groupon at a steep discount after the daily-deals model faded. (money.cnn.com 2016;
  vanityfair.com 2016; latimes.com 2016.) `[assumption]` Seated's and Hooch's specific shutdown reasons were
  offered by the research tool as general knowledge without a citation — treat as unverified.
- **Venue ad benchmark.** Yelp Ads: $150/mo minimum ($5/day); typical $300–1,500/mo; urban $600–2,500/mo.
  Restaurant CPC cited anywhere from $0.30–$6.00 depending on source and market — the sources contradict each
  other on CPC and agree on monthly spend. (icatchgroup.com; costbrief.com; localiq.com; business.yelp.com.)
- **No universal MAU threshold exists** for when venues start paying — sources agree venues buy *delivered
  local intent*, not MAU. The practical bar is whether a campaign can absorb $150–500/mo without starving on
  inventory. (Synthesis across the above.)
- **AI moat consensus.** Gartner classes foundation models as "strategic commodities"; McKinsey states the
  model itself is no longer the moat and privileged data only counts once embedded in products competitors
  can't match; 2026 defensibility playbooks set the test at "could a well-funded competitor buy or scrape it
  in 90 days." Public review and social sentiment data is explicitly named as non-exclusive. Model-only
  advantages are estimated at 12–36 months before erosion. (mckinsey.com; aiireland.ie; opag.io;
  institutepm.com; saasvaluation.app.)
- **Premature monetization.** Consensus is not to monetize consumer social before retention flattens.
  `[assumption]` The specific benchmarks commonly quoted — DAU/MAU >= 0.5, D30 30–40%, D90 >= 20–25% — were
  described by the research tool as operator lore rather than sourced; the underlying direction is well
  supported, the exact numbers are not. Do not treat them as hard gates.
- **Next Bar's actual scale** `[assumption, high confidence]`: <20 users. Inferred from the repo — the demo
  circle is two seeded profiles, the deploy is days old, and the loop notes describe the operator
  phone-testing personally. Not measured; there is no analytics instrumentation.

## Numbers

Bounding sim (40k draws, triangular inputs, ranges stated — **bounding, not predicting**). Full script:
`scratchpad/nextbar_monetize_sim.py`.

| Path | p10 | p50 | p90 |
|---|---|---|---|
| **A — venue SaaS** (400–2,000 serviceable venues, 0.5–8% attach, $30–100/mo, 3–8% monthly churn) | $6.8k ARR | **$17.0k ARR** | $37.1k ARR |
| **B — promoted placement @ today's ~50 MAU** | $202 | **$479** | $1,073 |
| **B — @ 10,000 MAU** | $40.3k | **$95.2k** | $213k |
| **B — @ 25,000 MAU** | $101k | **$241k** | $535k |

**Dominant lever (Path A):** freezing *attach rate* removes **64%** of the spread; serviceable venue count 32%;
price 14%; churn ~0% (it barely matters). Attach rate is itself a function of whether the app has an audience —
so the sim's own dominant lever routes back to users.

**Break-even framing:** 69 paying venues → $50k ARR at $60/mo (~8% of a 900-venue market); 208 venues → $150k
ARR (~23%). For scale: Untappd charges more than this and still needed a consumer network first.

**The number that decides it:** Path B pays **$479/yr today** and **$95k/yr at 10k MAU**. Nothing about
monetization is worth building until that MAU number moves. Path A's p50 of $17k ARR is a side income requiring
direct sales to bars — not a business, and not why you'd do this.

## Risks & life-first note

- **Time is the binding constraint, not money.** Big-4 consulting plus this leaves roughly one evening per
  workday. The single biggest risk is spreading those hours across 18 neighborhoods, an ML model, and a
  monetization surface, and finishing none. The whole recommendation is a scope *cut*.
- **In-person onboarding is the real cost.** DeepSeek's proposal (walk into bars, buy someone a drink to get an
  install) is the highest-conversion channel available and also the most expensive in the currency that's
  scarce. Budget it explicitly — 2 nights/week is the cap, and it competes directly with recovery time.
- **Venue-side selling is a different job.** Claiming venues means talking to bar managers. If that turns out
  to be draining rather than energizing, the whole venue wedge is wrong for this operator regardless of its
  merit — that's a legitimate reason to kill it that has nothing to do with the numbers.
- **Beli's shadow.** A well-funded competitor with 58M ratings hasn't found revenue here. The honest framing is
  that Next Bar is a *hobby that might become a business*, and the kill criterion exists to stop it from
  quietly becoming an unpaid second job.
- **Sunk-cost risk is high and specific.** The pairwise engine is genuinely good work with 507 tests behind it.
  That makes it emotionally expensive to hear that it's worth $0 until there are users. Both critics said so
  independently.

## Open questions

- **Which neighborhood?** East Village/LES and Williamsburg were both proposed. This should be decided by where
  the operator's actual social circle drinks, not by bar density — the density play only works if there's a
  real seed group.
- **Is the pairwise corpus a moat at all?** Both critics say not yet, and both gave thresholds: GLM ~500 active
  comparers × ~40 comparisons with pair overlap; DeepSeek ~10,000 users × 50+ comparisons. Both note it's
  replicable today for $15–25k of Prolific/MTurk labor. DeepSeek argues **GPS-verified check-ins** would be a
  better asset — harder to fake, passively acquired, legible to venues as footfall attribution — and Next Bar
  already has geolocation and here-now intent. Unresolved and worth its own decision.
- **Does anything here need a company?** Nothing in this doc requires incorporation, fundraising, or a
  "valuable company" framing yet. Whether Next Bar should be a business at all is a separate question the kill
  criterion will answer with data by 2026-12-31.
- **Not researched:** alcohol-adjacent advertising restrictions, App Store rules on venue promotions, and NYC
  liquor-authority constraints on advertising drink specials. These could constrain the specials board and
  should be checked before building it.
