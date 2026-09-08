# Next Bar handoff — map appearance, routing and photos

## Legacy photo cleanup (2026-09-07)

Owner accepted standard Places UI Kit and asked to close problematic legacy code.
Removed the legacy-google-cached branch and legacyCache flag from mediaPolicy;
NEXT_PUBLIC_LEGACY_PHOTOS is now ignored even if an old environment sets it to 1.
Removed cached URL builders and their direct consumers in BarVisualTile,
Discover and RecapCard. Those surfaces retain glyph/text fallbacks and do not
request Google widgets. Owned/venue/user media priority remains supported.
Removed ResultCard's unreachable cached-photo attribution branch and the unused
GoogleAttribution component. GooglePlacePhoto and its native attribution remain.

The 3,435 old asset files were not deleted. Middleware now returns 404 for
/bar-photos/:path* before auth refresh/static file handling, so old direct URLs
also stop serving the retired cache. Added a browser assertion for this and a
unit regression proving the old environment flag cannot reopen cached media.
No beta/Pro/raw-photo API experiment remains in runtime code. No key/env/cloud
change or deployment was made. The large UI Kit photo and Photos & hours button
remain the accepted interaction.

Typecheck and diff whitespace check passed. Full Vitest: 194 files passed,
one skipped; 3,057 tests passed, seven skipped (114s). Log:
D:/Temp/nextbar-ui-kit-cleanup-vitest.log. A real Pixel/Chromium UI Kit probe
passed after cleanup: photo ready, Barcade details/Hours visible, close, zero
page errors; D:/Temp/nextbar-photos-hours-button.json.
Production browser checks for photo-card, discover and recap-home: all 18 passed
on iPhone 13/WebKit and Pixel 7/Chromium, three workers, zero retries, production
build (56.4s). Google media was off only in that test process to avoid billable
traffic; local live UI Kit was tested separately as above. Log:
D:/Temp/nextbar-ui-kit-cleanup-e2e.log. This is a targeted browser run, not the
full release suite; prior unrelated release-gate limits are not cleared.
Preview restarted at localhost:3107, session 61488, with routing enabled in the
process and unchanged .env.local live Google settings; api/flags googleMedia:true.

## Accepted direction — keep standard UI Kit and the hours button (2026-09-07)

Owner clarified that standard UI Kit photos plus the hours/details button are
acceptable, and requested scaled costs. This supersedes the direct-photo-tap
replacement work below. Keep the original large compact photo, Google's gallery
tap behavior, and the existing Photos & hours button that opens BarLightbox.
No additional API enablement or key change is needed for this accepted flow.
The click mismatch was a UI Kit integration/interaction limitation, not a broken
key. Places API (New) was disabled only for the rejected alternative using a
separate raw-photo API. Do not ask the owner to enable it for the current setup.

Current global UI Kit Query monthly costs, including free allowance and volume
tiers: 10k requests $0; 50k $40; 100k $90; 500k $410; 1m $710. These are widget
requests, not users or individual photos. Five loaded result widgets plus one
opened details widget is six requests in this implementation; lazy loading can
load fewer. At six per visit, 10k visits is 60k requests / $50. Estimates exclude
other services, taxes and account-specific discounts. Pricing source:
https://developers.google.com/maps/billing-and-pricing/pricing
No product changes or additional live API calls in this clarification turn.

## Latest direction — preserve the single large photo (2026-09-07)

Owner asked to fix direct photo taps and then explicitly rejected the smaller
rectangular thumbnail: wants one large photo and the subsequent opening flow.
An async clarification asked whether 'double click' means one tap to details,
then another to gallery, or a literal double tap; no answer yet. Default intended
flow remains large photo -> app details/hours -> Google gallery.

The AdvancedPlaceList experiment was reintroduced locally, tested, and rejected
by the owner for its layout. It has now been fully reverted, including the beta
SDK, callback prop, unit addition and new E2E spec. Do NOT reintroduce it. No new
product change survives this continuation. The prior Photos & hours label stays.
Original large-photo Google compact widget and original SDK channel are restored.

A concrete alternative is a live Place Photo in our existing native image button,
with Google/author attribution, keeping UI Kit for the inner gallery. This route
is NOT implemented or approved for production. One read-only public SDK probe of
Place.fetchFields({fields:['photos']}) returned PERMISSION_DENIED: Places API
(New) is disabled in browser-key project 454552964781. Evidence:
D:/Temp/nextbar-photo-api-check.json. The project needs places.googleapis.com
enabled and the existing browser key's API restrictions must allow it before a
real-photo implementation can be verified. Never print/re-paste the key.

