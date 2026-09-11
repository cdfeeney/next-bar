# V9-11 — typography contract (Playfair Display + Nunito Sans)

Owner decision 2026-09-08: the approved pair is **Playfair Display** for display/headings and **Nunito Sans** for
body. Artifact `ee5913e` (release/v8, 2026-09-03), cherry-picked onto this candidate. This file is the contract the
e2e `typography-contract.spec.ts` enforces; change both together.

## Tokens

| Token | Face | Loaded weights | Fallback stack | Set in |
|---|---|---|---|---|
| `--font-display` | Playfair Display | 600, 700 | Georgia, Times New Roman, serif | `src/app/layout.tsx` (`next/font/google`, self-hosted at build) |
| `--font-sans` | Nunito Sans | 400, 600, 700 | system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif | same; `adjustFontFallback: false` (next/font has no metrics for Nunito Sans) |

Tailwind: `font-display` → `var(--font-display)`, `font-sans` → `var(--font-sans)` (`tailwind.config.ts`). `<body>` is
`font-sans`; `<html>` carries both CSS variables.

## Role → face → weight

| Role | Class | Face | Weight | Notes |
|---|---|---|---|---|
| Wordmark, page/section headings, card names, tab labels, button labels styled as display | `font-display` | Playfair Display | **600** (`@layer base .font-display { font-weight: 600 }`) | 700 for the Poppins kit; Playfair is a high-contrast serif and 700 reads heavy at these sizes |
| Emphasised display | `font-display font-bold` | Playfair Display | 700 | explicit utility overrides the base rule |
| Body, captions, form controls, helper copy | (inherited) | Nunito Sans | 400 | |
| Body emphasis | `font-semibold` | Nunito Sans | 600 | |
| Body strong | `font-bold` | Nunito Sans | 700 | |
| **Nav** (V10-06, owner on build 11): the bottom nav tabs and pill only | `font-nav` | Poppins | **700** (`--font-nav`, loaded at 700 only; `@layer base .font-nav`) | The V8 nav look the owner asked back. Tabs `clamp(9px, 2.9vw, 11px)`, pill `clamp(11px, 3.4vw, 13px)` with 12 px side padding, `tracking-wide` (Poppins Bold is wide: with `tracking-wider` and padded labels the row overflowed at every width); the active highlight is on the label span (2 px side padding), so it hugs the label and never runs into the screen edge. |
| **Label** (V10-01): section labels ("Group Favorites", "Plan details", "Who's going"), form-field labels, chips/badges, and any uppercase button or link at 12 px or under | `font-label` | Nunito Sans | **600** (`@layer base .font-label { font-weight: 600 }`; family from `tailwind.config.ts` `fontFamily.label`, the same stack as `sans`) | Owner, 2026-09-09, build 10: "swap them back on the bottom part, they look gross" — the serif at 9–13 px uppercase with tracking reads wrong. **Rule: uppercase text at `text-xs` / 12 px or smaller is a label, not a heading, and takes the body face.** Uppercase at `text-sm` (14 px) and above — eyebrows, primary/secondary buttons, `h1` page titles — stays `font-display`. Tracking and colour stay per site. |

The app uses no other weight utilities (`font-medium`, `font-light`, `font-extrabold`, `font-black` do not occur in
`src/`), so every rendered weight is one the faces ship — **no synthetic bolding or faux weights**. The contract test
fails if a rendered element in either face resolves to a weight outside the loaded set, or if any text falls
through to a system face.

### Label role — sizes (V10-01)

Bottom nav in Nunito Sans: plain tabs `clamp(10px, 3vw, 12px)` → 10 px at 320, 11.25 px at 375, 11.7 px at 390, 12 px from
400; centre pill `clamp(12px, 3.6vw, 14px)` → 12 px at 320, 13.5 px at 375, 14 px from 389. The V9-10b geometry
(flex-1 min-w-0 tabs, 44 px targets, 84 px pill minimum) is unchanged; the 320/375 fit cases in
`mobile-controls.spec.ts` still gate it. Measured widths are in the V10-01 commit message. Mixed-case small text on the
display face (chip counters, "Open in Maps", "Details" links, phase chips) is NOT covered by the rule and was left
alone — an owner call for the design pass.

## Loading

Both faces are self-hosted by next/font at build time (no runtime request to Google; PWA offline behaviour
unchanged), `display: 'swap'`. Cold load therefore paints the fallback first and swaps; Nunito Sans has no metric
override so a small reflow on first paint is expected on a cold cache (bounded by the closeness of the fallback
stack). If that proves visible on a physical iPhone, the fix is a local `@font-face` with a measured `size-adjust`,
not a knob. Warm loads paint the webfont directly.

