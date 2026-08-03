# Next Bar domain and support-email operator runbook

Date: 2026-08-03
Canonical domain: `next-bar.com`
Goal: `g-ade01af7-2533-49d3-851f-ca4667704e97`
Status: evidence and operator sequence only; no remote changes performed

## 1. Hard boundary

This packet does not authorize a Production, DNS, Vercel, Supabase, email,
deployment, credential, or migration write. The current remote-write lock stays
armed. The operator must approve each attended write phase after reviewing the
exact target and rollback point.

Never place a secret, DNS API token, Vercel token, Supabase key, SMTP password,
APNs key, or destination mailbox address in this document or terminal output.

## 2. Public DNS evidence

Read-only `Resolve-DnsName` checks on 2026-08-03 observed:

| Name | Public result | Meaning |
|---|---|---|
| `next-bar.com` NS | `houston.ns.cloudflare.com`, `lovisa.ns.cloudflare.com` | Cloudflare is authoritative |
| `next-bar.com` A | `76.76.21.21` | Apex points at Vercel's general-purpose address |
| `www.next-bar.com` CNAME | `cname.vercel-dns.com` | `www` points at Vercel |
| `staging.next-bar.com` | no record | Protected Staging hostname is not configured |
| `next-bar.com` MX | no MX answer | Domain support mail is not publicly routed |
| apex TXT/SPF | no TXT answer | No public SPF was observed |
| `_dmarc.next-bar.com` | no record | No public DMARC policy was observed |

This proves routing intent, not successful Vercel ownership, TLS, deployment
identity, canonical redirects, email delivery, or Supabase callback safety.

### Operator correction — 2026-08-03

The overall custom-domain setup is **not complete**.

The operator confirms that Vercel currently exposes only a Vercel-generated
hostname, reported in conversation as `next-bar-tw.vercel.app`. The exact
hostname spelling must be verified in the Vercel dashboard before it is used
anywhere; older repository material contains `next-bar-two.vercel.app`, so
neither spelling is authoritative without the dashboard.

Current reconciled state:

- Cloudflare owns DNS, and the public apex and `www` records point toward Vercel.
- `next-bar.com` and `www.next-bar.com` are not attached to the intended Vercel
  project.
- Custom-domain ownership, TLS, canonical redirect, and deployment identity are
  not established. Therefore `next-bar.com` must not be described as live.
- Do not recreate or overwrite the already-present Cloudflare records. During an
  attended, separately approved session, first ask Vercel for the exact records
  required by the intended project.
- Configure and validate protected `staging.next-bar.com` before a later
  Production custom-domain attachment.

The remaining read-only reconciliation should establish the exact Vercel project
name and generated hostname, Cloudflare's Active badge and proxy states, any
conflicting dashboard-only records, and the email-routing state. Any
already-complete Cloudflare item is checked off and skipped.

## 3. What the operator can check now without changing anything

### A. Cloudflare DNS inventory

1. Sign in to Cloudflare and select `next-bar.com`.
2. Open **DNS > Records**.
3. Do not add, edit, delete, or toggle a record yet.
4. Record only these non-secret facts:
   - zone status is Active or not;
   - apex `A` record value and whether its cloud is gray/DNS-only or orange/proxied;
   - `www` CNAME value and proxy state;
   - whether any additional apex A/AAAA/CNAME records exist;
   - whether MX, SPF, DKIM, or DMARC records exist in the dashboard but have not propagated;
   - whether a `staging` record exists.
5. Save a private screenshot for operator evidence; do not commit screenshots
   containing account identifiers.

Expected safe starting shape: one apex Vercel record and one `www` Vercel
record. Do not assume the general-purpose values are correct for the project;
Vercel's domain inspector is authoritative for its requested records.

### B. Vercel ownership inventory

Recorded answer: neither custom domain is attached; only a generated Vercel
hostname is currently in use. Its exact spelling remains pending dashboard
verification.

1. Open the Vercel dashboard without changing configuration.
2. Identify the exact project intended for future Production. Record the project
   name/ID only, never environment values.
3. Open that project's **Settings > Domains**.
4. Record whether `next-bar.com` or `www.next-bar.com` is already attached.
5. If present, record the displayed verification/TLS status and redirect target.
6. Do not click Add, Move, Redirect, or Configure yet. Attaching a domain whose
   DNS already points to Vercel can make a deployment publicly reachable
   immediately.
7. Separately inspect `next-bar-staging` and record whether
   `staging.next-bar.com` is attached. Do not add it yet.

### C. Cloudflare email inventory

1. Open **Compute > Email Service > Email Routing**.
2. Record whether `next-bar.com` is onboarded.
3. Record whether a verified destination exists; do not disclose the address.
4. Record whether a `hi@next-bar.com` rule exists and whether it is active.
5. Open **Email Sending** and record whether the domain is eligible/onboarded and
   whether the account is Workers Free or Workers Paid.
6. Do not onboard, verify, or generate an API token in this inventory step.

## 4. Operator decisions

Recommended defaults:

| Decision | Recommendation |
|---|---|
| Canonical web origin | `https://next-bar.com` |
| `www` behavior | permanent redirect to apex |
| Protected Staging hostname | `https://staging.next-bar.com` |
| Initial proxy mode | DNS-only until Vercel ownership and TLS are proven |
| Public support address | `hi@next-bar.com` |
| Inbound support mail | Cloudflare Email Routing to a verified private inbox |
| Outbound human replies | existing authenticated provider/Brevo if it supports the operator's mail client; otherwise select a real mailbox provider |
| Transactional product mail | keep separate from human support replies and preserve Supabase/Brevo authentication boundaries |
| DMARC rollout | begin `p=none`, inspect reports, then tighten later |

