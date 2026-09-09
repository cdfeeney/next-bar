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

The app uses no other weight utilities (`font-medium`, `font-light`, `font-extrabold`, `font-black` do not occur in
`src/`), so every rendered weight is one the faces ship — **no synthetic bolding or faux weights**. The contract test
fails if a rendered element in either face resolves to a weight outside the loaded set, or if any text falls
through to a system face.

## Loading

Both faces are self-hosted by next/font at build time (no runtime request to Google; PWA offline behaviour
unchanged), `display: 'swap'`. Cold load therefore paints the fallback first and swaps; Nunito Sans has no metric
override so a small reflow on first paint is expected on a cold cache (bounded by the closeness of the fallback
stack). If that proves visible on a physical iPhone, the fix is a local `@font-face` with a measured `size-adjust`,
not a knob. Warm loads paint the webfont directly.

## Evidence (candidate-bound)

- `e2e/typography-contract.spec.ts` on `/`, `/rankings`, `/map`, both Playwright devices: loaded faces are exactly
  Playfair Display 600/700 and Nunito Sans 400/600/700 (no Poppins), body resolves to Nunito Sans, `.font-display`
  resolves to Playfair Display, no synthetic weights, no foreign family on rendered text.
- `e2e/visual-capture.spec.ts` with `VISUAL_CAPTURE_DIR` → `docs/design-reference/actual-2026-09-09/fonts/`, one
  full-page PNG per screen per viewport after `document.fonts.ready`, loaded faces logged per capture; inspected
  against `docs/design-reference/approved/next-bar-five-bars-typography-refinement.png` (notes in the goal record).
- Full production e2e gate (both viewports) with the fonts applied — see the goal's store evidence for counts.

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
