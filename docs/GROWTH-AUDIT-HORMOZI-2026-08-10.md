# Next Bar growth audit: Alex Hormozi research pilot

Date: 2026-08-10  
Scope: read-only product/growth diagnosis; documentation only  
Status: YouTube corpus complete; Instagram profile collection blocked pending an authorized Apify input or export

## Founder-launch correction

The founder clarified that Next Bar has four founders available as its seed cohort and that the immediate constraint is getting the real app and social loop onto their phones. That changes the execution order in this audit: the four-founder launch slice comes before more concierge research or content work.

The current build is also farther along than the earlier growth diagnosis implied. A signed iOS binary has been uploaded successfully to App Store Connect, an Internal Testing group has existed, and the latest TestFlight shell points at the live Staging release. The near-term task is distribution, four-account behavioral proof, and P0-only repair. See `docs/FOUNDER-LAUNCH-NOTES-2026-08-10.md`.

The customer-learning and measurement conclusions below still apply after that slice is operational. They should not be interpreted as a reason to delay putting the current product in the founders' hands.

## Bottom line

Next Bar's longer-term growth problem is not code quality. It is that product and catalog production have run ahead of customer learning and measurement. Its immediate launch problem is narrower: a working build, several completed social foundations, and already-reviewed mobile fixes are split across Apple distribution state, branches, environments, and an unfrozen definition of done.

The repository has 1,265 verified venues, a multi-surface social product, and a detailed viral blueprint, but the operator-owned state still reports WAU as `null`, zero claimed venues, and zero revenue. The analytics helper has no production call sites. That makes it impossible to tell whether a feature, share, landing page, or content item creates an activated user.

The strongest Hormozi-to-Next-Bar translation is:

1. Pick one painfully specific user and occasion.
2. Deliver the outcome manually to a small number of people before adding more product.
3. Package the working outcome as a narrow free offer.
4. Publish proof and useful demonstrations for that exact user.
5. Optimize for qualified actions and repeat use, not views or feature count.

These are creator claims and working hypotheses, not universal laws. They need to be tested against Next Bar users.

## Evidence boundary

### Captured