Cloudflare inbound routing is not automatically a comfortable human support
mailbox. The operator must be able to reply reliably as `hi@next-bar.com`, not
only receive forwards. Do not change runtime `mailto:` links until both inbound
and outbound tests pass.

## 5. Attended execution phases

### Phase A — protected Staging hostname

This is the safest first remote configuration because it does not cut over the
public Production origin.

1. Show the operator the exact Vercel Staging project ID and current protected
   deployment SHA.
2. Obtain explicit approval for the Staging domain configuration.
3. In the Vercel Staging project, add `staging.next-bar.com` first.
4. Copy only Vercel's displayed DNS target; never guess it.
5. In Cloudflare, create the requested `staging` record as DNS-only.
6. Wait for Vercel to report verified TLS.
7. Confirm Vercel authentication/SSO protection remains enabled.
8. Read `/api/health` and require:
   - `environment: staging`;
   - the exact reviewed Staging SHA;
   - the staging Supabase identity;
   - no Production Supabase reference.
9. Only after a separate privileged-Staging approval, add the exact
   `https://staging.next-bar.com/auth/callback` redirect to the Staging Supabase
   project. No wildcard and no Production host.
10. Test signed-out rejection, signed-in access, auth callback, privacy, terms,
    robots, sitemap, and canonical metadata.

Stop immediately if TLS is invalid, SSO disappears, health says anything other
than Staging, the SHA differs, or a Production identifier appears. Roll back by
removing the new Staging domain assignment/record only; do not alter the known
working Vercel deployment.

### Phase B — support email

1. Choose the private destination inbox without placing it in repo evidence.
2. In Cloudflare Email Routing, onboard `next-bar.com` and review the exact MX,
   SPF, and DKIM changes before accepting them.
3. Verify the private destination using the email Cloudflare sends.
4. Create only the `hi@next-bar.com` routing rule; leave catch-all disabled at
   first.
5. Send an inbound test from an unrelated mailbox and confirm receipt.
6. Configure an authenticated outbound path that can send as
   `hi@next-bar.com`. Do not create a second SPF TXT record; merge authorized
   senders into one valid SPF policy.
7. Add DKIM for the selected outbound provider.
8. Add `_dmarc.next-bar.com` initially with monitoring policy `p=none` and an
   operator-controlled aggregate-report destination.
9. Send a reply to the unrelated mailbox and confirm From, Reply-To, SPF, DKIM,
   and DMARC results.
10. Only after both directions pass should application mailto references change
    from the stale `hi@next-bar.app` address.

Stop if Cloudflare proposes replacing an existing provider's MX/SPF/DKIM records,
if the destination cannot be verified, or if outbound mail cannot authenticate.
Export the pre-change DNS inventory before the attended change so rollback is
exact.

### Phase C — future Production domain cutover

This is a separate attended Production session and requires explicit Production
authorization. Do not combine it with ordinary implementation work.

Prerequisites:

- reviewed Production deployment SHA and rollback deployment recorded;
- Production `/api/health` and account-deletion credential repaired and tested;
- privacy/terms/support routes approved;
- `hi@next-bar.com` inbound and outbound tests green;
- exact Supabase Production callback matrix approved;
- legacy-photo Production decision resolved;
- analytics posture and privacy label resolved.

Sequence:

1. Export Cloudflare's pre-change DNS record inventory.
2. Add `next-bar.com` and `www.next-bar.com` to the exact Production Vercel
   project; do not move a domain from another project without identifying it.
3. Use Vercel's requested DNS values, not remembered generic values.
4. Verify TLS, then set apex canonical and redirect `www` to apex.
5. Verify `/api/health` returns the reviewed Production identity and SHA.
6. Set `NEXT_PUBLIC_SITE_URL=https://next-bar.com` only on the Production
   target and redeploy a newly reviewed SHA if the platform requires it.
7. Add only exact Production Supabase redirect URLs:
   `https://next-bar.com/auth/callback` and any separately justified exact path.
8. Test sign-up, verification, magic link, sign-in/out, deletion, redirects,
   OG cards, privacy, terms, support, robots, sitemap, PWA install, and rollback.

Any correction that changes code or environment creates a new candidate and
invalidates approval for the affected surface.

## 6. Evidence template

Record values, never secrets:

```text
Cloudflare zone status:
Apex record + proxy state:
WWW record + proxy state:
Additional conflicting records:
Vercel Production project identity:
Vercel domain status (read-only):
Vercel Staging project identity:
Staging domain status (read-only):
Email Routing onboarded:
Verified destination exists (yes/no):
hi@ rule exists (yes/no):
Outbound provider selected:
Operator approvals still needed:
```

## 7. Primary references

- Vercel custom domains: https://vercel.com/docs/domains/set-up-custom-domain
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Email Routing: https://developers.cloudflare.com/email-service/get-started/route-emails/
- Cloudflare Email Sending: https://developers.cloudflare.com/email-service/get-started/send-emails/
- Cloudflare Email pricing: https://developers.cloudflare.com/email-service/platform/pricing/

## 8. Explicitly not completed by this packet

- No domain was attached to Vercel.
- No DNS record was changed.
- No Staging or Production environment variable was changed.
- No Supabase redirect was changed.
- No email destination, routing rule, API token, SMTP credential, or DMARC
  reporting address was created.
- No code was pushed or deployed.
- Production was untouched.