## Evidence (candidate-bound)

- `e2e/typography-contract.spec.ts` on `/`, `/rankings`, `/map`, both Playwright devices: the faces DECLARED are
  exactly Playfair Display 600/700 and Nunito Sans 400/600/700 (no Poppins); at least one face of each family is
  loaded; body resolves to Nunito Sans and `.font-display` to Playfair Display; every rendered (family, weight) is a
  face that is declared at that weight AND loaded — the synthetic-weight check; no rendered text on a system face
  (Leaflet chrome excluded). Declared ≠ loaded on purpose: Chromium fetches a face only when rendered text needs it,
  so an unused weight (Playfair 700 on these screens) legitimately stays `unloaded` on Pixel 7 while WebKit loads all.
- `e2e/visual-capture.spec.ts` with `VISUAL_CAPTURE_DIR` → `docs/design-reference/actual-2026-09-09/fonts/`, one
  full-page PNG per screen per viewport after `document.fonts.ready`, loaded faces logged per capture; inspected
  against `docs/design-reference/approved/next-bar-five-bars-typography-refinement.png` (notes in the goal record).
- Full production e2e gate (both viewports) with the fonts applied — see the goal's store evidence for counts.
- V10-01: the same spec asserts every bottom-nav tab carries `font-label`, resolves to Nunito Sans 600 uppercase, and
  that no uppercase text at 12 px or under on `/`, `/rankings`, `/map` resolves to Playfair Display. Nav captures:
  `docs/design-reference/actual-2026-09-09/nav/` (12 PNGs, re-captured with the label face).

### Screenshot inspection (iPhone 13 + Pixel 7 captures, fonts applied)

- **Home / Next Bar?** — wordmark, eyebrow, heading, primary button and nav labels render in Playfair Display;
  body copy and the secondary link in Nunito Sans. Hierarchy matches the approved refinement (eyebrow → one serif
  title → body → one filled primary). **Defect found and fixed:** the centre "Next Bar?" nav pill wrapped to two
  lines on iPhone 13 — Playfair uppercase with tracking is wider than Poppins at the pill's 84px minimum. Fixed
  with `whitespace-nowrap` on the pill (`BottomNav.tsx`); the pill widens instead of wrapping.
- **Rankings** — eyebrow, "Bar Rankings" title, empty-state heading, outlined + filled actions: hierarchy as
  approved; no wraps, weights 600 display / 400 body only.
- **Social (Pixel 7)** — the "You tonight" chips wrap "Going out / Maybe later / Not going out" onto two lines; the
  same wrap is present in foundation B's Poppins capture of the same screen (`actual-2026-09-09/social--Pixel-7.png`),
  so it is pre-existing at that viewport width, not a typography regression. Left alone (no unrelated restyling).
- **Map** — floating search/Filters/Locate in Nunito Sans; Leaflet chrome keeps its own face by design.

## The 2026-09-03 blocker (`vibe-tweak-ranking.spec.ts:160`) — status

On `release/v8` (parent `fa295e3`) the same three-file change failed "opening the surface and cancelling leaves the
ranking untouched" 3/3 on a clean build: positions 3–5 changed after Cancel. On THIS base the change passes that
spec — measured by foundation B (4/4, `fb-font-ab.log`, fonts then restored byte-for-byte) and again by this goal's
full gate with the fonts applied. Between the two bases sit `9a5e6fa` (separate travel bands, strict vibe
eligibility), `f309066` (refresh history preserved until routes settle) and `1eae20a` (routing), which changed how
results settle. The consistent explanation is a **ranking-order instability under timing shifts** (a `display: 'swap'`
font swap reflows and re-times the settle) that the recommendation rework removed; it is recorded as the cause with
that evidence, and honestly as un-bisected — no run on the old base was possible in this worktree without touching
`release/v8`. If the failure ever returns, bisect between `fa295e3` and `3d29726` with the three font files applied
at each step and `rm -rf .next` before every build.

Latent defect in the same spec fixed here: the clock was pinned with a timezone-free literal
(`new Date('2026-07-24T23:00:00')`), which is host-local — green on this EDT machine, a different night on a UTC
runner. Now `2026-07-24T23:00:00-04:00`.

## Not claimed

Physical-iPhone rendering (WKWebView font loading, Dynamic Type interaction, notch/safe-area) is the attended step
and is not certified by any of the above.