Google pricing checked 2026-09-07: current UI Kit Query 10,000 free/month then
$1/1,000; rejected UI Kit Pro 5,000 free then $5/1,000; proposed Place Details
Photos 1,000 free then $7/1,000. Photo metadata only is IDs Only (no charge),
so fetch only photos and reuse catalog name/hours. These are first paid tier
prices, not a traffic estimate. Source:
https://developers.google.com/maps/billing-and-pricing/pricing

Typecheck passed after reverting. Experimental targeted 39 unit checks and real
Pixel/Chromium + iPhone/WebKit photo -> details/hours -> gallery -> close passed,
but describe REVERTED code; they are not evidence for the final source. No full
Vitest/production E2E gates run. New E2E spec was removed before execution.
Preview stays localhost:3107 session53302; no deploy/key/cloud changes.

## Photo tap investigation (2026-09-07)

Owner reports live photo taps do not open the app's second card (photos/hours).
Root cause: ResultCard's cached/glyph buttons set lightboxOpen, but live Google
PlaceDetailsCompact owns its photo clicks and exposes only load/error events.
Its real shadow root is closed; do not intercept the whole widget or obscure
attribution/Maps controls. The existing Hours button already opens BarLightbox.

Final product change this turn is ONLY renaming that button to **Photos & hours**
in ResultCard.tsx. The requested direct-photo-tap behavior is NOT fixed.
An AdvancedPlaceList selectable prototype emitted gmp-select and opened the app
card in a live browser, but changed the hero to a thumbnail. Google documents it
as a paid Pro preview, so the SDK beta/list changes and their test were fully
reverted. GooglePlacePhoto.tsx, its compact test, and placesUiKit.ts have no diff.
Do not resume that prototype as an approved solution. User was asked whether to
keep the clear button or expand replacement work with a cost assessment.

References: https://developers.google.com/maps/documentation/javascript/reference/places-widget
and https://developers.google.com/maps/documentation/javascript/places-ui-kit/advanced-place-list

Typecheck passed. Final live button probes passed on Pixel 7/Chromium and
iPhone 13/WebKit: open Barcade details, live widget ready, Hours visible, close,
zero page errors, six successful image responses each. Evidence:
D:/Temp/nextbar-photos-hours-button.json and nextbar-photos-hours-iphone.json;
screenshots nextbar-photo-details-fixed.png and nextbar-photos-hours-iphone.png.
Earlier temporary scripts/screenshots named selectable or photo-click-live
describe the REVERTED experiment, not the final code. No full Vitest or production
E2E suites rerun for the final label change; earlier gate limits still apply.
Preview remains localhost:3107, session 53302, original SDK channel and routing.
No deployment, commit, cloud/key changes, or new env files.

## Google browser key connected (2026-09-07)

The owner saved the replacement browser key in the existing `.env.local` and
asked to continue. Presence-only checks found exactly one browser-key entry,
`NEXT_PUBLIC_GOOGLE_MEDIA=1`, and `GOOGLE_MEDIA_RUNTIME_ENABLED=1`; the browser
key differs from the private server key. No key value was printed or copied.
Restarted the preview once, keeping routing enabled in its process. Current
preview session is **53302**, http://localhost:3107/ . `/api/flags` reports
`googleMedia:true`. No production environment change or deployment occurred.

Bounded live checks from Smithfield Hall results returned HTTP 200 for Google's
SDK, place details, photo-media RPCs, and actual image responses. A screenshot
visually confirms Barcade's live Google photo and name. Two widget hosts reached
`data-status=ready`; no Google/browser runtime error was recorded. Evidence:
`D:/Temp/nextbar-google-live-check.json`,
`D:/Temp/nextbar-google-photo-visual.json`, and
`D:/Temp/nextbar-google-photos-working.png`.

Probe limitations: the original flow needed the location-primer's manual-choice
button; the old photo-button locator does not exist after live widgets replace
the cached/glyph card. The visual probe confirmed ready widgets but its optional
caption extraction failed because `main` matched two elements; its cleanup
screenshot still captured the successful visible photo and was inspected.
These are bounded observations, not an all-green automated test claim. No app
code changed and no full suites were rerun. Missing-photo venues (Lulla NYC,
Hello Hello, Crompton) and photo expansion remain to be checked, followed by
production configuration/deployment when authorized. Do not repeat key setup.

## Latest owner follow-up — map distance text removed (2026-09-07)

