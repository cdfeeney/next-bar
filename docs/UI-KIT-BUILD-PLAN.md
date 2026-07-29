# Places UI Kit — build plan for the compliant photo path

Written 2026-07-29. Supersedes nothing; this is the first plan for the
`google-live` path that `src/lib/mediaPolicy.ts` has typed but never implemented.

## Why this exists

`public/bar-photos/` holds 3,435 photo files downloaded from Google Places,
re-encoded, and served from our own domain. Google's Places policy says: *"you
must not pre-fetch, cache, or store Places API content beyond the allowed
exceptions"* — and the **only** exception is `place_id`, which may be stored
indefinitely. So those files are the compliance liability, and the UI Kit is the
route off them.

Today `resolveMedia()` can return `{source:'google-live', placeId}`, but every
consumer collapses it to a glyph (`ResultCard.tsx:62`, `BarLightbox.tsx:43`,
`RecapCard.tsx:36`, `discover/page.tsx:82`). Nothing renders it. That is the gap.

## The economics, and the one lever that matters

| SKU | Price / 1,000 |
|---|---|
| Places UI Kit Query (Essentials) | **$1.00** (10,000 events/month free) |
| Places UI Kit Pro | $5.00 |
| Places Photo (legacy web-service API) | $7.00 |

**Each component request is ONE billable event regardless of what content it
returns.** Trimming a card to photos-only does not make it cheaper. Only issuing
*fewer requests* does.

Modelled at $1/1,000:

| Scenario | Fetches/mo | Cost/mo |
|---|---|---|
| 1k sessions/day, naive (20/session, remounts uncontrolled) | ~600k | ~$590 |
| 1k sessions/day, deduped + lazy-mounted (~5/session) | ~150k | ~$140 |
| 100k users/day, deduped | ~15M | ~$15,000 |

The dominant variable is **re-mount amplification**, not the unit price.

## "Caching" here does NOT mean storing Google data

With the UI Kit, Google's own web component fetches and renders the photo. We
never hold the bytes, so there is nothing to cache and nothing to violate. What we
control is only how often the component is *created*:

- **Lazy mount** — build the element only when the card enters the viewport.
  Off-screen cards never fetch, never bill.
- **De-duplicate** — keep a session `Set` of `place_id`s already rendered, and
  don't tear down/recreate on scroll-back. We remember *that we asked*, never
  *what came back*. The de-dupe key is `place_id`, the one exempt value — legal
  by construction.

⚠️ Do **not** build a byte cache keyed on `place_id`. Both routed reviewers
suggested "a cache keyed on placeId"; if read as caching image data that
recreates the exact violation we are migrating away from.

## Element API (verified from Google's docs)

```html
<gmp-place-details>
  <gmp-place-details-place-request place="ChIJ..."></gmp-place-details-place-request>
  <gmp-place-content-config>
    <gmp-place-media lightbox-preferred></gmp-place-media>
    <gmp-place-attribution light-scheme-color="gray" dark-scheme-color="white"></gmp-place-attribution>
  </gmp-place-content-config>
</gmp-place-details>
```

- `gmp-place-details` — full element (supports multiple photos).
  `gmp-place-details-compact` — minimal variant.
- Place is set via `<gmp-place-details-place-request place="PLACE_ID">`, or
  programmatically: `request.place = placeId`.
- `gmp-place-content-config` children select what renders. Photos-only = keep
  `gmp-place-media` (+ `gmp-place-attribution`), drop the rest.
- `gmp-load` fires when the place finishes loading.
- `gmp-place-attribution` renders the required attribution automatically — this is
  why attribution belongs in the shared component, not in each surface.

Library load uses the standard Maps JS bootstrap plus
`await google.maps.importLibrary('places')`.

## Operator prerequisites (Connor — these cannot be done from code)

1. Enable **Maps JavaScript API** + **Places UI Kit** on the Google Cloud project.
2. Create a **browser key**. It is public by nature (it ships in the client
   bundle); restrict it by HTTP referrer to the production and preview domains.
3. Set a **billing budget + alert**. The referrer restriction is spoofable, so the
   budget alert is the real backstop, not the key restriction.
4. Decide **D1** — the runtime flag transport. DeepSeek independently proposed
   `/api/flags` with a short edge-cache TTL, because the cost cap must be
   server-decided and fast. The kill switch and the cost circuit-breaker probably
   want to be the same mechanism.

## The seam

**One component is the only import path for the SDK in the entire codebase:**
`src/components/GooglePlacePhoto.tsx`.

`resolveMedia()` stays pure and keeps returning `{source:'google-live', placeId}`.
It never imports the SDK and never learns it exists.

The component owns four things:

1. **Dynamic import** (`ssr: false`). Surfaces that never render it never ship the
   SDK — so an accidental `google-live` decision on a picker or a dense map
   *physically cannot bill*, because the code isn't on the client.
2. **Surface gate** — honours `NO_GOOGLE_MEDIA` (already wired at
   `discover/page.tsx:80` and `RecapCard.tsx:34`). Defence in depth behind the
   bundle-level guard.
3. **Attribution** — renders `gmp-place-attribution`. If it cannot be shown,
   render the glyph instead of an unattributed photo.
4. **Reserved 21/9 box from first paint** — the container is sized before the SDK
   loads, so degrading to a glyph causes zero layout shift.

## Failure behaviour (all degrade to the glyph, never to a broken tile)

| Case | Behaviour |
|---|---|
| Key suspended / quota exhausted | glyph, no retry loop, failure stays local to the tile |
| `place_id` rotted (long-tail across 1,256 venues) | glyph — indistinguishable from "no photo", not an alarm |
| SDK script blocked (ad-blockers block Google scripts) | glyph after a ~5s timeout |
| Photo stalls | SDK's own loading UI inside the reserved box, then glyph on timeout |
| Daily cap trips mid-scroll | photos above stay, glyphs below. Already-fetched photos are already billed; removing them recovers nothing and causes a jarring shift. |

## Migration order — surface by surface, never a global flag flip

A global flip is all-or-nothing and, because `google-live` renders a glyph today,
would black out every photo in the app. Instead:

1. Build `GooglePlacePhoto` + cost observability. **Mount nothing.**
2. Mount on **ResultCard only**. `legacyCache` stays ON. Measure real cost at low
   volume against the $1/1,000 model.
3. Flip ResultCard's chain to `owned → google-live → glyph`. ResultCard stops
   serving legacy files. *Partially compliant.*
4. Repeat for **BarLightbox → RecapCard → discover**.
5. **The last surface flip is the moment we become compliant.**
6. Only then `rm` the 3,435 files. Deleting earlier just yields 404s while the
   policy still selects them.
7. Delete `legacyCache` and its dead branches.

The product is never photo-less: a surface keeps legacy until its replacement
renders, then cuts straight to UI Kit — never to glyph.

## Ship before the first billable request

- Per-surface request meter tagged by surface + `place_id`.
- Server-enforced daily cap. A client-side cap is worthless: the key is public and
  clearing storage or opening incognito bypasses any client counter. The
  enforceable lever is **whether the SDK loads at all**, decided server-side.
- Lazy mount via IntersectionObserver + a concurrency cap for dense surfaces.
- A synthetic run over ~50 real `place_id`s to calibrate the true multiplier from
  re-mounts before production traffic.

## Sources

- [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview)
- [Place Details Elements](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details)
- [Maps Platform pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
