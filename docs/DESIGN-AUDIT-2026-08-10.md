# Next Bar frontend and UI/UX audit

Date: 2026-08-10  
Mode: read-only source and deployed-output inspection  
Skills applied: `frontend-design`, `ui-ux-design`

## Evidence boundary

This is an expert inspection, not user research. It uses repository source, product documents, public server-rendered output, and the existing Open Graph image. No fresh interactive narrow/wide browser captures or user sessions were available, so render-dependent findings remain hypotheses to verify. No application files, data, deployment, or external account state were changed.

## Outcome

Next Bar is stronger as an engineered product than as a visually distinctive product. State handling, recovery, touch sizing, permission behavior, data fallbacks, and mobile safeguards are unusually careful. The weaker area is brand-specific art direction: one type family, one orange accent, black surfaces, rounded cards, and pill controls repeat across nearly every feature.

Provisional rubric scores:

- Frontend Design: 11/18; the pilot handoff gate is 15/18.
- UI/UX Design: 10/16; the pilot handoff gate is 13/16.

These are incomplete inspection scores, not efficacy or usability claims.

## What is working

1. The primary job—find somewhere to go—is understandable.
2. Geolocation is requested from a user gesture and denial has a useful recovery path.
3. Loading, empty, failure, retry, and fallback behavior is generally explicit.
4. Important controls use 44-pixel or larger targets, visible focus, and reduced-motion behavior.
5. Result cards preserve venue name, neighborhood, price, travel cue, vibe match, hours/rating state, photo fallback, attribution, sharing, and Maps access.
6. Fixed-navigation overlap and small-screen reachability have received concrete implementation attention.

## Highest-value problems

### 1. Coherent but generic visual language

The product uses Poppins for wordmark, headings, labels, controls, body copy, and numeric display. The source contains 94 `rounded-full`, 39 `rounded-2xl`, 42 `rounded-3xl`, 92 `bg-surface`, 132 `border-border`, and 233 `font-display` occurrences across TSX and CSS. Consistency is high, but the same surface grammar makes Results, Rankings, Friends, Settings, and marketing feel interchangeable.

The marketing hero asks for italic type without loading a Poppins italic face, so browsers may synthesize the italic rather than render an art-directed cut.

Improve by defining distinct type roles, reducing pill/card use to semantic boundaries, and creating a subject-specific graphic universe from NYC nightlife artifacts: door stamps, awning type, matchbooks, receipts, subway transfers, venue photography, neighborhood signage, night routes, and changing light.

### 2. Results controls compete with the recommendations

The automatic results surface presents `Pick my bar`, `Tweak the vibe`, neighborhood chips, distance chips, and `Run it again` around the cards. These controls have similar pill/outline treatments and collectively compete with the answer the user came to receive.

`Pick my bar` is also ambiguous: the action means “start from a bar I am at,” not “choose a recommendation for me.”

Improve by leading with the recommendation, renaming the escape to `Start from a bar` or `I'm already at a bar`, and combining secondary controls behind one `Tune results` disclosure when practical.

### 3. First paint creates a location-trust mismatch

The server-rendered home state says `Finding bars near you` and `Using your location` while permission is still resolving. The implementation correctly waits for a tap before triggering an undecided browser permission, but a slow hydration path can briefly imply that location access has already begun.

Improve by making the first paint neutral or consent-led, then showing the locating state only after prior permission is known or the user taps Share.

### 4. Home, Map, Discover, and Quiz overlap

The product model is not fully expressed by the navigation. Home can find nearby bars, Map can find/filter bars, Discover browses bars, and Quiz also produces recommendations.

Use this mental model as the next IA hypothesis:

- Next Bar: decide now.
- Explore: browse the map and venue catalog.
- Rankings: remember and refine personal taste.
- Friends: coordinate a night.

Test whether Map and Discover should be one Explore surface and whether Quiz is a tool within Next Bar rather than a peer destination.

### 5. Signed-out demo content is not visibly labeled

The Friends page intentionally uses seeded curator data in demo mode, but the visible section says only `Find friends`. Real-looking names and handles can be mistaken for actual accounts or live social proof.

Improve with an explicit `Sample profiles` label, a short demo explanation, and a clear sign-in transition. Do not make simulated activity look like organic user adoption.

### 6. Product-truth copy conflicts

Rankings says cross-device sync has not shipped, while Settings says signing in keeps ratings across devices. Marketing says Manhattan-only while deployed discovery includes parts of Brooklyn and Queens. These contradictions weaken trust more than a visual detail does.

Run a single product-truth pass across `/install`, `/rankings`, `/settings`, README, metadata, and onboarding. Give each capability one current source of truth.

### 7. Venue cards are informative but not atmospheric

The shortened 21:9 image strip improves list density, but it also compresses venue atmosphere. Every recommendation has nearly the same hierarchy and container, so the top choice does not feel like a confident, memorable answer.

Test a featured first recommendation with a stronger photographic or spatial treatment and compact subsequent choices. Preserve all semantic content and fallback behavior.

### 8. The bottom navigation is functional but category-generic

The raised orange center pill establishes a primary action, but the five-label, all-uppercase system resembles a reusable mobile-app template. Settings also occupies permanent primary navigation while exploration is split elsewhere.

Keep text labels for clarity, but test a less component-default treatment whose shape, typography, and active-state behavior grow from the Next Bar concept.

## Recommended repair order

1. Correct product-truth contradictions and visibly label demo data.
2. Clarify the Next Bar versus Explore mental model and rename ambiguous actions.
3. Simplify the controls surrounding results so the recommendation leads.
4. Create two genuinely different visual directions for the home results surface and one venue card using identical real content.
5. Select by nightlife-specific identity, hierarchy, adaptability, accessibility, and implementation cost.
6. Render and compare narrow and wide compositions before changing the broader component system.
7. Transfer the chosen system gradually to Rankings, Friends, Map/Explore, and Settings.

## Proposed visual-direction pilot

Keep behavior fixed and redesign only the home results surface plus one top-result card.

Direction A—Night editor:

- editorial display type paired with a highly legible UI sans;
- venue photography treated as a story lead rather than a banner;
- rankings and metadata arranged like a compact night guide;
- restrained orange reserved for the answer and live status.

Direction B—Route after dark:

- location, walking time, and neighborhood transitions form a route motif;
- one focal spatial or map-derived gesture, with ordinary DOM content and a static fallback;
- typography and motion express movement through the night rather than generic technology.

Use the same venues and copy in both. Review at 390px and 1440px, at thumbnail size, in grayscale, at 200% zoom, with long venue names, and with motion disabled.

## Next test

Task: “You are deciding where to go in the next ten minutes. Starting from the home screen, choose one bar you would actually go to and explain why.”

Observe:

- time to identify the primary recommendation;
- whether the user understands location use before accepting it;
- whether `Pick my bar` is interpreted correctly;
- whether tuning controls distract from choosing;
- confidence that the recommendation fits the requested night;
- which visual direction the user would trust and remember.

Failure signals:

- the user opens Map or Quiz because they do not understand the home answer;
- the user believes location was taken without consent;
- the user cannot distinguish primary recommendation from filters;
- the design is described as generic, AI-generated, or interchangeable with another discovery app;
- the user chooses by photo alone because the information hierarchy does not explain the match.
