# Google-live media — cost control and key runbook

Written 2026-08-06 alongside the google-live wiring (ResultCard +
BarLightbox). Companion to `docs/UI-KIT-BUILD-PLAN.md`; this file corrects
one operational premise and records the runbooks that depend on it.

## The control model — what stops spend, and how fast

**Verified operational fact (operator, 2026-08-06): Vercel environment-
variable changes apply only to NEW deployments.** An existing deployment
keeps every env value it was created with. Therefore:

| Control | What it does | Takes effect |
|---|---|---|
| **Google Cloud SKU quota cap** on the browser key (Places UI Kit / Maps JS requests-per-day; set to 0 to kill) | **The immediate hard spending stop.** Enforced by Google regardless of what any deployment does; widgets degrade to the glyph per the documented failure table. | Minutes, **no deployment** |
| Google Cloud **billing budget + alert** | Financial backstop and detection; does not block by itself. | Continuous |
| `GOOGLE_MEDIA_RUNTIME_ENABLED` via `/api/flags` | Server-decided, fail-closed **per-deployment permission gate**. Keeps the verdict out of client bundles and off the spoofable client; absent variable = disabled. | **Next deployment only** |
| `NEXT_PUBLIC_GOOGLE_MEDIA` | Build-time **eligibility** (inlined into bundles). | Next deployment (new build) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Which browser key ships. | Next deployment |

**Incident order:** cap the SKU quota at Google first (immediate), then flip
`GOOGLE_MEDIA_RUNTIME_ENABLED=0` and redeploy (durable), then investigate.
Do not treat the flag flip as the emergency brake — it is the parking brake.

A true no-redeploy runtime store (e.g. Vercel Edge Config) is a possible
future transport for this gate. **It is deliberately NOT part of this
release and requires separate authorization.**

## Key separation — never reuse the private key

Two Maps keys exist and must never converge:

- `GOOGLE_MAPS_API_KEY` — **server-private**, used only by ingest scripts
  (`scripts/refresh-places.mjs:128`, `scripts/verify-glm-sweep.mjs:33`).
  Never referrer-restricted, never shipped to a client, never set as a
  `NEXT_PUBLIC_*` variable.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — **browser key**, public by nature (it
  ships in the client bundle; `src/lib/placesUiKit.ts:22` is the only
  reader). MUST be a separate key, HTTP-referrer-restricted to the exact
  serving origins, with the SKU quota cap above.

Reusing the private key's value as the public one would ship an
unrestricted, quota-uncapped key to every browser. When configuring an
environment, verify the two variables hold **different** key values.

## Browser-key rotation runbook

Rotation is overlap-then-revoke, never cut-then-replace — installed PWAs
serve cached bundles containing the OLD key for as long as their cache
lives, and revoking it early breaks their photos mid-session.

1. **Create** the replacement browser key in Google Cloud with identical
   restrictions: HTTP referrers for the exact serving origins, Places UI
   Kit + Maps JS APIs only, the same SKU quota cap.
2. **Deploy**: set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to the new key in the
   target Vercel environment and create a new deployment (per the table
   above, the env change does nothing without one).
3. **Verify** on the new deployment: photos render, the request meter
   attributes normally, and the served bundle references the new key.
4. **Retain the old key** through the PWA cache-overlap period — installed
   clients keep executing old bundles until their service-worker cache
   turns over; both keys are live during this window. Watch both keys'
   usage in the Google console; the old key's traffic decaying to zero is
   the signal the overlap is done.
5. **Revoke** the old key only after its traffic is zero (or the accepted
   residual), and record the rotation date here.
