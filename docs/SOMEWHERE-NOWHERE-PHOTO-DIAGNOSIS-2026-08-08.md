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
| Expected photo count | **3** | places patch (`photoCount`) and the DB-shaped fixture row (`photo_count`) |
| `photoRef` | present | places patch |
| `photoAttributions` | 3 | places patch and the DB-shaped fixture row |
| Business status | `OPERATIONAL` | both |
| Legacy files on disk | **all 3 present** — `somewhere-nowhere-nyc.webp`, `-2.webp`, `-3.webp` | `public/bar-photos/` |

**"DB-shaped fixture row" means `e2e/fixtures/catalog-rows.json`, a checked-in file — NOT the
deployed database.** No deployed row was read (see §11); confirming the deployed row is attended
step 2 below. (santa: Claude/FABLE — the earlier wording said "DB row", which implied deployed
evidence this item deliberately did not gather.)

The place id is intentionally not reproduced here; it is public data, but the report stays lean.

**The snake/camel trap, stated explicitly (criterion 7).** That fixture row spells the field
`photo_count`; reading `row.photoCount` returns `undefined`, and a check written that way would
conclude "the data is missing" — which is false. Pinned as a test:
`src/lib/somewhereNowhere.diagnosis.test.ts` asserts BOTH that `row.photo_count === 3` and that
`row.photoCount`/`row.googlePlaceId` are `undefined` on the raw row.

**The boundary is crossed in exactly one place**, so it cannot drift: **`rowToBar`**
(`src/lib/catalogServer.ts:60`, mapping at `:95-99`) converts `place_id -> googlePlaceId`,
`business_status -> businessStatus`, `photo_count -> photoCount`. Every consumer reaches that one
function: the client-side catalog swap via the batch wrapper `rowsToCatalog`
(`src/components/CatalogRefresh.tsx:6`), and the server single-bar lookup by importing `rowToBar`
DIRECTLY (`src/lib/barServer.ts:3`, called at `:53`). **No mismatch exists in application code.**
This was the mission's live hypothesis; it is refuted.
(santa: Codex — an earlier draft said both consumers import `rowsToCatalog`, which is wrong: the
server path imports `rowToBar`. The shared boundary is `rowToBar`; `rowsToCatalog` is the batch
validator around it.)

---

## 3. Full condition trace — every gate, with the line that governs it

| # | Condition | Governing site | Verdict for this bar |
|---|---|---|---|
| 1 | **Eligibility — build flag** | `src/lib/mediaPolicy.ts:80` (`NEXT_PUBLIC_GOOGLE_MEDIA === '1'`) | **Fail-closed and INLINED AT BUILD TIME.** The prime suspect. |
| 2 | **Eligibility — place id** | `src/lib/mediaPolicy.ts:123` | passes (27-char id present) |
| 3 | **Eligibility — legacy tier** | `src/lib/mediaPolicy.ts:127` (`NEXT_PUBLIC_LEGACY_PHOTOS === '1'`) | fail-closed; deliberately OFF for compliance |
| 4 | **Eligibility — terminal** | `src/lib/mediaPolicy.ts:132` | with both flags off returns `glyph` → **no photos, by design** |
| 5 | **Eligibility — API key** | read at MODULE SCOPE `src/lib/placesUiKit.ts:22`; checked at `:46` | fail-closed if `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` absent. **Also `NEXT_PUBLIC_*`, so also build-inlined** — a bundle built without the key stays unconfigured no matter how the environment is edited afterwards. (santa: Codex.) |
| 6 | **Eligibility — runtime gate** | `src/lib/placesUiKit.ts:140` → `src/app/api/flags/route.ts:39` (`GOOGLE_MEDIA_RUNTIME_ENABLED === '1'`) | fail-closed on any error/timeout/non-200 |
| 7 | **Rendering — branch** | `src/components/ResultCard.tsx:213`, `:228`, `:232` | takes the google-live branch iff (1)+(2) hold |
| 8 | **Rendering — widget host** | `src/components/ResultCard.tsx:240` (`GooglePlacePhotoLazy`) | `next/dynamic`, `ssr:false` |
| 9 | **Mounting — lazy** | `src/components/GooglePlacePhoto.tsx:321,332` (`IntersectionObserver`, `rootMargin:200px`) | builds only once the card nears the viewport |
| 10 | **Sizing** | `src/components/GooglePlacePhoto.tsx:379`; enclosing article `src/components/ResultCard.tsx:231` | host: `aspect-[21/9]` while pending, plain `w-full` when ready — no height cap, no `overflow-hidden` on the host itself. The enclosing `<article>` DOES carry `overflow-hidden` (for its `rounded-3xl` corners), but imposes **no height**, so its box grows with content and cannot clip in-flow widget content or the attribution. It WOULD clip out-of-flow content anchored past the article bounds. |
| 11 | **Loading — SDK** | `src/lib/placesUiKit.ts:25` (5s) + grace + import bound; total `MAX_LOAD_MS` at `:236` (11s) | bounded; failure ⇒ fallback |
| 12 | **Loading — widget signal** | `src/components/GooglePlacePhoto.tsx:267` (`gmp-load`), budget `placesUiKit.ts:37` (4s) | bounded; no signal ⇒ fallback |
| 13 | **Billable moment** | `src/components/GooglePlacePhoto.tsx:298` | one creation per attempt |
| 14 | **Fallback** | `src/components/GooglePlacePhoto.tsx:346` → `ResultCard.tsx:139` (`CardMediaFallback`) | 21/9 glyph + name + **exactly one** "Open in Maps" |
| 15 | **Fallback purity** | `mediaPolicy.resolveFallbackMedia` | forces both Google tiers off, so the failure branch can never serve a re-hosted photo |
| 16 | **Error** | timeouts at `GooglePlacePhoto.tsx` (11s / 4s) with the `gaveUp` latch | settles on widget **or** fallback — but only ONCE `build()` starts, i.e. after intersection (see row 9). Before intersection no timer is armed at all. (santa: Codex.) |

