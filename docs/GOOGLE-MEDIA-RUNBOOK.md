# Google media: credentials and cost controls

Updated 2026-09-08. Supersedes the earlier claims of a per-key daily UI Kit
cap, an immediate quota kill switch, and ResultCard being the sole billing
surface. Actual Google Cloud account settings remain unverified.

## What this release requests

ResultCard and the opened BarLightbox both mount live Places UI Kit widgets.
Each component request can consume a UI Kit Query billing event; the second
widget is not free because it displays the same place. Five result widgets
plus one details widget can therefore make six requests. Lazy loading can
reduce requests; remounts and refreshes can add them.

The current global UI Kit Query price includes 10,000 free events monthly,
then $1 per 1,000 in the first paid tier. Usage is aggregated across projects
on the billing account. Do not budget as if every key/project gets its own
free allowance. Other SKUs, taxes and account-specific terms are separate.
[Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing).

The session counters and `/api/media-metric` are diagnostic estimates. They
cannot meter copied-key traffic or enforce an account spending limit.
Use Cloud Billing for charges; quota metrics are not billing truth.

## Establish identity before changing credentials

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is a configuration variable, not a Google
credential display name. Its value becomes public in built browser output.
Record the actual credential resource ID/display name, Google project ID,
billing account, serving deployment and environment. Compare key values
privately; never paste them into chat, logs or source control. A missing key
in downloaded chunks is inconclusive identity evidence.

The browser credential must differ from any private ingestion credential
(`GOOGLE_MAPS_API_KEY`). Keep website restrictions on the actual production
origins and API restrictions on only the services the accepted UI Kit flow
needs. Do not enable Places API (New) for the rejected raw-photo experiment.
[Google security guidance](https://developers.google.com/maps/api-security-best-practices).

Reconcile existing development credentials before creating another. A local
development key stays out of production only if production is built without
it. Allowing localhost does not identify one computer. Separate keys in one
project share its quotas and do not create separate spending caps.

## Controls and their limits

| Control | What it establishes |
| --- | --- |
| Website and API restrictions | Reduce accepted misuse; the browser key is still visible. |
| Verified project quotas | Limit requests over the actual metric's time window. Google documents UI Kit Query at 6,000 queries/minute/project by default; inspect adjustable metrics in the selected project. Do not assume a daily or per-key cap exists. |
| Billing budget and alerts | Notify; do not stop usage or charges. Billing information can lag up to 48 hours. |
| `GOOGLE_MEDIA_RUNTIME_ENABLED=0` | Disables widgets for a new deployment. Existing Vercel deployments retain their environment; copied-key use is unaffected. |
| `NEXT_PUBLIC_GOOGLE_MEDIA=0` | Disables eligibility in the next build; copied-key use is unaffected. |

Before launch, record the owner's spending target, every allowed billable
service, each enforced quota name/value/window, and the resulting worst-case
usage estimate with headroom. A per-minute limit permits sustained traffic
every minute; it is not a small monthly budget. Verify applied settings and
propagation, not just a submitted adjustment. Google cautions that quota and
billing metrics can differ; do not promise an exact dollar ceiling.
[UI Kit quotas](https://developers.google.com/maps/documentation/javascript/usage-and-billing),
[cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs).

During confirmed abuse, identify the affected credential/services and use
provider-side controls to stop accepted use, accepting the affected feature's
outage. A quota of zero is an option only if that actual metric permits it;
verify enforcement. Credential revocation or disabling the affected service
can interrupt all clients that rely on it. No fixed immediate propagation time
or reversal of accrued charges is promised. Follow with a deployment disabling
widgets. Do not rely on app flags as protection against a copied key.

Rotate only when warranted. For a planned rotation, deploy and verify the
restricted replacement, account for old clients/deployments, then retire the
old key after reviewing its use. An actively abused credential may need faster
revocation. App Check support for this exact UI Kit flow remains unverified.

## Retired assets

The 3,435 cached Google photos were removed from `public/bar-photos` on
2026-09-08 (203,771,178 bytes). Git and Vercel ignore rules prevent accidental
repackaging; middleware continues returning 404 for old URLs. Historical
manual ingestion scripts can recreate that folder and must not be used to
restore the retired cache. No runtime consumer requires these files.

This reduces future deployment output. It does not delete retained Vercel
deployments or reverse storage usage already recorded.
