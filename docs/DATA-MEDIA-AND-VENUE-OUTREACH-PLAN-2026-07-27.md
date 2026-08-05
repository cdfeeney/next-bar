# Next Bar data, media, and venue-owner plan

**Status:** Approved planning direction; not yet implemented  
**Recorded:** July 27, 2026  
**Scope:** NYC launch catalog, Google Places usage, bar photography, data
provenance, venue-owner outreach, production cost controls  
**Related documents:** `APP-STORE-PLAN.md`, `BARS-TABLE-SCHEMA.md`,
`SCALE-PLAN.md`

> This is an engineering and operating plan, not legal advice. Have counsel
> review the final photo license, owner-claim terms, privacy disclosures, and
> commercial-email process before broad production outreach.

## 1. Executive decision

Next Bar will keep its photo-led result cards and full-screen bar lightboxes.
The product does not need to become a text-only directory.

The durable model is:

1. Build a canonical NYC venue catalog from government, open, owner-supplied,
   Next Bar-verified, and user-corrected information.
2. Store Google Place IDs, which Google explicitly permits to be stored
   indefinitely.
3. Render other Google content live through an approved Google component when
   needed rather than downloading it into the repository or database.
4. Gradually replace live Google card-photo demand with photos owned or
   properly licensed by Next Bar.
5. Preserve evidence of the source and rights for the fields and photos that
   matter during acquisition diligence.

The media-selection order will be:

```text
Next Bar-owned photo
  -> venue-provided photo
  -> approved user photo
  -> live Google Places UI Kit media
  -> deterministic Next Bar glyph
```

Google is therefore a launch accelerator and a replaceable live service, not
the underlying data asset of the company.

## 2. Verified repository findings

The following measurements were taken from the working tree on July 27, 2026:

- `public/bar-photos/` contains **3,435 files**.
- Those files total **203,771,178 bytes / 194.33 MiB**.
- `src/lib/bars.places.ts` contains persisted Google Place IDs, hours,
  operating status, photo resource names, photo attribution, and review
  excerpts.
- `src/lib/barVisual.ts` converts the presence/count of those photo records
  into local `/bar-photos/*.webp` URLs.
- `src/components/ResultCard.tsx` renders those local images as the 21:9 hero
  and opens `BarLightbox`.
- `src/components/BarLightbox.tsx` renders the local carousel, cached hours,
  and review excerpts.
- `src/components/BarVisualTile.tsx`, `BarPicker.tsx`, `RecapCard.tsx`,
  `TonightSuggestions.tsx`, `WantToGoList.tsx`, shared-night pages, and
  `/discover` also consume local bar images.
- `scripts/refresh-places.mjs` and `scripts/photos-for-table.mts` still contain
  modes that fetch and save Google photos.
- `public/sw.js` uses the same cache for the shell and all same-origin static
  assets. Its non-navigation path is effectively cache-first and unbounded, so
  installed clients may retain old photo responses until the cache version is
  changed.
- The current browser environment has only the server-style
  `GOOGLE_MAPS_API_KEY`. A live web UI integration needs a separate browser
  key with domain and API restrictions.

The older photo counts in `SCALE-PLAN.md` are now stale. Update that document
when implementation begins.

## 3. Verified Google findings

### 3.1 The $300 credit

Google does not provide $300 per Gmail account every month. The standard
Google Cloud offer is a one-time welcome credit for eligible new customers,
currently valid for a limited trial period. Rotating Gmail accounts is not a
valid production financing strategy and presents suspension, abuse-control,
and acquisition-diligence risks.

Google's former recurring $200 Maps credit ended on March 1, 2025. It was
replaced by per-SKU monthly free-usage caps.

### 3.2 Places UI Kit pricing

As recorded on July 27, 2026, the global Places UI Kit Query SKU has:

| Monthly queries | Price per 1,000 |
|---:|---:|
| First 10,000 | Free |
| 10,001-100,000 | $1.00 |
| 100,001-500,000 | $0.80 |
| 500,001-1,000,000 | $0.60 |
| 1,000,001-5,000,000 | $0.30 |
| Above 5,000,000 | $0.08 |

The UI Kit query rate is attractive because a configured component can render
Google-controlled place content without separately paying the raw Place Photo
SKU for the same presentation.

### 3.3 Heavy-engagement cost model

The earlier assumption of approximately 20 queries per MAU only holds when
users see roughly four Google-backed cards in each of five monthly sessions.