The owner approved the free dark map's appearance, then asked to remove the
distance text box. Removed the straight-line distance text/calculation from
shared bar-marker popups; they retain the venue name and neighborhood.
Search popups retain their existing name/neighborhood/price display.
Only product file changed in this follow-up: `src/components/BarMap.tsx`.
Typecheck and diff check passed. Targeted live popup checks with resolved
geolocation passed on Pixel/Chromium and iPhone/WebKit: no distance text.
The initial WebKit locator click was intercepted by another overlapping marker;
the corrected real touchscreen tap passed. Evidence:
`D:/Temp/nextbar-map-no-distance{,-iphone}.log` and corresponding `.cjs` probes.
Full suites were not rerun for this display-only deletion; the incomplete gates
below remain unresolved, and the prior seven-file aggregate is superseded.
Local preview remains on localhost:3107. No Google or routing changes.

## Latest continuation — free dark map implemented (2026-09-07)

This section supersedes the unfinished-map/runtime status below. The owner
resumed implementation and explicitly prioritized fixing the map with the old
dark appearance and no paid key. Google key replacement/photos remain later work.

- Shared `BarMap.tsx` now renders OpenFreeMap's Dark vector style through
  MapLibre GL 5.24.0 and its Leaflet adapter 0.1.4. Leaflet still owns markers,
  popups, search/fly-to, gestures, geolocation, and zoom controls. No CARTO key
  is used. The existing env template now states that no basemap key is needed.
- Linked OpenFreeMap/OpenMapTiles/OpenStreetMap credit is visible above the
  map legend. A tile-loading error displays a message while bar controls remain
  usable. No grayscale/inversion filter or bulk/offline map download was added.
- OpenFreeMap's public style returned HTTP 200 in this session. Its public
  service documents free commercial use without registration or API keys:
  https://openfreemap.org/ and https://openfreemap.org/quick_start/ . It is still
  an external online service, without a promised SLA.
- Unmocked NYC checks passed in installed Chromium/Pixel 7 and WebKit/iPhone 13
  emulation: 2,107 staging venue markers, street labels, successful vector/glyph
  requests, search to Barcade/Williamsburg, and its popup. No HTTP tile errors
  or displayed map error. Navigation cancelled obsolete tile requests normally.
  These are browser emulations, not physical-device certification or owner
  visual approval. The connected Browser plugin had no available browsers.
- Live evidence: `D:/Temp/nextbar-free-map-street-{pixel,iphone}.{png,json}`;
  runnable probe `D:/Temp/nextbar-free-map-street.cjs`. The initial iPhone probe
  missed already-completed responses and timed out; the corrected probe records
  responses from before navigation. A street probe's incorrect textbox selector
  was corrected to the existing searchbox role before the successful run.
- Typecheck and `git diff --check` passed. Full default Vitest: 3,078 passed,
  2 failed, 7 skipped. Failures: catalog performance 66ms versus 50ms ceiling;
  `nightRolloverContract.test.ts` timed out at 30s. One serial rerun with
  `--maxWorkers=1` hit the 600s process limit; no full passing-unit claim.
- `npm run test:e2e` built successfully, then hit its 900s process limit:
  577 cases passed, 1 failed, 2 skipped; remaining cases did not finish.
  All 24 map-interaction and all 8 distance-routes cases passed across both
  phone projects. Tiles are mocked in this suite; live evidence is separate.
  The failure is the iPhone home page's Flute Champagne Bar control covered
  by bottom navigation, recorded in `D:/Temp/nextbar-free-map-home-overlap.md`.
  No test threshold or unrelated product behavior was changed to clear it.
- Logs: `D:/Temp/nextbar-free-map-typecheck.log`,
  `D:/Temp/nextbar-free-map-vitest.log`,
  `D:/Temp/nextbar-free-map-vitest-serial.log`,
  `D:/Temp/nextbar-free-map-e2e.log`, and
  `D:/Temp/nextbar-free-map-e2e-stream.log`.
- Seven-file LF-normalized map candidate aggregate:
  `b98489600f71cc9a438e8f8f864faecfb30b24f3484951a535014180e3cf9aa5`.
  Per-file hashes: `D:/Temp/nextbar-free-map-candidate.json`. Earlier dirty
  routing/tag/photo work is preserved. No new env file or Google setting change.
- Preview restored at **http://localhost:3107/map**, exec session **71507**,
  with `NEXT_BAR_ROUTING_ENABLED=true` in that process only. Stop it before
  another build. Timed-out test process trees were terminated by bounded-run.
- Full regression gate remains unresolved; this is not release-ready. Earlier
  release-contract digest drift was not rerun or resolved here. No commit,
  deployment, migration, credential rotation, paid model call, or delegation.
  Used the same standalone lease goal identifier from the handoff; the strict
  harness goal lookup does not accept that legacy UUID, so no replacement goal
  was created.