---

## 4–5. Can app-owned CSS, sizing, timing, or eligibility suppress the widget?

Each candidate, ruled out or named:

- **App-owned CSS / clipping — NOT fully ruled out locally; see the honest limit below.** The ready host imposes no
  aspect ratio, no fixed height and no `overflow-hidden` (`GooglePlacePhoto.tsx:379`); asserted
  directly in `src/components/ResultCard.somewhereNowhere.test.tsx` and in
  `GooglePlacePhoto.compact.test.tsx`. Those assertions cover the HOST ONLY. One level up, the
  enclosing `<article>` (`ResultCard.tsx:231`) does carry `overflow-hidden`, for its rounded
  corners — so "there is no `overflow-hidden` anywhere" would be false. It is still ruled out as a
  suppressor because that article sets no height: its box is content-driven, so it cannot clip
  in-flow widget content or Google's attribution. The residual case it would clip is out-of-flow
  content anchored beyond the article's bounds (e.g. a popover escaping the card); Google's compact
  widget renders its media and attribution in flow, and its own lightbox opens as a separate
  overlay, so this is not the mechanism here. (santa: Claude/FABLE.)

  **Honest limit (santa: Codex).** jsdom performs NO LAYOUT, so the two cited unit tests prove only
  what class strings are applied — they cannot prove geometry. Real-browser geometry for OUR
  container was measured under Item 6 (host 362x155 pending, 362x208 ready, no clipping, on both
  iPhone 13 and Pixel 7), but against a MOCKED widget. Google's real rendering is closed-shadow and
  was never run here, so whether the provider's own media and attribution stay within the article's
  `overflow-hidden` bounds in production is **not locally verifiable** and stays part of the
  attended checklist rather than being declared exonerated.
- **Container sizing collapse — RULED OUT.** Pending reserves the same 21/9 the fallback uses, so
  the band never collapses to zero. (Measured in Item 6: 362x155, held across a slow load.)
- **Timing — RULED OUT as a permanent suppressor ONCE THE BUILD STARTS, with one genuine residual
  local mechanism.** Every wait inside `build()` is bounded (11s SDK, 4s widget) and every expiry
  renders the fallback, so a timing failure produces a **glyph with an "Open in Maps" link**, never
  a blank card. **But those timers are armed INSIDE `build()`, which only runs on an intersecting
  IntersectionObserver entry** (`GooglePlacePhoto.tsx:321-332`). If the observer never reports this
  card as intersecting, no timer is armed, nothing is built, and no fallback appears — an
  indefinitely pending host, independent of all three deployment gates. That is a real local
  mechanism and it is NOT ruled out by anything in this document; see the attended checklist step 4,
  which asks for the card's `data-status` precisely to distinguish it. (santa: Codex.)
