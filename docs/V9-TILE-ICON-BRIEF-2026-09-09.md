# V9-09 — Tile-icon exploration brief (no asset replacement)

Written 2026-09-09 (goal `g-44e906cc`, docs only). Base: `harness/nb-v9-20260908/v9` at `422ee7b`.
Queue authority: `docs/V9-OVERNIGHT-QUEUE-2026-09-08.md` §V9-09. Nothing in this brief replaces an asset,
launches a paid design run or generates an image; shipping art waits for the owner's selection.

## 1. The open question the owner must answer first

**Which "tile icons" — the in-app tile icons, or the installed app icon?**

The inventory below shows why this is not a formality: **the app has no in-app icon family at all.**
The five-tab bottom nav is text-only (Playfair Display uppercase labels, `src/components/BottomNav.tsx`),
the Next Bar? result cards and Rankings rows carry photos, names and numbers but no glyphs, and the whole
`src/` tree contains exactly three inline SVGs (a settings gear, a back chevron, an Apple logo). So:

- If the owner means the **installed app icon** (the iOS home-screen tile and the PWA icon) — that is a
  single 1024 px asset plus two generated PNG routes, and the exploration is an app-icon exploration.
- If the owner means **in-app tile icons** (e.g. glyphs on the five nav tabs or on result tiles) — that is
  a NEW icon family the approved designs do not show, and it needs an approved design first
  (`docs/design-reference/approved/next-bar-five-bars-typography-refinement.png` and
  `next-bar-account-a-tabs.png` both show text-only tabs).

Until answered, only icon replacement is blocked; nothing in the functional queue depends on it.

## 2. Inventory of the current icon assets (all paths exist at the base)

| Asset | Path | What it is | Sizes / states |
|---|---|---|---|
| iOS app icon | `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` + `Contents.json` | Single 1024×1024 universal PNG (Xcode derives every size) | one state; iOS applies the mask and, on iOS 18+, the user's light/dark/tinted appearance |
| Web / PWA icon | `src/app/icon.tsx` | Next.js metadata route rendering a 512×512 PNG at `/icon`: `#0a0a0a` background, 15 % radius, italic bold Georgia "N" in `#ff5b3a`, letter-spacing −0.04em | any-purpose 192/512 per `src/app/manifest.ts` |
| Apple touch icon | `src/app/apple-icon.tsx` | Same mark at 180×180, no radius (iOS masks) | one state |
| Manifest | `src/app/manifest.ts` | `display: standalone`, `theme_color`/`background_color` `#0a0a0a`, icons `/icon` ×2 + `/apple-icon` | no `maskable` purpose declared |
| Launch image | `ios/App/App/Assets.xcassets/Splash.imageset/` | Capacitor splash | — |
| In-app glyphs | `src/app/settings/page.tsx`, `src/app/settings/_ui.tsx`, `src/components/AppStoreCta.tsx` | Three inline SVGs (gear, back chevron, Apple logo) | current-colour strokes; no shared component |
| Nav tabs | `src/components/BottomNav.tsx` | Text labels only; active state = accent border + tint + `aria-current`; the centre "Next Bar?" is a raised accent pill on its own route | selected / unselected |
| Icon library | — | none in `package.json` (no lucide/heroicons/phosphor) | — |

Observation for the app-icon reading: the "N" mark is rendered in **Georgia italic**, i.e. the pre-V9-11
fallback face, not Playfair Display. `ImageResponse` cannot load the next/font faces, so matching the
approved typography would need the Playfair Display 700 TTF embedded in the route (or a static PNG
exported from the design tool). This is the first concrete defect any exploration should address.

## 3. Palette and typography tokens the icons must fit

From `tailwind.config.ts` and `docs/V9-TYPOGRAPHY-CONTRACT-2026-09-09.md` (owner decision 2026-09-08):

| Token | Value | Use |
|---|---|---|
| `bg` | `#0a0a0a` | icon background, app background |
| `surface` | `#141414` | cards / tiles |
| `border` | `#2a2a2a` | tile edges |
| `accent` | `#ff5b3a` (coral) | the mark, active states, pins |
| `accentDim` | `#c54328` | pressed / dimmed accent |
| `text` | `#f5f5f0` | primary text |
| `muted` | `#8a8a85` | unselected labels (≈5.6:1 on `bg`) |
| display face | Playfair Display 600/700 | headings, nav labels, the "N" mark if it stays typographic |
| body face | Nunito Sans 400/600/700 | body, buttons |

Any glyph family must read at the sizes it will actually be shown: 22–24 px on a 375 px phone for nav
tabs, 60 px for the home-screen tile, and must keep the coral-on-black contrast (`#ff5b3a` on `#0a0a0a`
≈ 6.9:1) or use `text`/`muted` for non-accent states.

## 4. Accessibility and label constraints (non-negotiable for any in-app family)

- Labels stay. Apple's tab-bar guidance and this repo's a11y specs (`e2e/a11y-mobile.spec.ts`,
  `e2e/mobile-controls.spec.ts`) expect a text label per tab; an icon is an addition, never a replacement.
- Every glyph is `aria-hidden` next to its visible label, or carries an `aria-label` when it stands alone
  (the existing three SVGs are the pattern).
- 44 px targets and the V9-10b compact-width fit (`e2e/mobile-controls.spec.ts`, "bottom nav fits") must
  still hold with a glyph stacked above each label at 320/375/390 px — a glyph adds height, not width,
  but the nav's `min-h-[44px]`/`-mt-7` pill geometry would change.
- Selected vs unselected must not rely on colour alone (current pattern: border + tint + `aria-current`).
- Reduced motion: no animated icons.
- No emoji as icons (rendering differs per platform; three checkmarks in `ClaimHandle.tsx`,
  `DisplayNameEditor.tsx`, `SetPassword.tsx` use "✓" today — acceptable as decoration, not as a family).

## 5. Bounded exploration plan (Claude Design, no paid run until the owner picks a lane)

1. **Owner answers §1.** Record the answer in this file's header.
2. **Lane A — app icon** (if that is the answer): one canvas, three artboards at 1024 px shown inside an
   iOS home-screen mock at phone size (light, dark, tinted appearance): (a) the current "N" re-set in
   Playfair Display 700 italic; (b) the "N" with a subtle bar-glass or pin silhouette; (c) a wordless coral
   mark on black. Export PNGs only for comparison. Deliverable: the owner picks one, then ONE static
   1024 px PNG replaces `AppIcon-512@2x.png` and `src/app/icon.tsx` / `apple-icon.tsx` either embed the
   Playfair TTF or serve the same static PNG. Needs a new iOS binary.
3. **Lane B — in-app nav glyphs** (if that is the answer): one canvas showing the five-tab nav at 375 px in
   both approved references' context with a 5-glyph set (map pin, ranked list, the "N" pill, people,
   person/gear) in `muted` unselected and `accent` selected, stacked above the labels; a second artboard at
   320 px. Deliverable: SVG paths inline in a single `NavIcon.tsx` (no icon dependency), 24 px viewBox,
   `stroke="currentColor"`, `aria-hidden`. Requires an updated approved nav reference before code.
4. **Lane C — result-tile glyphs** is NOT proposed: the approved five-bars reference carries photos and
   numbers; adding glyphs there is a new design direction, not a redraw.
5. **Bounds:** no image generation, no new icon library, no font substitution, no nav re-order. One
   Claude Design canvas per chosen lane; phone-size mocks only; the owner's selection is recorded here
   before any implementation goal is created.

## 6. Verification record for this document

T2 docs-only: the stored verification is a file check (size, open question named). No product code
changed.
