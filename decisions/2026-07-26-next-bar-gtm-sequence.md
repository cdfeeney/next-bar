---
decision: In what order should Next Bar go to market from pre-launch — beta users, venue claims, or neighborhood narrowing — and what does the operator use to run the company while that happens?
depth: full
kill_criterion: Unchanged from 2026-07-25 and not reopened here — abandon Next Bar as a business if, by 2026-12-31, BOTH (a) fewer than 50 weekly-active users inside ONE chosen NYC neighborhood (opened the app in the prior 7 days, >=10 pairwise comparisons) AND (b) fewer than 15 self-maintaining claimed venues (updated own hours/specials in the prior 14 days). Exactly one passing is a RESCOPE, not a kill. This document adds a SEQUENCE kill: if by 2026-09-30 the operator has not personally recruited 5 claimed venues in the chosen neighborhood by walking in, abandon the venue-first sequence specifically and fall back to consumer-only, because the wedge this whole plan rests on will have been shown to need a salesperson the company does not have.
exit: No inventory. Cash stop-loss stays $600 total through 2026-12-31 (Google Places + Vercel + onboarding spend); email/outreach tooling spend is $0 by construction — the orchestrator drafts, the operator sends from an existing mailbox. Time stop-loss 8 hrs/week; if exceeded against the day job, cut scope rather than sleep.
revisit_when: The operator's available hours change materially OR a competitor ships venue-claimed specials in NYC OR the chosen neighborhood clears 50 WAU (promoted placement becomes modelable) OR any venue asks to pay for something (the finance module's wake trigger) OR CAN-SPAM guidance changes materially.
fresh_until: 2026-10-26
updated: 2026-07-26
---

# Next Bar go-to-market sequence — Living Decision Doc

## Recommendation

**Do the four things in this order, and refuse to start the next one early.**

1. **Narrow to ONE neighborhood** (the operator picks; the criterion is where they already drink, because
   step 2 is a walk, not a campaign). 265 bars across 18 neighborhoods is ~15 per neighborhood — too thin
   for a vibe-matcher to feel like magic anywhere.
2. **Walk in and claim 5–15 venues by hand.** In person. Not email. This is the step that decides whether
   the whole venue wedge is real, and it is the step most likely to be skipped because it is the only one
   that cannot be done from a laptop at 11pm.
3. **Ship the venue-claim surface and the share-funnel analytics** — the two pieces of software this plan
   needs, and the only two.
4. **Then** recruit beta users, and only inside that one neighborhood.

**Cold email to bar owners is step 3.5, not step 1**, and it is capped at 5 drafts per cycle that a human
reads and sends. **Do not sell advertising**; when money eventually comes, it comes as a venue upsell on a
relationship that already exists, never as a third-party ad network on the discovery surface.

**The operator's headquarters is this repository.** Not a dashboard, not a web app, not a second GitHub org.

## Why

### The sequence is supply-first because thin coverage kills consumer retention

The documented pattern for local two-sided markets is: narrow the wedge to one geography, manually recruit
the constrained side, reach local liquidity, and only then acquire consumers. Uber launched one city and
recruited drivers weeks before riders; Nextdoor is built on neighborhood-level atomic networks. Marketplace
playbooks put the pre-demand threshold at roughly **20+ active suppliers / 50+ live listings**, with the
first 25–50 recruited by hand with concierge onboarding. Beta users onto an app with zero claimed venues and
15 thin listings do not churn politely — they churn on the first session and they do not come back for v2.

### Venues do not recruit venues, and that changes what "network effect" means here

The 2026-07-25 decision adopted the Untappd shape (operational value to the venue, free) over the Groupon
shape (discounts). That still holds. But the asymmetry is worth writing down: **drinkers recruit drinkers;
venues do not recruit venues.** The venue side is an acquisition channel for *users* (staff tell customers)
and a content moat, not a self-propagating network. Plan for a supply side that must be recruited one
conversation at a time, indefinitely, and the 5-venue September check is the cheap test of whether the
operator can actually do that at 8 hrs/week.

### Defensibility is the wrong question at zero users