If an active user actually sees 100-200 Google-backed bar cards each week, the
model becomes roughly 400-800 queries per MAU per month:

| Heavy MAU | Monthly queries | Approximate monthly UI Kit cost |
|---:|---:|---:|
| 1,000 | 400,000-800,000 | $330-$590 |
| 10,000 | 4,000,000-8,000,000 | $1,610-$2,150 |
| 100,000 | 40,000,000-80,000,000 | $4,710-$7,910 |
| 1,000,000 | 400,000,000-800,000,000 | $33,510-$65,510 |

These are planning estimates, not quotes. Recalculate them against Google's
current price sheet before each funding or expansion plan.

This is not automatically fatal to the business. At the highest volume tier,
400-800 card queries add roughly 3.2-6.4 cents of marginal Google expense per
heavy MAU per month. The strategic risk is permanent vendor dependence, which
is why Google-backed card demand should fall as owned-photo coverage rises.

### 3.4 Caching and attribution

The current Places policy says applications must not prefetch, cache, or store
Places content beyond applicable exceptions. Place IDs are expressly exempt
and may be stored indefinitely.

For a conservative launch posture:

- Persist the Google Place ID.
- Do not download or rehost Google photos.
- Do not persist Google reviews.
- Treat other Google-derived canonical fields as restricted unless a specific,
  documented exception or contract permits the proposed use.
- Keep Google-provided content visually separate from Next Bar content.
- Do not obscure attribution included in a Google UI component.
- Do not place Google-derived content on the CARTO/OpenStreetMap map. The map
  should use canonical open/first-party data.

Google's current Places policies say Google content displayed without a Google
map must still carry Google Maps attribution. Content displayed as map content
must comply with Google's map-specific requirements.

### 3.5 Places UI Kit product risk

The JavaScript Place Details elements are marked experimental as of this
record. Google documents:

- A media element for a single photo.
- An attribution element.
- A `lightbox-preferred` option.
- A full details component that may include multiple photos, hours, reviews,
  and other content.
- Limited CSS customization through documented properties.

The existing Next Bar lightbox should remain the application wrapper.
Google's component should be isolated behind one adapter and a remote kill
switch so a breaking change cannot take down the result experience.

Before committing to Google media in the 21:9 result-card hero, create a
real-device styling spike. If the experimental component cannot preserve the
design, use Google only inside the lightbox and use owned/venue photos or the
glyph on result cards.

### 3.6 Legitimate startup credits

Eligible Google for Startups Scale-tier companies can separately apply for
monthly Google Maps Platform credits. The published benefit recorded on this
date is $600 per month, subject to eligibility, acceptance, a separate
application, and change by Google.

Apply for the program, but do not let credits substitute for query controls or
delay the compliance migration.

## 4. Target media architecture

### 4.1 Central source resolver

Create a single `BarMedia` abstraction. No page should construct bar-photo URLs
directly.

Supported modes:

- `owned`
- `venue`
- `user`
- `google-live`
- `fallback`

The resolver returns the highest-priority usable source and the attribution
metadata needed by the renderer.

### 4.2 Owned media behavior

Owned/licensed images:

- Live in object storage under content-hashed keys.
- Are converted during upload, not during user requests.
- Produce at least a 64px thumbnail, a roughly 480px card image, and a roughly
  1,200px lightbox image.
- Prefer AVIF/WebP with a compatible fallback.
- Receive long-lived CDN/browser caching because Next Bar controls the asset.
- Can be reused across sessions and users.

### 4.3 Live Google behavior

Google UI should:

- Mount only after a recommendation card enters the viewport.
- Never prefetch an entire result pool.
- Keep a mounted component alive during the active result screen.
- Use the existing glyph/skeleton while loading.
- Fail to the glyph when Google is blocked, offline, disabled, or over quota.
- Load one fuller details component only when the lightbox opens.
- Never appear in mass pickers, map markers, saved-list rows, recap rows, or
  other dense directories unless the image is owned/licensed.

This keeps typical Google demand close to the number of recommendations the
user actually sees, rather than the size of the NYC catalog.

### 4.4 Lightbox decision

The lightbox is a retained core feature:

- Owned media uses the current custom carousel.
- Google-backed venues render the approved live Google media/details element
  inside the existing modal structure.
- Hours and reviews from Google, if shown, are rendered live in that component.
- The rest of the modal remains Next Bar-owned: identity, curated blurb,
  ranking action, and navigation.

## 5. Canonical NYC catalog

### 5.1 Source priority

