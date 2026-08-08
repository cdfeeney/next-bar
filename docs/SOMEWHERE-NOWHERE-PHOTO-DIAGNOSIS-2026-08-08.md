# Somewhere Nowhere — "no photos" diagnosis (local portion)

Goal `g-bfb6937a-8f18-477f-af93-17d92cac1d05` (Item 7). Tier **T1**.
Scope: the **safe local half only**. No Staging access, no live Google widget, no paid API.
Deliberately separate from Item 6's general Google-card polish.

**Bottom line: the data is not the problem, and the app's render path is not the problem.**
Every layer that could suppress this card locally is ruled out with executable evidence. What
remains — whether the deployed row and the live widget behave the same way — is
**`BLOCKED_ATTENDED`** and is listed as a checklist at the end.

---

## 1–2. Catalog facts (confirmed, not assumed)

| Fact | Value | Where |
|---|---|---|
| In static catalog | yes, `somewhere-nowhere-nyc` / "Somewhere Nowhere NYC" | `src/lib/bars.expansion3.ts:16` |
| Google place id | present, **27 chars** | places patch, merged at `src/lib/bars.ts:56` |
| Expected photo count | **3** | places patch (`photoCount`) and DB row (`photo_count`) |
| `photoRef` | present | places patch |
| `photoAttributions` | 3 | places patch and DB row |
| Business status | `OPERATIONAL` | both |
| Legacy files on disk | **all 3 present** — `somewhere-nowhere-nyc.webp`, `-2.webp`, `-3.webp` | `public/bar-photos/` |

The place id is intentionally not reproduced here; it is public data, but the report stays lean.

**The snake/camel trap, stated explicitly (criterion 7).** The DB row spells the field
`photo_count`; reading `row.photoCount` returns `undefined`, and a check written that way would
conclude "the data is missing" — which is false. Pinned as a test:
`src/lib/somewhereNowhere.diagnosis.test.ts` asserts BOTH that `row.photo_count === 3` and that
`row.photoCount`/`row.googlePlaceId` are `undefined` on the raw row.

**The boundary is crossed in exactly one place**, so it cannot drift: `rowsToCatalog`
(`src/lib/catalogServer.ts:95-99`) maps `place_id -> googlePlaceId`, `business_status ->
businessStatus`, `photo_count -> photoCount`. Both consumers import that same function — the server
loader and the client-side swap (`src/components/CatalogRefresh.tsx:6`). **No mismatch exists in
application code.** This was the mission's live hypothesis; it is refuted.

---

## 3. Full condition trace — every gate, with the line that governs it

| # | Condition | Governing site | Verdict for this bar |
|---|---|---|---|
| 1 | **Eligibility — build flag** | `src/lib/mediaPolicy.ts:80` (`NEXT_PUBLIC_GOOGLE_MEDIA === '1'`) | **Fail-closed and INLINED AT BUILD TIME.** The prime suspect. |
| 2 | **Eligibility — place id** | `src/lib/mediaPolicy.ts:123` | passes (27-char id present) |
| 3 | **Eligibility — legacy tier** | `src/lib/mediaPolicy.ts:127` (`NEXT_PUBLIC_LEGACY_PHOTOS === '1'`) | fail-closed; deliberately OFF for compliance |
| 4 | **Eligibility — terminal** | `src/lib/mediaPolicy.ts:132` | with both flags off returns `glyph` → **no photos, by design** |
| 5 | **Eligibility — API key** | `src/lib/placesUiKit.ts:46` | fail-closed if `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` absent |
| 6 | **Eligibility — runtime gate** | `src/lib/placesUiKit.ts:140` → `src/app/api/flags/route.ts:39` (`GOOGLE_MEDIA_RUNTIME_ENABLED === '1'`) | fail-closed on any error/timeout/non-200 |
| 7 | **Rendering — branch** | `src/components/ResultCard.tsx:213`, `:228`, `:232` | takes the google-live branch iff (1)+(2) hold |
| 8 | **Rendering — widget host** | `src/components/ResultCard.tsx:240` (`GooglePlacePhotoLazy`) | `next/dynamic`, `ssr:false` |
| 9 | **Mounting — lazy** | `src/components/GooglePlacePhoto.tsx:321,332` (`IntersectionObserver`, `rootMargin:200px`) | builds only once the card nears the viewport |
| 10 | **Sizing** | `src/components/GooglePlacePhoto.tsx:379` | `aspect-[21/9]` while pending; plain `w-full` when ready — **no height cap, no `overflow-hidden`**, so nothing can clip the widget or its attribution |
| 11 | **Loading — SDK** | `src/lib/placesUiKit.ts:25` (5s) + grace + import bound; total `MAX_LOAD_MS` at `:236` (11s) | bounded; failure ⇒ fallback |
| 12 | **Loading — widget signal** | `src/components/GooglePlacePhoto.tsx:267` (`gmp-load`), budget `placesUiKit.ts:37` (4s) | bounded; no signal ⇒ fallback |
| 13 | **Billable moment** | `src/components/GooglePlacePhoto.tsx:298` | one creation per attempt |
| 14 | **Fallback** | `src/components/GooglePlacePhoto.tsx:346` → `ResultCard.tsx:139` (`CardMediaFallback`) | 21/9 glyph + name + **exactly one** "Open in Maps" |
| 15 | **Fallback purity** | `mediaPolicy.resolveFallbackMedia` | forces both Google tiers off, so the failure branch can never serve a re-hosted photo |
| 16 | **Error** | timeouts at `GooglePlacePhoto.tsx` (11s / 4s) with the `gaveUp` latch | always settles on widget **or** fallback |

