# NextBar — native SwiftUI app

Swift push 1 scaffold. Spec: `docs/SWIFT-PUSH-1-MISSION.md`. Build model: this package
(`Packages/NextBarCore`) is developed and tested on Windows (`swift build` / `swift test`);
the app itself (`NextBar/`) can only be generated and built on a Mac or the GitHub
`macos-26` runner — Xcode/XcodeGen do not run on Windows.

## Generate the Xcode project (on a Mac)

```sh
brew install xcodegen
cd apple
xcodegen generate --spec project.yml
open NextBar.xcodeproj
```

This produces `NextBar.xcodeproj` (gitignored — it's a generated artifact, same as
`node_modules`). Re-run `xcodegen generate` any time `project.yml` or the file layout
changes; it is not incremental in a way that matters here, just re-run it.

## How the runner builds it

`.github/workflows/ios-swift.yml` runs on `workflow_dispatch` and on push to any
`swift-*` branch:

1. `xcodegen generate --spec apple/project.yml`
2. `swift test --package-path apple/Packages/NextBarCore` (the ranking/model port)
3. Picks the first available iPhone simulator from `xcrun simctl list devices available`
   — never a hardcoded OS version, since the runner image's iOS SDK drifts release to
   release.
4. `xcodebuild test` against that destination, `CODE_SIGNING_ALLOWED=NO` (simulator only,
   no signing secrets touched).
5. Exports every `XCTAttachment` screenshot from the `.xcresult` bundle and uploads both
   as artifacts (`build/screenshots/`, 7-day retention).

No TestFlight upload, no signing, no fastlane — that stays on `ios-testflight.yml` /
`Fastfile`, which build the separate Capacitor shell under `ios/App/`. The two workflows
are independent; this one never touches that lane's secrets.

## What is stubbed

- **`Session`** (`NextBar/App/Session.swift`) is the entire backend boundary. The only
  implementation right now is `PreviewSession` — an in-memory stub with 8 fixed Manhattan
  bars, three fake handle-search rows, and `travel()` that always returns an empty
  dictionary (i.e. every route is "unknown"), so Next Bar? home's real
  "Route times unavailable" fallback path gets exercised on every launch rather than a
  fabricated ETA.
- Apple/Google sign-in in `CreateAccountView` complete instantly (no real Supabase OAuth
  call) and go straight to Username, same as a brand-new account. Email sign-up goes
  through Check inbox first. Tapping "Open Mail" there also advances the stub flow
  directly to Username — there is no real magic-link deep link yet (needs the AASA file
  and Associated Domains capability, see the plumbing checklist in the mission doc), so
  this is the only way to continue past that screen until the real Supabase session
  lands.
- Username's suggestion chips are static placeholders (`barhopper`, `nightowl`,
  `nycregular`), not derived from a display name or email — the stub sign-in paths
  don't actually capture either yet.
- Next Bar? home's "Near you" location line and ranking origin are a hardcoded West
  Village coordinate (`NextBarHomeView.origin`) — screen 5's location primer doesn't wire
  its result anywhere yet. Open-now / hours copy ("Open until 11 PM") is not built:
  `NextBarCore` doesn't port an hours-open helper yet, and duplicating that logic ad hoc
  in the app would drift from the web. Add it to `NextBarCore` first, then wire it here.
- "Photos & hours" is a placeholder tinted rectangle, not Google Places UI Kit (decision
  3 — that's NB-03, a later push).

## Fonts — missing, not yet bundled

The brand pair is Poppins 400/500/600 (`Font.nb(_:_:)` in `App/Theme.swift`), but this
repository has **no Poppins TTF/OTF files anywhere** (`find . -iname 'Poppins*'` outside
`node_modules`/`.next` returns nothing) — the web app loads it from `next/font/google` at
build time, which isn't a font *file* to copy. `Font.custom(_:size:)` falls back to the
system font automatically when a named font isn't registered, so the app builds and runs
correctly today; it just doesn't render in Poppins.

**TODO before this ships:** obtain and add these files, then reference them from
`project.yml`'s `NextBar` target `info.properties.UIAppFonts`:

- `apple/NextBar/Resources/Fonts/Poppins-Regular.ttf`
- `apple/NextBar/Resources/Fonts/Poppins-Medium.ttf`
- `apple/NextBar/Resources/Fonts/Poppins-SemiBold.ttf`

The Next Bar? home wordmark in the mission spec calls for Poppins 700, one weight above
the approved 400/500/600 trio — either get a `Poppins-Bold.ttf` too or confirm 600 is the
intended wordmark weight before TestFlight.

## Next

- Wire a real `SupabaseSession: Session` (see the mission doc's `SupabaseClient.swift`
  table) and swap it in at `NextBarApp.session` — no other call site changes, by design.
- Google Places UI Kit for bar photos (NB-03).
- The plumbing checklist in `docs/SWIFT-PUSH-1-MISSION.md`: Supabase Auth providers, the
  Sign in with Apple + Associated Domains capabilities, the `apple-app-site-association`
  file, a Places iOS API key, and re-pointing `ios-swift.yml` at a signed TestFlight lane
  once those exist.
