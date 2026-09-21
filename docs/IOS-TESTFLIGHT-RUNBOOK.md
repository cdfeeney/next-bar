# iOS TestFlight Runbook

**Goal:** Next Bar on TestFlight, built entirely from Windows via GitHub's
cloud Mac runners. Target: first build uploaded within ~1 hour of Apple
Developer enrollment clearing.

## Architecture (30 seconds)

Capacitor wraps the live site in a native iOS shell (`ios/` +
`capacitor.config.ts`). Web deploys update the app instantly. The native
shell only rebuilds when config, plugins, or icons change — via
`.github/workflows/ios-testflight.yml` on a macOS runner with Xcode cloud
signing (no certs stored anywhere) — until CERT-01 (2026-09-20): now one fixed certificate + profile from secrets, see step 5.

**Origin (2026-08-03):** the shell's origin is config-driven and defaults
to the canonical **`https://next-bar.com`**. Until next-bar.com DNS points
at production, a default-origin binary loads only the offline fallback —
for a pre-DNS internal build, fill the workflow's optional **`server_url`**
input with the current live host. The canonical hosts stay in
`allowNavigation` even under an override, so the DNS cutover cannot strand
an installed build. **Remote-origin (`server.url`) builds are INTERNAL
TestFlight groups only — never external/App Review** (Capacitor docs:
server.url is "not intended for use in production"; the release
architecture is the locally-packaged shell in
TESTFLIGHT-ARCH-DECISION-g-39169b3b on the overnight branch).

> PWABuilder was the original plan; its iOS generator was archived Sept 2025.
> Capacitor is the maintained equivalent and later gives us native plugins
> (push notifications, etc.) if Apple review asks for more app-like behavior
> (guideline 4.2) — a config change, not a rewrite.

## One-time setup (Connor, ~30 min total, all from a browser)

### 1. Apple Developer enrollment — $99/yr

developer.apple.com/programs → enroll as **Individual** (near-instant;
Organization needs a D-U-N-S number, 1–2 weeks). Wait for the confirmation
email before step 2.

### 2. Register the App ID + create the app record (~5 min)

1. developer.apple.com/account → Certificates, IDs & Profiles → Identifiers
   → **+** → App IDs → App. Bundle ID (explicit): `com.nextbar.app`.
   Capabilities: none needed yet.
2. appstoreconnect.apple.com → My Apps → **+** → New App:
   platform iOS, name **Next Bar** (fallbacks if taken: "Next Bar — NYC",
   "Next Bar: NYC Bar Finder"), language English (U.S.),
   bundle ID `com.nextbar.app`, SKU `nextbar-ios`.

### 3. Create the App Store Connect API key (~3 min)

appstoreconnect.apple.com → Users and Access → Integrations → App Store
Connect API → Team Keys → **Generate API Key**.

- Name: `github-actions` · Access: **App Manager** is enough since CERT-01
  (the key only uploads builds now; the certificate comes from a secret). It
  was **Admin** while cloud signing had to mint certificates — an existing
  Admin key keeps working, and downgrading it is optional housekeeping.
- Download the `.p8` file — **downloadable exactly once**; keep it somewhere
  safe (password manager).
- Note the **Key ID** and the **Issuer ID** (top of the page).
- Also grab your **Team ID**: developer.apple.com/account → Membership
  details (10-char alphanumeric).

### 4. Add the four GitHub secrets (~3 min)

Repo → Settings → Secrets and variables → Actions, or from any terminal:

```bash
gh secret set ASC_KEY_ID        --body "<Key ID>"
gh secret set ASC_ISSUER_ID     --body "<Issuer ID>"
gh secret set APPLE_TEAM_ID     --body "<Team ID>"
# PowerShell:
gh secret set ASC_KEY_P8_BASE64 --body ([Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")))
# or Git Bash:
gh secret set ASC_KEY_P8_BASE64 --body "$(base64 -w0 AuthKey_XXXX.p8)"
```