Canonical fields should resolve in this order:

```text
Verified venue submission
  > Next Bar verification
  > government/open record
  > Overture place record
  > moderated user correction
```

Google Place ID is retained as an external link key. Google content does not
silently overwrite the canonical record.

### 5.2 NY State Liquor Authority

Use the official Current Liquor Authority Active Licenses dataset
(`9s3h-dpkz`) as the existence/licensing backbone.

Import:

- License/permit ID
- License class and description
- Legal entity name
- DBA
- Premises address, city, ZIP, and county
- Issue and expiration dates
- Platform-generated georeference

Filter to New York, Kings, Queens, Bronx, and Richmond counties.

Candidate rules:

- Include likely on-premises restaurant, tavern, food-and-beverage, hotel, and
  club license descriptions for review.
- Exclude grocery, liquor store, drug store, wholesale, direct shipper, and
  other off-premises classes.
- Treat "Additional Bar" as a child/additional service area, not an
  independent venue.
- Manually review restaurants, hotels, catering premises, stadiums, and private
  clubs.

The SLA dataset has no email or phone field. It identifies and validates a
licensed premise; it is not an outreach list.

### 5.3 Overture Places

Use the latest Overture Places release, restricted to the NYC bounding box, to
enrich candidate records with:

- Public business name
- Coordinates
- Website
- Public email
- Phone
- Social profiles
- Operating-status signal
- Overture/GERS ID
- Per-record source information

Preserve the Overture release ID, source list, and required upstream
attributions. Review Overture's current licensing/attribution page on every
schema or source change.

### 5.4 NYC DOHMH

Join food-serving bars against the official NYC Restaurant Inspection Results
dataset (`43nn-pn8j`).

The dataset contains an owner/manager-provided business phone. It contains many
inspection rows per establishment, so deduplicate by CAMIS and use the current
establishment record.

Use the phone as a manual verification/contact channel, not as an automated
calling or texting list.

### 5.5 Matching

Give every bar a stable Next Bar UUID. Store external IDs separately:

- NY SLA license/permit ID
- Overture/GERS ID
- DOHMH CAMIS
- Google Place ID

Match with:

1. Normalized address.
2. Geographic distance.
3. DBA/name similarity.
4. Agreement on phone, website, or social profile.

Confidence tiers:

- **High:** same address plus matching name; eligible for automatic merge.
- **Medium:** address match but material legal-name/DBA disagreement; manual
  review.
- **Low:** weak name or distance match; reject or queue for research.

Never merge only because the names are similar.

## 6. Minimal provenance and operations schema

### `bar_external_ids`

Maps a Next Bar UUID to SLA, Overture, DOHMH, and Google identifiers.

### `bar_field_sources`

Track only fields that materially affect compliance or the product:

- Name
- Address
- Coordinates
- Hours
- Operating status
- Website/phone

Each record stores source type, source record/release, evidence URL when
applicable, confidence, observed time, and verification time.

### `bar_photos`

Minimum fields:

- Bar ID
- Object-storage key
- Source: Next Bar, venue, user, or licensed third party
- Rights basis
- Photographer/attribution
- Evidence URL or permission record
- Person and business granting permission
- Permission timestamp
- Accepted license version
- Primary-photo flag
- Moderation/status fields
- File hash and timestamps

Do not insert Google live photo URLs or resource names into this table.

### `bar_claims`

Stores venue claims, verification method, claimant role, status, reviewer, and
timestamps.

### `bar_change_queue`

Stores suspected closures, changed names/addresses, possible duplicates,
owner submissions, and user corrections for manual review.

### `dataset_runs`

Stores dataset/release ID, checksum, row counts, import time, rejection counts,
and errors. This makes catalog generation reproducible for diligence.

### `bar_media_daily`

Privacy-light aggregate counts by bar, date, event, and source:

- Result-card impression
- Google component mounted
- Owned image served
- Lightbox opened
- Fallback shown
- Maps opened

Do not store user IDs or raw browsing histories in this table.

## 7. Refresh schedule

| Source | Initial cadence | Purpose |
|---|---:|---|
| NY SLA active licenses | Weekly | New/expired/changed licenses |
| Overture Places | Each monthly release | POI/contact/status enrichment |
| NYC DOHMH | Weekly | Food-establishment phone and liveness signals |
| Verified venue update | After moderation | Canonical hours, links, and photos |
| User correction | Daily moderation queue | Closure, hours, and duplicate reports |
| Google | Live after user interaction | Current Google-controlled presentation |

