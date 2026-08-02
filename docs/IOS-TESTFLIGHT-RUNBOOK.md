# iOS TestFlight Runbook

**Goal:** Next Bar on TestFlight, built entirely from Windows via GitHub's
cloud Mac runners. Target: first build uploaded within ~1 hour of Apple
Developer enrollment clearing.

## Architecture (30 seconds)

Capacitor wraps the live site (`https://next-bar-two.vercel.app`) in a native
iOS shell (`ios/` + `capacitor.config.ts`). Web deploys update the app
instantly. The native shell only rebuilds when config, plugins, or icons
change — via `.github/workflows/ios-testflight.yml` on a macOS runner with
Xcode cloud signing (no certs stored anywhere).

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

- Name: `github-actions` · Access: **Admin** (required — App Manager cannot
  create the distribution certificate that cloud signing needs).
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

## Every build after that (one command)

```bash
gh workflow run ios-testflight.yml --ref main
```

~15 min on the Mac runner → build appears in App Store Connect → TestFlight
→ processing (~15–30 min) → first build of a new version may sit in "beta
review" up to ~24–48h. Subsequent builds of the same version skip review.

## Inviting testers

App Store Connect → TestFlight → Internal Testing → create group "Partners"
→ add Apple IDs (Justin, Taylor, Cormac + Connor). Internal testers get
builds **immediately, no beta review wait** (up to 100 members of your team;
add them in Users and Access first with any role, e.g. Customer Support).
External groups (friends, bar contacts) DO go through the one-time beta
review — create group "Beta" and send the public link.

Testers install the free **TestFlight** app, tap the invite, done.

## Troubleshooting

- **"No profiles / signing" errors** → API key isn't Admin, or
  `APPLE_TEAM_ID` is wrong.
- **altool/upload 409 duplicate build** → `BUILD_NUMBER` collision; re-run
  the workflow (run_number always increments).
- **App shows blank/offline page** → `native/shell/index.html` rendered,
  meaning the webview couldn't reach the site; check `server.url` in
  `capacitor.config.ts`.
- **Location prompts never appear** → `NSLocationWhenInUseUsageDescription`
  must stay in `ios/App/App/Info.plist`.
- **Apple review "guideline 4.2 minimum functionality"** (App Store
  submission, not TestFlight) → add `@capacitor/push-notifications` +
  re-submit; that's the documented escalation path.