## Prior handoff (historical)

Date: 2026-09-07. Implementation stopped at the owner's request for this handoff.

## Read this first

The owner wants a **crisp black-and-white map that fits Next Bar's theme**.
They rejected the grayscale/inverted OpenStreetMap replacement. When I began
restoring CARTO, they clarified:

> “why are we using carto i feel like thats overnkill we can get a blakc and white map that fits with our theme right”

**Do not continue the CARTO-key setup as an approved decision.** The latest
direction questions the need for CARTO and another provider key. My earlier
request asking the owner to obtain a CARTO key is superseded.

The owner also said Google's free trial has ended and they will need to rotate
the Google keys/reset the setup. This was a heads-up, not authorization to
rotate credentials, change billing, or reactivate Google services.

## Workspace and current runtime

- Worktree: `D:/harness-worktrees/v8-release-ff-20260823`
- Branch: `release/v8-ship`
- HEAD: `fac12ac84f310580aea26f6e9ddc13ba971ebc10`
- Main checkout `D:/projects/next-bar` is older and has production configuration;
  do not use it for this implementation.
- Local preview was left running at **http://localhost:3107**, exec session
  **70546**. Use `localhost`, not the numeric host, for the API origin check.
- Preview command: `npm run dev -- --hostname 127.0.0.1 --port 3107`, with
  `NEXT_BAR_ROUTING_ENABLED=true` set only in that process.
- Existing `.env.local` targets staging Supabase ref `wqxovhiovgcijmfzxgby`
  and was not changed. No additional env file was created. The existing
  `.env.example` template was edited as described below.
- At handoff there are 67 dirty non-document files. LF-normalized aggregate:
  `5d70c90619f1d882c0fb6c8ea0b7aea060b9283734a1dbdec314e7b3ddff1ee0`.
  These include substantial earlier work. Do not reset the whole dirty tree.

## What is actually in the code now

### Map: unfinished, latest direction not implemented

`src/components/BarMap.tsx` is the shared map for the map page, quiz,
WhereNextFlow and recap cards. It currently contains my **partial CARTO
restoration**, made before the owner's clarification:

- CARTO `dark_all` raster tiles, including the original retina suffix.
- A `key` query parameter from `NEXT_PUBLIC_CARTO_API_KEY`.
- Visible linked CARTO/OpenStreetMap attribution; maximum tile zoom 20.
- The grayscale/inversion CSS filter was removed.

There is **no CARTO key configured locally**, so the current code does not solve
the provider watermark. Do not describe this state as a completed map fix.

Related partial edits:

- `.env.example`: adds commented CARTO key instructions. This is an existing
  template, not a new env file. Those instructions are now part of the
  superseded approach.
- `e2e/helpers/test.ts`: intercepts both CARTO and public OSM tile requests.
- `e2e/map-interaction.spec.ts`: expects CARTO Dark Matter, its attribution,
  a key query parameter and no CSS filter.

Only typecheck and `git diff --check` passed after this partial restoration.
The full suites have **not** run on this current candidate.

The previous candidate used standard OSM raster tiles with grayscale/inversion.
Its tests passed, but the owner explicitly rejected its appearance. Automated
tile mocks did not validate the actual visual result; do not repeat that claim.

There are no bundled `.pmtiles`, `.mbtiles` or `.pbf` street-map files in either
checkout's public directory. `scripts/census/tiles.ts` defines geographic
search regions for collecting venues, not an offline NYC street basemap.

### Routing and distance: preserve this work

- Travel times calculate automatically when a starting point resolves.
- The saved routing credential is **`ORS_API_KEY`**, and it is present locally.
  It is separate from both CARTO and Google keys.
- Walkable uses a nearby shortlist and confirms walks of at most 900 seconds.
  Farther supplements are labeled. Cab uses a wider, taste-ranked pool within
  four straight-line miles; Anywhere uses the full service-area pool.
- The quiz retains its nearby default. Explicit broader distance choices are
  no longer forced to reuse the nearest-15 shortlist.
- Route estimates expire after 120 seconds; recalculation is available for
  expired/failed requests. No polling or background retry loop was added.
- The long normal-state explanation is now in closed native **About travel
  times** details below results. A small attribution remains visible. Important
  loading/error/stale/incomplete states remain visible above the results.
- The precise-origin label is **Near you**. Approximate/manual origins retain
  their distinct labels.
- Earlier tag/vibe work is in the dirty tree. No new tag changes were made in
  these map follow-ups; do not discard it while changing the basemap.