Run open-data imports as controlled jobs, initially through GitHub Actions or a
manual operator command. Use DuckDB to query only the NYC Overture bounding
box. Do not process the global Overture dataset or a mass catalog import inside
a Vercel request.

A venue should not be marked permanently closed from a single automated
signal. Require owner confirmation, manual verification, or two independent
sources.

## 8. Venue claim and photo-acquisition program

### 8.1 Public owner page

Create `/for-bars` with:

- A free listing explanation.
- A preview of the venue's current card.
- A venue-claim action.
- Hours, website, phone, and social corrections.
- Photo upload.
- A visible photo-rights confirmation.
- A "Venue verified" badge after approval.

Do not promise paid ranking or better recommendation rank in exchange for
photos. Photos improve presentation; ranking remains user-centered.

### 8.2 Claim verification

Preferred methods:

- Link delivered to an official business-domain email.
- Code confirmed through the venue's official social account.
- Manual call to the public business phone.
- Evidence that the claimant manages the official website/social profile.

Avoid collecting sensitive identity documents until actual fraud warrants the
additional burden.

### 8.3 Requested photo set

Ask for:

1. Exterior or recognizable entrance.
2. Interior atmosphere.
3. A distinctive drink, activity, rooftop, patio, stage, or design feature.

Quality requirements:

- Landscape orientation.
- At least 1,600 x 900.
- Original file, not an Instagram screenshot.
- No third-party watermark.
- Photographer name and attribution requirements.
- Avoid prominent identifiable patrons unless the uploader has the necessary
  releases.

### 8.4 Rights language

Have counsel finalize the terms. The intended operational grant is:

> I represent that I own these photographs or am authorized by the copyright
> owner to license them. I grant Next Bar a non-exclusive, worldwide,
> royalty-free license to host, reproduce, resize, crop, display, and
> distribute the photographs in the Next Bar product and in promotion of this
> venue. I retain ownership of the photographs.

A bar owning a copy of an image or appearing in an image does not prove that it
owns the copyright. The photographer generally owns the photograph unless
rights were transferred. Store the rights confirmation, terms version,
timestamp, claimant identity, and required credit.

## 9. Finding owner contact information

Use:

1. Public business email in Overture.
2. Official venue website/contact page.
3. Role-based business email such as `info@`, `hello@`, `events@`, or
   `marketing@`.
4. Official venue social account.
5. DOHMH-provided business phone for a manual contact request.
6. In-person visit with a QR-code claim card.

The liquor-license record helps confirm the DBA, legal entity, and premises.
Do not use a corporate principal's home address or private contact information
for outreach. Do not generate guessed email addresses or buy an unverified
list.

Store:

- Bar ID
- Public contact channel
- Contact value
- Public source URL
- Date discovered
- Last-contacted date
- Outreach status
- Response
- Opt-out/suppression status

## 10. Cold-email guardrails

CAN-SPAM applies to commercial business-to-business email.

The outreach program must:

- Use accurate sender and reply-to information.
- Use a truthful, non-deceptive subject.
- Clearly disclose the commercial/solicitation nature.
- Include a valid physical postal address.
- Offer a simple opt-out.
- Keep the opt-out mechanism available for the required period.
- Honor opt-outs within ten business days.
- Maintain a permanent suppression list.
- Monitor any vendor sending on Next Bar's behalf.

Operational rules:

- Authenticate the sending domain with SPF, DKIM, and DMARC.
- Protect transactional-product email by using a separate outreach stream or
  subdomain.
- Begin with 20-30 founder-written, personalized messages per day.
- Send one follow-up after five to seven business days, then stop.
- Never attach large files; link to the secure claim/upload page.
- Record the public source of every contacted address.
- Do not use address harvesting or dictionary-generated recipients.
- Reassess the law before expanding outreach outside the United States.

### Initial email

**Subject:** Can we feature `[Bar Name]` in Next Bar?

```text
Hi [name or Bar Name team],

I'm Christian, one of the founders of Next Bar, a new NYC app that helps
people choose where to go based on location, atmosphere, and what kind of
night they want.

We would love to feature [Bar Name]. There is no charge. We're asking venues
for up to three authorized photographs--ideally an exterior, an interior,
and something distinctive about the bar--so the listing accurately represents
the space.

You can preview and submit the listing here:

[unique claim link]

Please only upload photos that the venue owns or has permission from the
photographer to use. You can provide the photographer's credit where required.

I'm also happy to send a preview directly or speak with whoever handles
marketing.

Thanks,
Christian
Co-founder, Next Bar
[business postal address]

This is a business solicitation. Reply "unsubscribe" or use [unsubscribe
link] and we will not contact you again.
```