### 5. The fixed signing certificate + profile (CERT-01, 2026-09-20) — three more secrets

Xcode cloud signing on a fresh runner minted a NEW Apple Distribution certificate every run (the runner
never holds the previous private key), and Apple caps those per team: build 13 failed with "maximum number
of certificates". The lane now imports ONE certificate and ONE App Store profile from secrets:

| Secret | What it is | Made how |
| --- | --- | --- |
| `IOS_DIST_P12_BASE64` | the Apple Distribution certificate + its private key, PKCS#12, base64 | key + CSR generated with openssl on Windows (`~/.config/next-bar/ios-distribution.key`, never in the repo); CSR uploaded at developer.apple.com → Certificates → + → Apple Distribution; `.cer` + key → `.p12` |
| `IOS_DIST_P12_PASSWORD` | the .p12 password | random, kept beside the key |
| `IOS_PROFILE_BASE64` | the App Store provisioning profile for com.nextbar.app, base64 | developer.apple.com → Profiles → + → App Store Connect → com.nextbar.app → that certificate → "Next Bar App Store" |

The lane reads the profile's Name from the file itself, so the portal name is a label only. Both the
certificate and the profile expire one year after creation (**2027-09-21** for the current pair); renewing =
repeat the two portal steps with the SAME CSR/key, rebuild the .p12, re-set the three secrets. Old CI-minted
certificates in the portal are dead weight — revoke them (revoking never affects builds already on TestFlight).

## Every build after that (one command)

```bash
# Canonical (requires next-bar.com DNS live):
gh workflow run ios-testflight.yml --ref main
# Pre-DNS internal dogfood (origin override, no code change):
gh workflow run ios-testflight.yml --ref main -f server_url=https://<current-live-host>
```

~15 min on the Mac runner → build appears in App Store Connect → TestFlight
→ processing (~15–30 min) → first build of a new version may sit in "beta
review" up to ~24–48h. Subsequent builds of the same version skip review.

## Inviting testers

App Store Connect → TestFlight → Internal Testing → create group "Partners"
→ add Apple IDs (Justin, Taylor, Cormac + Connor). Internal testers get
builds **immediately, no beta review wait** (up to 100 members of your team;
add them in Users and Access first with any role, e.g. Customer Support).

**External groups: NOT for these builds.** Remote-origin (`server.url`)
binaries are internal-only (see Architecture above) — an external group's
one-time beta review would put a webview wrapper in front of Apple review.
Create the external "Beta" group + public link only after the migration to
the locally-packaged shell (TESTFLIGHT-ARCH-DECISION-g-39169b3b).

Testers install the free **TestFlight** app, tap the invite, done.

## Troubleshooting

- **"No profiles / signing" errors** → since CERT-01 the lane never lets
  Xcode mint anything, so look at the secrets: `IOS_PROFILE_BASE64` or
  `IOS_DIST_P12_BASE64` expired (both 2027-09-21) or do not match each
  other (the profile must embed the imported certificate), or
  `IOS_DIST_P12_PASSWORD` is wrong. `APPLE_TEAM_ID` wrong is the other
  cause. The API key's role is NOT a signing cause any more.
- **altool/upload 409 duplicate build** → `BUILD_NUMBER` collision; re-run
  the workflow (run_number always increments).
- **App shows blank/offline page** → `native/shell/index.html` rendered,
  meaning the webview couldn't reach the site; check `server.url` in
  `capacitor.config.ts`.
- **Location prompts never appear** → `NSLocationWhenInUseUsageDescription`
  must stay in `ios/App/App/Info.plist`.
- **Apple review "guideline 4.2 minimum functionality"** (App Store
  submission, not TestFlight) → a remote-origin build should never reach
  review in the first place (internal groups only). The reviewed
  escalation path (TESTFLIGHT-ARCH-DECISION-g-39169b3b, overnight branch)
  is: migrate to the locally-packaged shell, ship the native geolocation
  bridge first (the app's core function degrades visibly in a webview
  prompt), then share sheet/haptics; push comes after first approval.