### Photos: unresolved configuration/content gap

Observed local settings: `NEXT_PUBLIC_GOOGLE_MEDIA` is off, the Google browser
key is absent, and the existing legacy-photo flag is on. No key was printed.

Read-only staging/file checks established:

- Smithfield Hall: one cached image. Barcade/Chelsea: three cached images.
  Local Smithfield and Chelsea Barcade image URLs returned HTTP 200/image-webp.
- Lulla NYC, Hello Hello Bar & Cafe and Crompton Ale House: `photo_count=0`
  and no corresponding cached images. They have Google place IDs.
- The lightbox now reports loading/missing photos instead of silently omitting
  the section. This does **not** populate missing photos.

Vercel is linked to the existing `next-bar` project. A read-only inspection
found Production names for `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`,
`NEXT_PUBLIC_GOOGLE_MEDIA` and `GOOGLE_MEDIA_RUNTIME_ENABLED`. Individual API
reads returned `decrypted: false` with no value. No settings were copied,
changed or activated. Do not repeat attempts to retrieve the old keys while
the owner is planning their rotation and billing reset.

An earlier question asking which specific venue's lightbox failed was not
answered. No live browser inspection proved that all existing photo files fail
to render. Separate missing venue content from a rendering defect.

## Alternative researched, not implemented or approved

OpenFreeMap advertises a free public vector-map service without registration
or API keys, permits commercial use, and offers a Dark style. Its attribution
must remain. It has no promised SLA.

The app currently uses Leaflet 1.9.4/react-leaflet 4.2.1, not MapLibre.
OpenFreeMap documents a MapLibre/Leaflet adapter, which could retain the existing
markers and interactions. This is a possible approach, **not a selected or
verified implementation**. No dependencies were installed or lockfiles changed.

A direct request to `https://tiles.openfreemap.org/styles/dark` returned HTTP
403 in this environment. The web tool also could not open it. Thus the actual
style, tile loading and NYC appearance have not been verified here. Do not
promise this provider works locally based only on its documentation.

Sources:

- https://openfreemap.org/
- https://openfreemap.org/quick_start/
- https://github.com/maplibre/maplibre-gl-leaflet
- https://carto.com/basemaps/apikey/
- https://docs.carto.com/faqs/carto-basemaps

CARTO supplied the old visual style, but it is not a requirement of Next Bar.
Credit alone does not remove CARTO's new watermark; its own raster service
requires a key. That is why choosing a different source must be deliberate.

## Verification and release boundaries

Last full green candidate was the **owner-rejected OSM appearance**, aggregate
`4ed549533738796544eddbb64705d4cefa71dd2077bfb30f75e890695056ea00`:

- Typecheck passed.
- Vitest: 3080 passed / 7 skipped, 446.71 seconds.
  `D:/Temp/next-bar-vitest-maps-copy-20260907.log`
- Production-build Playwright: 716 passed / 2 existing friends-overscroll skips,
  9.6 minutes, both phone projects, three workers, zero retries.
  `D:/Temp/next-bar-e2e-maps-copy-20260907.log`
- Map tiles were mocked. Live Google photos were not verified.

The separate release-contract check still has two pre-existing validator
`DIGEST_DRIFT` findings:
`D:/Temp/next-bar-contract-maps-copy-20260907.log`.
Do not label V8 release-ready. No deployment, migration, TestFlight upload or
cloud environment change occurred.

## Next working session

1. Start from the latest owner direction: a crisp black-and-white map, without
   assuming CARTO or another key is necessary. Retire the partial CARTO-key
   approach when implementing the selected replacement.
2. Verify an actual NYC map's appearance and loading, not only mocked tile
   requests. Preserve existing markers, search, controls, gestures and credit.
3. Keep automatic routing, distance-mode behavior, shorter copy and tag work.
4. Leave Google media off locally while the owner handles the separate Google
   account/key reset. Do not create extra env files.
5. After a concrete map implementation, run the repository gates serially:
   typecheck, full Vitest, then `npm run test:e2e` (production wrapper, no CLI
   reporter override). Stop the preview before heavy build/test runs and
   restore it afterward. Do not treat a green mocked suite as visual approval.

Use one agent. No external model calls or delegation were used in this slice.
Reuse the existing harness goal `01a06dc8-f41c-79f0-a511-78824ebe50c5`; do not
create a duplicate. The handoff closes the current implementation session;
reacquire a lease before further product edits. Longer implementation history
is in `docs/DISTANCE-IMPLEMENTATION-2026-09-06.md` and
`D:/harness-handoffs/FACTS.md`.