## 11. Outreach prioritization

Do not contact every NYC licensee at once.

Start with:

1. Bars appearing most often in recommendations.
2. Bars generating the most live Google card queries.
3. Bars with no owned/licensed photograph.
4. High-recognition venues that improve launch credibility.
5. Neighborhoods with weak visual coverage.
6. Newly licensed venues likely to have launch photography and an incentive
   for discovery.

Pilot the first 100 venues. Measure:

- Valid-contact rate.
- Reply rate.
- Claim-completion rate.
- Percentage providing legally usable images.
- Time from initial email to approved photo.
- Google card queries displaced by approved photos.

Then improve the message and expand in batches of 100.

## 12. Engineering execution plan

### Phase 0 - Freeze and controls

Estimated effort: half a day.

- Disable photo-download, multi-photo, and Google-review ingest modes.
- Keep Place ID resolution separate from media retrieval.
- Create restricted browser and server Google keys.
- Add budget alerts, practical API quotas, and a remote media kill switch.
- Inventory every existing Google-derived field and asset before removal.

### Phase 1 - UI Kit spike

Estimated effort: half to one day.

- Render one live media/attribution element in the 21:9 card area.
- Render a fuller element inside the existing lightbox.
- Test iPhone Safari, installed PWA, eventual Capacitor/TestFlight, dark mode,
  slow network, offline, blocked scripts, and quota failure.
- Decide whether Google media is acceptable on cards or lightbox-only.

### Phase 2 - Media abstraction

Estimated effort: one to two days.

- Add `BarMedia` and source resolution.
- Migrate `ResultCard`, `BarLightbox`, `BarVisualTile`, `/discover`, pickers,
  recaps, suggestions, saved lists, and shared views.
- Add viewport-triggered Google mounting.
- Preserve the deterministic glyph fallback.
- Add unit and component tests for precedence, failure, and deduplication.

### Phase 3 - Provenance and owned-photo storage

Estimated effort: one to two days.

- Add the minimal tables in section 6.
- Configure object storage.
- Add pre-generated image variants and EXIF removal.
- Add moderation and takedown states.
- Keep owned-photo URLs independent from Google identifiers.

### Phase 4 - Remove persisted Google content

Estimated effort: one day after the replacement passes staging.

- Remove the 3,435 current photo files.
- Remove Google photo resource names, photo counts, attributions, and review
  excerpts from the generated TypeScript sidecar.
- Clear corresponding catalog/database fields.
- Keep Google Place IDs.
- Bump the service-worker cache version to purge old cached assets.
- Verify the production deployment no longer serves removed files.
- Record the removal; do not rewrite Git history as part of this task.

### Phase 5 - Open catalog pipeline

Estimated effort: two to five days plus manual review.

- Import NYC SLA candidates.
- Import an NYC-only Overture extract.
- Import/deduplicate current DOHMH establishments.
- Add external IDs and confidence-based matching.
- Review medium-confidence and ambiguous records.
- Replace Google-derived canonical coordinates/status with permissible
  sources.
- Treat hours as owner/Next Bar/open-sourced unless a documented Google
  exception permits the exact storage/use.

### Phase 6 - Claim and outreach workflow

Estimated effort: two to four days.

- Build `/for-bars` and tokenized claim links.
- Add verification, uploads, permission capture, moderation, and audit trail.
- Add the outreach queue and suppression list.
- Pilot outreach to 100 high-priority venues.

### Phase 7 - Production rollout

Estimated effort: one to two days.

1. Deploy to staging with Google disabled.
2. Verify all owned/glyph paths.
3. Enable Google for internal testing.
4. Test on physical iPhones and TestFlight.
5. Deploy with conservative quotas and the remote kill switch.
6. Monitor for 48 hours before raising quotas.
7. Apply for Google for Startups Maps credits in parallel.

## 13. Thirty-day operating sequence

### Week 1

- Freeze risky ingest.
- Configure Google keys/quotas.
- Complete the UI Kit spike.
- Implement the centralized media path.
- Preserve cards and lightboxes.

### Week 2

- Add owned-photo/provenance storage.
- Remove cached Google media/reviews.
- Bump the service-worker cache.
- Import and reconcile the initial SLA, Overture, and DOHMH catalog.

