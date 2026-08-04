# iOS TestFlight runbook

Status: architecture implementation in progress. No Apple resource, signed IPA,
TestFlight build, domain, credential, or deployment was created by this goal.

## Architecture

Next Bar has two mechanically separate native profiles:

| Profile | Purpose | UI | Hosted origin |
|---|---|---|---|
| `release` | External TestFlight/App Store candidate | Locally packaged in `native/app` | Consumer API/auth only: Staging or `https://app.next-bar.com`, baked per binary |
| `internal-remote` | Short-lived signing/TestFlight pipeline probe | Remote consumer web app plus honest offline fallback | Exact operator-reviewed consumer Staging origin only |

Release configuration never contains `server.url`. The internal profile requires
both `CAPACITOR_INTERNAL_ONLY_CONFIRM=INTERNAL ONLY` and a credential-free HTTPS
`CAPACITOR_REMOTE_ORIGIN`. It rejects the public apex, consumer Production,
partner, and investor origins.

The target domain topology is:

- public site: `https://next-bar.com`;
- consumer app/API: `https://app.next-bar.com`;
- protected consumer Staging: `https://staging.next-bar.com`;
- venue partner portal: `https://partners.next-bar.com`;
- investor portal: `https://investors.next-bar.com`.

The existing Vercel Staging project remains the correct browser/Playwright QA
environment. Do not disable its protection or put a Vercel automation-bypass
secret in an app. Until the exact Staging hostname and non-secret access flow
work inside an iOS WebView, the internal remote-shell build is configuration-
ready but operationally blocked.

## Current local gates

Run the internal-only static/toolchain gate:

```powershell
$env:CAPACITOR_REMOTE_ORIGIN='https://staging.next-bar.com'
npm run preflight:testflight:internal
```

This does not contact Vercel or Apple. It validates the internal profile and
keeps these release gaps visible:

- `native/app/index.html` is not built yet;
- PKCE/deep-link auth is not implemented yet;
- the reconciled 1024×1024 no-alpha Xcode AppIcon is present and mechanically
  verified; final operator visual approval remains;
- `/support` is absent;
- `com.nextbar.app` remains operator-unconfirmed.

Run the release gate separately:

```powershell
npm run preflight:testflight
```

It must remain red until local product assets and PKCE/deep-link auth land. Do
not weaken those failures to get a build.

## Operator gates before the first cloud-Mac run

1. Confirm the Bundle ID `com.nextbar.app` or choose the final replacement.
2. In Vercel, record the exact consumer Staging project and hostname. Verify
   access from an iOS-compatible browser flow without a bypass token in the URL
   or binary. `staging.next-bar.com` is the intended stable hostname but is not
   currently attached.
3. Confirm whether an App Store Connect app record, App ID, TestFlight group,
   signing certificate/profile, or prior IPA already exists. Never recreate an
   existing resource blindly.
4. Confirm these GitHub secret **names** exist without printing their values:
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `APPLE_TEAM_ID`.
5. Show the operator the exact reviewed source SHA and workflow inputs. Obtain
   a separate upload approval before dispatch.

## Apple setup, only if the inventory proves it is absent

These are attended operator actions, not automatic steps:

1. Apple Developer → Certificates, IDs & Profiles → Identifiers → App ID.
2. Use the operator-confirmed Bundle ID.
3. App Store Connect → My Apps → New App, using the same Bundle ID.
4. Create or reuse a least-privileged App Store Connect API key that can perform
   the required signing/upload action. Downloaded private-key material belongs
   in the operator's password manager and GitHub Actions secret store, never in
   the repository or terminal output.
5. Add the four required GitHub secret names after showing the operator the
   exact repository/environment target.

## Internal-only workflow dispatch

The workflow is manual and accepts only a reviewed origin plus an exact
confirmation. Example shape—do not run it without the upload gate:

```powershell
gh workflow run ios-testflight.yml `
  --ref <reviewed-branch-or-tag> `
  -f remote_origin=https://<exact-reviewed-staging-host> `
  -f internal_only_confirmation='INTERNAL ONLY' `
  -f expected_sha=<exact-40-character-reviewed-sha>
```

The workflow:

1. uses Node 22 because Capacitor 8 requires Node 22 or newer;
2. aborts unless the checked-out SHA exactly matches the reviewed SHA input;
3. runs the full internal TestFlight preflight;
4. syncs geolocation/share plugins into the iOS project;
5. signs on a GitHub macOS runner;
6. stamps the exact git SHA into TestFlight changelog metadata;
7. uploads with `distribute_external: false`.

Never add an external TestFlight group to a `server.url` build. The remote-shell
profile exists only to validate signing and App Store Connect plumbing.

## Post-upload validation

After an explicitly approved internal upload:

1. Record workflow run, source SHA, build number, Bundle ID, and App Store
   Connect processing result.
2. Add only the operator as the first internal tester.
3. On a physical iPhone test cold start, Staging access, location prompt,
   nearby-bar behavior, sharing, sign-in/out, account deletion, offline fallback,
   and relaunch.
4. Confirm every API/data identity is Staging and Production is untouched.
5. Expire the build immediately if identity, auth, or protection differs from
   the reviewed expectation.

## Graduation to external TestFlight

External testing remains blocked until all are true:

- local product assets replace the remote shell;
- PKCE/deep-link auth is exercised on a real device;
- the consumer API origin is fail-closed per binary;
- native geolocation/share pass physical-iPhone testing;
- the reconciled 1024 icon receives operator visual approval; support URL,
  privacy labels, account deletion, and Production credentials are approved
  and verified;
- the domain/associated-domain configuration is complete;
- the release preflight has zero failures;
- a fresh T0 review approves the exact candidate SHA.

Production, analytics/PostHog, migrations, DNS attachment, and App Store upload
remain separate attended gates.