Beli — same pairwise mechanic — raised ~$12M, holds 58M ratings, and still has no coherent revenue model.
Scale in this category has not produced revenue, so "how do we monopolize as we scale" is a question about a
state this company has never been in. The question that pays rent today is **"would any single user be upset
if this disappeared next Tuesday?"** If the honest answer is no, a moat protects nothing. The only durable
asset available at this size is *venue-maintained decision-time content* (tonight's specials, correct hours)
— which is not scrapable in 90 days precisely because it does not exist anywhere else. That is the moat, and
it is built by step 2, not by strategy.

### Advertising: not now, and never third-party

Ads monetize attention; there is none to monetize. Promoted placement pays roughly $479/yr at today's scale
versus ~$95k at 10k MAU, so it is not wrong, just early. When it arrives it should be **featured placement
sold to claimed venues** — an upsell on a relationship — and never a third-party ad network, which would
corrupt the ranking surface that is the entire product. A discovery app whose results are for sale has
nothing left to defend.

### Cold outreach: legal, capped, and drafted-not-sent

Cold B2B email is legal and **not exempt** from CAN-SPAM; the FTC's guide is explicit that "the law makes no
exception for business-to-business email," and the civil penalty ceiling is **$51,744 per violating email**.
A compliant message needs truthful headers, a non-deceptive subject, **identification as a commercial
message**, a valid physical postal address, and a one-step opt-out that keeps working for **30 days** and is
honored within **10 business days**.

Those requirements are now enforced in code (`scripts/ceo-outreach.mjs`), not in a checklist someone
remembers: the opt-out, postal address, and commercial disclosure must each appear **in the body a human
will read**, recipients come only from a human-committed contact file the agent may read and never write,
the cap is 5 per cycle as a module constant, and any number quoted at a venue must match a metric that was
actually measured. The orchestrator has no transport. It drafts; a person sends; the cycle closes only on a
`sent_receipt_` event the operator records. The audience is ~265 venues — finite, small, and shared with
every future attempt — so the constraint that matters is not deliverability, it is that one bad batch spends
the audience permanently.

### AI instead of employees — what that actually means here

The honest version is narrow. AI replaces **drafting, analysis, instrumentation, and the discipline of
asking the same uncomfortable question every week**. It does not replace the walk-in, the conversation with
a bartender, or the decision to stop. The dormant-module design already encodes this: `hiring` wakes only
when operator hours hit zero, `finance` only when revenue exceeds zero, `venue_sales` only at 5 claimed
venues. Nothing is staffed — by a person or a model — before there is work for it.

The real risk of an AI operating layer for a solo founder is **substitution**: a fluent strategy partner is
the most comfortable possible replacement for talking to strangers, and a tired operator with a demanding
day job will take the comfortable option. Hence the discovery floor — the cycle refuses to run in a week
with zero customer conversations. That rail is worth more than any playbook in this document.

### What the app is missing

In priority order, and deliberately short: **(1) a measurable funnel** — `wau` is `null`, so nothing anyone
claims about growth is checkable and the kill criterion cannot be evaluated; **(2) the venue-claim surface**
— the wedge does not exist yet; **(3) density in one neighborhood** — a data/curation job, not a feature;
**(4) a reason to open it twice** — everything above is a first-session problem, and none of it is a
retention answer. Item 4 is not scheduled, on purpose: retention work on <20 users produces a polished <25
users.

### The headquarters

This repository. `ceo/state.json` is the state, `ceo/reports/` is the record, `decisions/` is the memory,
git history is the audit log, and the CLI is the interface. A dashboard would be a fifth surface to maintain
for an audience of one who already reads markdown. Revisit only if a second person joins.

## Evidence

- **CAN-SPAM:** required elements, no B2B exemption, $51,744 per-email ceiling, 30-day opt-out validity,
  10-business-day honor window — FTC CAN-SPAM Act Compliance Guide (ftc.gov business guidance), 2026.
- **Supply-first cold start:** Uber's single-city driver-first launch; Nextdoor's neighborhood-atomic
  network; marketplace playbook thresholds of 20+ active suppliers / 50+ listings and 25–50 hand-recruited
  suppliers before scaling demand. [Playbook thresholds are general marketplace guidance, not Next Bar
  data — treat as a prior, not a target.]
- **In-person beats cold email early:** founder-led visits and calls are the documented first move; cold
  email is described as an acceptable weaker substitute, only when highly personalized.
- **Beli:** ~$12M raised, 58M ratings, no coherent revenue model (Ivey Business Review, Dec 2025) — via
  `decisions/2026-07-25-next-bar-monetization.md`.
- **Repository, verified 2026-07-26:** `ceo/state.json` reads `wau: null`, `claimed_venues: 0`,
  `operator_hours_available: 8`; 265 bars / 18 neighborhoods; cycle-1 report recommends share-funnel
  analytics; `main` is protected (PR + `gates` CI).
- [assumption] The operator can reach one chosen neighborhood in person on a weekday evening. If false,
  the whole sequence changes and this document is wrong rather than merely optimistic.

## What would change this

The 5-venue September check is the falsifier. If walking in does not produce 5 claims, the venue wedge needs
a salesperson, and a company with 8 hrs/week and no revenue cannot hire one — at which point the honest move
is consumer-only, not a better outreach template.