- **Data / snake-camel — RULED OUT.** Section 1–2 above.
- **Missing legacy files — RULED OUT.** All three `.webp` files exist.
- **Eligibility — THE REMAINING MECHANISM.** Three independent fail-closed gates must ALL be true
  for a photo to appear: the build-time `NEXT_PUBLIC_GOOGLE_MEDIA`, the browser API key, and the
  server-side `GOOGLE_MEDIA_RUNTIME_ENABLED` runtime gate. Any one false ⇒ no widget.

**Determination — and it is CONDITIONAL, which matters (santa: DeepSeek).** Locally, with the
shipped fail-closed defaults, this card correctly shows no photograph — `resolveMedia` returns
`glyph` (`mediaPolicy.ts:132`), the card renders its deterministic glyph tile, and no Google surface
is involved. The moment a successful Google response is mocked, the card builds the widget and hands
it the right place id. So this bar's DATA and the card's own render path are exonerated.

But "the remaining mechanism is eligibility" only holds in ONE of the two deployed worlds, and the
first attended step decides which:

- **If NO bar on the deployment shows a Google photo** → the three gates G1/G2/G3 are the live
  hypothesis, exactly as described above.
- **If OTHER bars DO show photos** → G1/G2/G3 are **eliminated, not implicated**. They are
  per-deployment, not per-bar: G1 and G2 are the same build-time constants for every card, and G3 is
  a single server answer that is not keyed by bar. In that world the cause must be per-bar, and the
  leading hypothesis becomes one this local evidence does NOT cover: **Google itself returns no
  photo for this place id.** Our `photoCount: 3` is catalog metadata captured at import time, not a
  live answer — the widget can legitimately receive a 200 with zero photos and render nothing, and
  nothing local would detect that. A stale-metadata/no-live-photos case is a DATA-freshness finding,
  not an app defect.

Framing the gates as *the* remaining mechanism without that split would have been over-claiming.

The one asymmetry worth flagging to the operator: `NEXT_PUBLIC_GOOGLE_MEDIA` is **inlined at build
time** (`mediaPolicy.ts:78-83` documents this), so a deployment created before the variable was set
keeps `false` for its entire life regardless of later env edits. If Somewhere Nowhere shows no photo
on a deployment where other bars DO show one, that is *not* explained by this gate — the gate is
per-build, not per-bar — which is exactly why the attended checklist below asks first whether the
symptom is bar-specific or deployment-wide.

---

## 6. Mocked successful Google response — observed outcome, verbatim

`src/components/ResultCard.somewhereNowhere.test.tsx`, real `GooglePlacePhoto` COMPONENT logic
(`next/dynamic` bypassed), mocked SDK, no network. Scope, stated precisely (santa: Codex): this
exercises eligibility, element assembly, the billable moment and the status transition. It does NOT
exercise the production lazy path — jsdom has no `IntersectionObserver`, so the component takes its
immediate-build branch, and `gmp-load` is dispatched by the test rather than by Google. The
observer branch is covered separately in `src/components/GooglePlacePhoto.test.tsx`:

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
6. **Classify.** Provider data (Google returns no photo for this place — the leading hypothesis if
   other bars work), widget behavior (the widget loads but renders nothing), or app-owned layout
   (our container is exonerated locally; the provider's closed-shadow rendering inside the article's
   `overflow-hidden` box is the part that could not be checked without a browser).

### Explicitly NOT done, and why

A routed reviewer (DeepSeek) proposed curling Google's Places Photos API directly with the project
key to settle "does Google actually have photos for this place id". That is **refused under this
item's own constraints**: it invokes a live, billable Google API and requires reading a credential,
both of which this goal forbids ("Do not invoke the live Google widget or paid APIs unattended").
It is a reasonable ATTENDED step and is folded into checklist item 5 above — for a human, with the
key never printed into any report.

**Status of the live portion: `BLOCKED_ATTENDED`.** It is not guessed and is not presented as
resolved.

---

## 11. Explicit confirmation

No Staging application or database was accessed. No live Google widget was invoked and no paid API
was called: every widget path exercised here ran against a mocked SDK inside jsdom, with no network.
No catalog data was edited. Nothing was pushed, deployed, or migrated.
