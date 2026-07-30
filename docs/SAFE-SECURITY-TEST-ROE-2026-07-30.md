# Next Bar safe security-test rules of engagement

Prepared 2026-07-30. This document authorizes nothing by itself. Complete and
approve the authorization record before any active test. Testing defaults to
**not allowed** when an asset, technique, account, time window, or safety limit
is not explicitly covered.

The purpose is to find exploitable weaknesses in systems owned by Next Bar
while minimizing operational impact, privacy exposure, cost, and ambiguity.
Staging is the primary target. Production is limited to attended, low-impact
confirmation after the same class of test succeeds safely in staging.

## Authorization record

Complete this immediately before each assessment:

| Field | Required value |
|---|---|
| Authorizing owner | Name and authority over every target |
| Test lead | Named person or agent session |
| In-scope assets | Exact domains, API origins, bundle IDs, and owned projects |
| Environment | Staging, TestFlight, or Production |
| Start and stop | Date, time, and timezone |
| Source | Approved test machine and source IP, when stable |
| Test accounts | Dedicated synthetic accounts and their roles |
| Allowed techniques | Selected from the safe test areas below |
| Request ceiling | Per-endpoint rate and total test budget |
| Monitoring owner | Person watching logs, alerts, cost, and availability |
| Emergency contact | Person who can stop traffic or disable a feature |
| Stop phrase | Unambiguous instruction that ends the test immediately |
| Evidence location | Access-controlled folder with retention date |

Separate authorization is required for Production. Authorization for
`next-bar.app` does not authorize testing Vercel, Supabase, Apple, Google,
Brevo, CARTO, GitHub, or any other provider's shared infrastructure.

## In scope when explicitly selected

- Passive review of TLS, HTTP headers, public files, browser bundles, and
  externally visible configuration.
- Repository review for secrets, unsafe dependencies, authorization boundaries,
  RLS, grants, security-definer functions, input validation, and error handling.
- Authentication, session, CORS, CSRF, and account-lifecycle behavior using
  dedicated test accounts.
- Horizontal and vertical authorization checks between synthetic accounts,
  stopping when unauthorized access is minimally demonstrated.
- API validation, bounded rate-limit behavior, and abuse controls at the
  pre-approved request ceiling.
- Mobile static and dynamic review of a staging/TestFlight build, including
  local storage, transport security, permissions, deep links, and backend
  environment selection.
- Low-impact Production confirmation of a staging finding when separately
  approved and necessary to establish whether Production is affected.

## Never allowed under this document

- Denial-of-service, stress, soak, concurrency, or capacity testing.
- Credential stuffing, password spraying, brute force, phishing, social
  engineering, or attempts against accounts not created for the test.
- Deleting, corrupting, encrypting, or materially changing real user data.
- Downloading, enumerating, retaining, or sharing real user data. If it appears,
  stop immediately and record only the minimum metadata needed to notify the
  owner.
- Destructive SQL, migration application, backup restoration, production
  configuration changes, DNS changes, credential rotation, or deployment.
- Persistence, malware, web shells, remote-control tooling, or lateral movement.
- Using a discovered credential beyond the minimum safe validation required to
  show that it is live; never print or place credential values in the report.
- Testing provider-owned infrastructure, other tenants, employee devices,
  personal accounts, or third-party APIs outside Next Bar's application-level
  integration.
- Mass scraping, bulk email/SMS/push traffic, cost amplification, or bypassing
  provider quotas.
- Public disclosure or contacting third parties without the owner's approval.

## Mandatory stop conditions

Stop active testing and notify the monitoring owner if any of these occurs:

- A real user's private data becomes visible.
- Availability, latency, errors, cost, or alert volume materially changes.
- A test reaches an asset, account, environment, or technique outside scope.
- A credential, signing key, service-role key, or database URL is exposed.
- The result could alter or delete real data.
- Monitoring is unavailable, the emergency contact cannot be reached, or the
  approved window ends.
- The owner or incident lead issues the stop phrase.

Do not continue to determine “how much more” is exposed. Preserve minimal
evidence, end the test, and move to incident handling.

## Test sequence

1. **Desk and source review:** map assets, data, trust boundaries, credentials,
   rate/cost risks, and existing controls. No network attack traffic.
2. **Staging passive checks:** inspect the staging deployment and TestFlight
   build using synthetic data.
3. **Staging active checks:** exercise the approved security cases with
   dedicated accounts and bounded traffic. Stop at minimum proof.
4. **Fix and retest:** reproduce the fix in staging and check adjacent
   authorization paths for regression.
5. **Production confirmation:** only when separately approved, attended,
   monitored, and safely reproducible with synthetic accounts.
6. **Closeout:** revoke test credentials, remove synthetic data when safe,
   secure evidence, review costs/logs, and issue the findings report.

No overnight loop may perform steps 3 or 5. An overnight loop may prepare test
cases, fixtures, static analysis, and an assessment plan.

## Finding and evidence standard

Each finding records:

- identifier, date, tester, environment, and affected asset;
- preconditions and synthetic accounts used;
- plain-language impact and affected trust boundary;
- minimal reproducible steps with secrets and personal data redacted;
- the smallest evidence that proves the issue;
- severity and confidence;
- detection signal and whether existing monitoring noticed it;
- recommended fix, recovery option, owner, and retest status;
- the nine-factor Change Risk Brief when remediation is consequential.

Screenshots and logs must exclude secrets and real-user content. Evidence stays
access-controlled and is deleted on the retention date.

## Pre-test go/no-go

Production testing is **NO-GO** unless all are true:

- the authorization record is complete;
- staging exists and contains only synthetic test data;
- backups and rollback/kill-switch procedures are understood;
- monitoring and budget alerts are active and watched;
- dedicated accounts are ready;
- affected providers' acceptable-use terms have been checked;
- the exact test cases and request ceiling are approved;
- the emergency contact is available.

## Standards used

- [NIST SP 800-115, Technical Guide to Information Security Testing and
  Assessment](https://csrc.nist.gov/pubs/sp/800/115/final)
- [NIST definition of Rules of
  Engagement](https://csrc.nist.gov/glossary/term/rules_of_engagement)
- [OWASP Web Security Testing
  Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [OWASP Mobile Application Security Testing
  Guide](https://mas.owasp.org/MASTG/)
- [OWASP Rules of Engagement
  template](https://owasp.org/APTS/standard/appendix/Rules_of_Engagement_Template.html)