---

## 4–5. Can app-owned CSS, sizing, timing, or eligibility suppress the widget?

Each candidate, ruled out or named:

- **App-owned CSS / clipping — RULED OUT.** The ready host imposes no aspect ratio, no fixed
  height and no `overflow-hidden` (`GooglePlacePhoto.tsx:379`); asserted directly in
  `src/components/ResultCard.somewhereNowhere.test.tsx` and in
  `GooglePlacePhoto.compact.test.tsx`.
- **Container sizing collapse — RULED OUT.** Pending reserves the same 21/9 the fallback uses, so
  the band never collapses to zero. (Measured in Item 6: 362x155, held across a slow load.)
- **Timing — RULED OUT as a permanent suppressor.** Every wait is bounded (11s SDK, 4s widget) and
  every expiry renders the fallback. A timing failure produces a **glyph with an "Open in Maps"
  link**, never a blank card.
- **Data / snake-camel — RULED OUT.** Section 1–2 above.
- **Missing legacy files — RULED OUT.** All three `.webp` files exist.
- **Eligibility — THE REMAINING MECHANISM.** Three independent fail-closed gates must ALL be true
  for a photo to appear: the build-time `NEXT_PUBLIC_GOOGLE_MEDIA`, the browser API key, and the
  server-side `GOOGLE_MEDIA_RUNTIME_ENABLED` runtime gate. Any one false ⇒ no widget.

**Determination.** Locally, with the shipped fail-closed defaults, this card correctly shows **no
photos and no fallback glyph at all** — `resolveMedia` returns `glyph` (`mediaPolicy.ts:132`), the
card renders its own glyph tile, and no Google surface is involved. The moment a successful Google
response is mocked, the card renders the widget correctly and hands it the right place id. So the
local application code is exonerated: **the mechanism is deployment configuration / eligibility, not
this bar's data and not the card's layout.**

The one asymmetry worth flagging to the operator: `NEXT_PUBLIC_GOOGLE_MEDIA` is **inlined at build
time** (`mediaPolicy.ts:78-83` documents this), so a deployment created before the variable was set
keeps `false` for its entire life regardless of later env edits. If Somewhere Nowhere shows no photo
on a deployment where other bars DO show one, that is *not* explained by this gate — the gate is
per-build, not per-bar — which is exactly why the attended checklist below asks first whether the
symptom is bar-specific or deployment-wide.

---

## 6. Mocked successful Google response — observed outcome, verbatim

`src/components/ResultCard.somewhereNowhere.test.tsx`, real `GooglePlacePhoto` lifecycle
(`next/dynamic` bypassed), mocked SDK, no network:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Observed: the card takes the google-live branch; `gmp-place-details-compact` is built; the place
request carries **this bar's real place id**; `billableEventCount() === 1`; `gmp-load` flips the host
to `data-status="ready"`; the ready host has no `aspect-`, no `overflow-hidden`, no `max-h-`; zero
`img[src*="/bar-photos/"]`; and the fallback glyph is absent. With google media OFF the same card
renders no widget host, no legacy photo, `billableEventCount() === 0`, and still shows its name and
rank.

`src/lib/somewhereNowhere.diagnosis.test.ts`:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

---

## 7–8. Data integrity

No catalog data was edited. Nothing in this diagnosis required an edit: every value the card needs is
already present and correct on both the static and DB paths. A speculative data edit would have been
forbidden and was not made.

---

## 9–10. `BLOCKED_ATTENDED` — what still needs a human

The local half is complete and conclusive. The remaining question — *does the deployed row and the
live widget behave the way the local mock does?* — cannot be answered without Staging and a live
Google call, both out of scope. Attended checklist:

1. **Is the symptom bar-specific or deployment-wide?** On the deployed surface, does ANY bar show a
   Google photo? If none do, this is the build-time flag / API key / runtime gate, not this bar.
2. **Deployed row identity.** In the deployed database, confirm the `bars` row for
   `somewhere-nowhere-nyc`: `place_id` non-null, `photo_count`, `business_status`. Compare against
   the local values in section 1 (`photo_count = 3`). Use the snake_case names.
3. **Place id and non-secret metadata.** Confirm the deployed `place_id` matches the local one. Do
   not paste API keys or connection strings into any report.
4. **ResultCard response and visual state.** On the deployed card: does
   `[data-testid="google-place-photo"]` exist, and what is its `data-status`
   (`pending` / `ready`)? If `[data-testid="google-fallback-glyph"]` is showing instead, the widget
   was reached and gave up — a different failure from the widget never being eligible.
5. **Console and network, secrets redacted.** `GET /api/flags` — is the body `{"googleMedia":true}`?
   Any request to `maps.googleapis.com` / `places.googleapis.com`, and its status (a `403`/
   `REQUEST_DENIED` points at key referrer restrictions; **no request at all** points at eligibility).
6. **Classify.** Provider data (Google returns no photo for this place), widget behavior (the widget
   loads but renders nothing), or app-owned layout (ruled out locally — would be a surprise).

**Status of the live portion: `BLOCKED_ATTENDED`.** It is not guessed and is not presented as
resolved.

---

## 11. Explicit confirmation

No Staging application or database was accessed. No live Google widget was invoked and no paid API
was called: every widget path exercised here ran against a mocked SDK inside jsdom, with no network.
No catalog data was edited. Nothing was pushed, deployed, or migrated.