- 60 recent uploads discovered from the official [`@AlexHormozi` YouTube channel](https://www.youtube.com/@AlexHormozi/videos).
- Eight high-relevance videos selected and captured as official English captions plus YouTube metadata.
- Eight normalized transcript files and eight SHA-256 source receipts preserved outside Git at `C:\Users\cdfee\AppData\Local\CodexResearch\alex-hormozi-2026-08-10\youtube`.
- Current Next Bar source, growth state, measurement file, and viral blueprint inspected read-only.

### Not captured yet

- Anonymous Instagram profile discovery for [`@hormozi`](https://www.instagram.com/hormozi/) returned an Instagram GraphQL 403/login challenge. The collector stopped and preserved `collection-failure.json`; it did not rotate identities, use cookies, or bypass the challenge.
- No Instagram claim is included in the conclusions below. YouTube footage that discusses Hormozi's own Instagram tests is still YouTube evidence, not an Instagram scrape.

The safe continuation is either (a) an existing Apify dataset export containing at most 20 public posts, or (b) `APIFY_TOKEN`, the reviewed actor ID, and its input schema stored in ignored `D:\Projects\skill-foundry\.env.local`. The adapter will dry-run first and enforce a hard cost cap. Firecrawl is not needed.

## Ranking method

The selection score is judgmental but explicit:

- 35% relevance to Next Bar's current user-acquisition bottleneck;
- 25% actionability for a small consumer-app pilot;
- 20% evidence specificity, such as a worked example, comparison, or stated measurement;
- 10% coverage of a distinct funnel stage;
- 10% recency.

View count was recorded as context, not treated as quality. A popular motivational video cannot outrank a smaller video with a directly transferable experiment.

| Rank | Score | Video | Published | Captured views | Reason selected |
|---:|---:|---|---|---:|---|
| 1 | 94 | [Generate 1000s of Leads](https://www.youtube.com/watch?v=Mst4hreQYl0) | 2025-11-08 | 636,624 | Narrow lead offer, packaging tests, delivery, CTA |
| 2 | 93 | [Grow an Audience in 2026](https://www.youtube.com/watch?v=Jmkq5RLjm0U) | 2026-03-14 | 391,526 | Ideal audience, qualified attention, proof/promise/plan |
| 3 | 91 | [My Actual Social Media Strategy](https://www.youtube.com/watch?v=dMZ-n2KSlxE) | 2025-10-18 | 836,998 | Content volume, influence/proof, correct-avatar signal |
| 4 | 90 | [If I Started a Business in 2026](https://www.youtube.com/watch?v=uWdIgftpvBI) | 2025-12-06 | 1,717,659 | Manual, unscalable learning before scale |
| 5 | 86 | [I'll Fix Your Marketing](https://www.youtube.com/watch?v=B-ogfFiQpXg) | 2026-08-07 | 62,576 | Worked referral and recurring-CTA case |
| 6 | 84 | [Get Your Customers to Stay](https://www.youtube.com/watch?v=-j8_YCWZ05Q) | 2026-03-24 | 104,746 | Activation, overwhelm, retention feedback |
| 7 | 81 | [Content in the Age of AI](https://www.youtube.com/watch?v=XsWSvz-aewA) | 2026-05-26 | 289,459 | Proof and real demonstrations versus generic content |
| 8 | 73 | [Grow Any Business Faster](https://www.youtube.com/watch?v=qsXxckCbci0) | 2026-01-14 | 431,206 | Attraction-conversion-delivery constraint model |

View counts are capture-time metadata and will change.

## Transferable claims

| Claim | Timestamped evidence | Status | Next Bar translation |
|---|---|---|---|
| A lead magnet should completely solve a narrow problem, then naturally expose the next problem. | [01:59](https://www.youtube.com/watch?v=Mst4hreQYl0&t=119s) | Creator statement | The vibe planner can be the offer, but it should solve one occasion for one group—not advertise “an app.” |
| Advertise the result, not the mechanism, and test names with the intended audience. | [23:29](https://www.youtube.com/watch?v=Mst4hreQYl0&t=1409s), [23:57](https://www.youtube.com/watch?v=Mst4hreQYl0&t=1437s) | Creator statement with worked example | Test “A 3-bar plan your group agrees on” against “Take the vibe quiz”; do not guess from internal preference. |
| Useful content must contain a clear next action; giving value without a CTA leaves demand uncaptured. | [31:00](https://www.youtube.com/watch?v=Mst4hreQYl0&t=1860s) | Creator statement | Every proof or guide should lead to one planner action, not a menu of unrelated surfaces. |
| Content should attract the right customer; views alone are a weak objective. | [19:15](https://www.youtube.com/watch?v=dMZ-n2KSlxE&t=1155s) | Creator statement | Track plans started, group shares, recipient votes, outings, and repeats—not impressions alone. |
| Audience strategy improved when it moved from broad entertainment to education for the intended buyer, from wide to narrow, and from views to revenue/qualified outcomes. | [41:49](https://www.youtube.com/watch?v=Jmkq5RLjm0U&t=2509s), [2:16:02](https://www.youtube.com/watch?v=Jmkq5RLjm0U&t=8162s) | Creator statement based on the creator's internal data | Make content for a nightlife decision-maker, not generic NYC entertainment. Pair reach with a qualified-action metric. |
| Strong educational introductions use proof, promise, and plan. | [54:27](https://www.youtube.com/watch?v=Jmkq5RLjm0U&t=3267s) | Creator statement | Start a Next Bar case study with the real group result, the promised decision, and the short route to it. |
| Start with high-touch, unscalable delivery because it creates faster learning and flexible iteration. | [01:25](https://www.youtube.com/watch?v=uWdIgftpvBI&t=85s), [04:55](https://www.youtube.com/watch?v=uWdIgftpvBI&t=295s) | Creator statement | Run concierge “plan our night” sessions before coding another growth surface. |
| Design an experience good enough that the first customer tells a friend. | [11:09](https://www.youtube.com/watch?v=uWdIgftpvBI&t=669s) | Creator statement | Observe the exact moment a group organizer shares the result; build around that behavior. |
| Referral systems need a meaningful reason and repeated prompts at natural touchpoints. | [04:14](https://www.youtube.com/watch?v=B-ogfFiQpXg&t=254s), [20:16](https://www.youtube.com/watch?v=B-ogfFiQpXg&t=1216s) | Creator statement from a worked business review | Make inviting the group the way the recommendation becomes useful, not a generic share button. |
| More product can lower perceived value when people use only a small fraction; the fast win belongs near the front. | [09:31](https://www.youtube.com/watch?v=-j8_YCWZ05Q&t=571s), [12:55](https://www.youtube.com/watch?v=-j8_YCWZ05Q&t=775s) | Creator statement from platform examples | Lead with one “group reaches a bar decision” path and demote optional depth. |
| Proof and real-time demonstrations become more defensible than generic generated advice. | [06:19](https://www.youtube.com/watch?v=XsWSvz-aewA&t=379s), [08:39](https://www.youtube.com/watch?v=XsWSvz-aewA&t=519s) | Creator statement | Film real planning sessions and outcomes; do not build a feed of interchangeable AI bar tips. |

## What Next Bar is already doing well

- The landing offer is close to a useful lead magnet: six questions in 90 seconds produce a concrete list.
- Value comes before signup. That should remain true; contact capture belongs after the useful result and should be optional unless required to share/save it.
- The north star already favors one dense group or neighborhood over citywide vanity scale.
- The recipient share page permits an accountless vote before its app CTA. That is a strong fast-win pattern.
- The catalog has enough supply for a pilot. More venue collection is not the current constraint.

## What is going wrong

### 1. There is no trustworthy growth scoreboard

`ceo/state.json` declares users as the bottleneck, but WAU and neighborhood WAU are `null`. `ceo/measurements/latest.json` explicitly says there is no analytics pipeline. `src/lib/analytics.ts` is gated off by default, and an exact search finds no production `trackEvent(...)` call sites.

Without a funnel, the project cannot distinguish a design improvement, viral loop, content hit, or empty build cycle.

### 2. The customer and promise change by surface

- Marketing hero: a solo user bored with the same bars.
- Product blueprint: a friend group deciding together.
- Waitlist: a person who wants TestFlight access.
- Growth objective: WAU in one neighborhood plus self-maintaining venues.

Each can be valid later. Together, before validation, they dilute message and measurement.

### 3. The useful offer and the lead capture are disconnected

The hero promises the result and emphasizes “No signup.” The email form sits on a separate `/join` page and sells future iOS access. It does not offer a useful continuation of tonight's outcome, and the API stores no campaign/source field.

The correction is not an email wall before recommendations. It is an optional post-result continuation such as “send this plan to the group,” “save this night,” or “get next Friday's plan,” with clear consent and attribution.

### 4. Production has outrun learning

The work ledger reports 1,265 verified venues. The growth state reports zero claimed venues, zero revenue, and unmeasured users. The viral blueprint also scheduled a long code-first feature sequence while live-network dependencies were deferred.

This is evidence of a sequencing problem, not evidence that the features are intrinsically bad.

### 5. The referral loop exists as UI, not yet as a measured behavior machine

The share page is directionally strong, but the system does not currently measure `share_clicked`, `share_landed`, `recipient_voted`, `group_decided`, or `returned_next_week`. There is also no tested reason for an organizer to invite the group beyond the product's assumed utility.

### 6. Content does not yet have a proof engine

The inspected growth artifacts contain plans and product claims, but no corpus of real group-decision cases tied to acquisition and activation results. That makes generic nightlife content tempting and proof-led content hard.

### 7. The core win competes with breadth

The separate design audit found overlapping Home, Map, Discover, Quiz, Rankings, Friends, and other controls. The growth consequence is not merely visual clutter: it weakens the “one thing” a new user should do and makes activation harder to define.

## Recommended no-code pilot

Assumption: start in the neighborhood where the operator can already reach at least five group organizers; if there is no such evidence, use East Village as the provisional test neighborhood.

### One customer

The person in a 3–8-person friend group who receives “where should we go?” on Thursday through Saturday.

### One offer

> Tell us your group size, neighborhood, budget, and vibe. Get three bars everyone can vote on in 60 seconds.

This is a hypothesis. Test its wording against the current “vibe quiz” language with intended users.

### One activation event

An organizer shares a plan and at least one recipient votes, producing one selected bar.

### Four-week sequence

1. **Concierge learning:** recruit 10 organizers through warm outreach; manually help each group reach one pick; record objections, time-to-pick, shares, votes, and the final venue.
2. **Proof capture:** with permission, turn three real sessions into short case studies using proof → promise → plan. Remove personal details.
3. **Offer test:** compare two result-oriented headlines with the same planner. Judge qualified starts and activated groups, not clicks alone.
4. **Referral test:** at the recommendation moment, test one explicit prompt: “Who needs to vote on this?” Track the share-to-vote path.
5. **Retention test:** message consenting organizers the following Thursday with a prefilled repeat path. Measure repeat activated groups.

Do not buy ads or build more growth features until the funnel can be observed manually or instrumented.

## Pilot scoreboard

These are provisional decision thresholds, not forecasts:

| Stage | Event | Four-week evidence target |
|---|---|---:|
| Reach | intended organizer responds | 20 conversations |
| Value | plan delivered | 10 groups |
| Activation | plan shared + recipient vote | 5 groups |
| Outcome | group confirms a selected venue | 3 groups |
| Retention | same organizer activates again on a later week | 2 groups |

If fewer than half of delivered plans get shared, repair the offer or decision experience before increasing traffic. If plans get shared but recipients do not vote, repair the recipient experience. If groups decide but do not return, investigate outcome quality and cadence.

## Content system for the pilot

Use three repeatable content classes for the same organizer avatar:

1. **Proof:** a real group goes from indecision to one bar.
2. **Decision education:** one narrow rule, such as choosing between a loud first stop and a conversation bar.
3. **Specific plan:** “Three East Village bars for six friends, cocktails under $20, no club.”

Every item gets one CTA to the planner. The first production target should be modest enough for the eight-hour operator budget: three short items and one deeper case study per week, plus direct conversations. Increase volume only after one format produces activated groups.

## Learning quest

### Target ability

Given one neighborhood and one week, define a specific organizer, package one decision outcome, run one acquisition experiment, and decide what to change from observed funnel evidence.

### Active node

`avatar-offer`: it unlocks every downstream content and referral decision.

### Cold check — answer without this report

1. Who experiences the pain, at what moment, and with whom?
2. What single outcome can Next Bar deliver within ten minutes?
3. Which observable event proves that one user brought another person into the product's core action?

### First 30-minute session

- 3 min — answer the cold check.
- 7 min — compare the answers with the one-customer/one-offer/one-activation definitions above.
- 10 min — write three alternative offers for the same organizer and rank them by specificity, outcome, speed, and credibility.
- 7 min — send or show the best two to three reachable organizers; capture their exact preference and objection.
- 3 min — choose the next offer test and schedule retrieval for 2026-08-11.

### Mastery gate

- State the avatar, offer, and activation event without notes.
- Repeat the explanation after a delay with at least 80% rubric accuracy.
- Deliver 10 real concierge plans.
- Produce one evidence table showing conversation → delivery → share → vote → outcome → repeat.

The machine-readable tracker is `docs/HORMOZI-GROWTH-QUEST.json`.

## Information-to-skill promotion rule

Do not turn the Hormozi corpus directly into a “growth skill.” Promote only the parts that survive this chain:

`timestamped source claim → Next Bar hypothesis → bounded experiment → observed behavior → reusable decision rule → agent benchmark`

A future growth skill should be rejected if an agent using it cannot outperform a no-skill baseline on defining the avatar, choosing one constraint, proposing a measurable experiment, and refusing vanity metrics. More scraping is justified only when a benchmark exposes a knowledge gap that the current evidence cannot repair.