### Week 3

- Build the bar-claim and photo-upload workflow.
- Add rights confirmation and moderation.
- Build the outreach queue and email suppression controls.

### Week 4

- Contact the first 100 venues.
- Moderate returned photos and updates.
- Deploy through staging and TestFlight.
- Monitor real query volume and fallback behavior.
- Submit the startup-credit application.

## 14. Definition of done

Launch-safe completion requires:

- No Google photo bytes or review text hosted in the repository, deployed
  static assets, object storage, or canonical catalog.
- Google Place IDs retained as external identifiers.
- Canonical map coordinates and map-visible content sourced from
  first-party/open/permitted data.
- Google content rendered only live with visible attribution.
- Cards and lightboxes functional when Google is unavailable.
- No Google query fan-out from dense pickers, lists, or map markers.
- Owned images optimized into call-site-appropriate sizes and safely cached.
- Remote kill switch, key restrictions, quota controls, and billing alerts
  active.
- Service-worker cache migration verified.
- Rights evidence stored for every non-Google photograph.
- Owner corrections and claims pass moderation.
- CAN-SPAM suppression and opt-out processing operational before outreach.
- Typecheck, unit tests, production build, mobile browser, and TestFlight tests
  pass.
- Privacy policy and Terms of Use explain the live Google integration and
  owner/user media process.

## 15. Primary source links

Accessed July 27, 2026:

- Google Places policies and attribution:
  <https://developers.google.com/maps/documentation/places/web-service/policies>
- Google Place Details/UI Kit elements:
  <https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details>
- Google Maps Platform pricing:
  <https://developers.google.com/maps/billing-and-pricing/pricing>
- March 2025 Maps pricing changes:
  <https://developers.google.com/maps/billing-and-pricing/march-2025>
- Google Cloud free program:
  <https://docs.cloud.google.com/free/docs/free-cloud-features>
- Google for Startups benefits:
  <https://cloud.google.com/startup/benefits>
- NY SLA public query:
  <https://sla.ny.gov/public-query>
- NY SLA active licenses (`9s3h-dpkz`):
  <https://data.ny.gov/Economic-Development/Current-Liquor-Authority-Active-Licenses/9s3h-dpkz/about_data>
- NYC Restaurant Inspection Results (`43nn-pn8j`):
  <https://data.cityofnewyork.us/Health/Restaurant-Inspection-Results/43nn-pn8j/about_data>
- Overture Places:
  <https://docs.overturemaps.org/guides/places/>
- Overture attribution and licensing:
  <https://docs.overturemaps.org/attribution/>
- FTC CAN-SPAM compliance guide:
  <https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business>
- U.S. Copyright Office photography guidance:
  <https://www.copyright.gov/engage/docs/photography.pdf>

## 16. Repository implementation map

- `src/types/index.ts` - replace Google-specific persisted media fields with
  source-neutral media/provenance types.
- `src/lib/barVisual.ts` - retain glyph identity; move image selection into
  `BarMedia`.
- `src/components/ResultCard.tsx` - visible-card media and lightbox entry.
- `src/components/BarLightbox.tsx` - owned carousel or live Google details.
- `src/components/BarVisualTile.tsx` - owned thumbnail or glyph only on dense
  surfaces.
- `src/components/BarPicker.tsx` - explicitly prevent live Google fan-out.
- `src/app/discover/page.tsx` - migrate its full-photo card.
- `src/components/RecapCard.tsx`
- `src/components/TonightSuggestions.tsx`
- `src/components/WantToGoList.tsx`
- `src/app/u/[handle]/night/[shareId]/page.tsx`
- `src/lib/bars.places.ts` - remove persisted Google photos/reviews and
  eventually other unsupported canonical fields.
- `src/lib/catalogServer.ts` - map the new provenance/media schema.
- `supabase/migrations/0019_bars_catalog.sql` - supersede Google-specific
  media columns in a new forward migration; do not edit an applied migration.
- `scripts/refresh-places.mjs` - remove/fail closed on download/review modes.
- `scripts/photos-for-table.mts` - retire the Google download path.
- `public/bar-photos/` - remove cached Google assets after replacement passes.
- `public/sw.js` - bump/split the cache so removed media cannot persist.
- `next.config.js` - add caching policy only for owned, content-hashed media
  if served from the Next.js origin.
- `docs/SCALE-PLAN.md` - replace stale photo counts and the old assumption that
  user count does not affect Google cost.

