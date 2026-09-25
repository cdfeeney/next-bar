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
3. Picks a simulator destination from `xcodebuild -showdestinations`'s own report for the
   `NextBar` scheme (first `iOS Simulator` line naming an iPhone) — never a hardcoded
   OS/device string, since the runner image's bundled simulators drift release to release.
   (`xcrun simctl list devices available` also runs, as a plain diagnostic log before this
   step — it is not what picks the destination.)
4. `xcodebuild test` against that destination, `CODE_SIGNING_ALLOWED=NO` (simulator only,
   no signing secrets touched).
5. Exports every `XCTAttachment` screenshot from the `.xcresult` bundle, fails the step if
   none came out as a `.png`, exports a JSON test-result summary alongside them, and
   uploads both as artifacts (`build/screenshots/`, 7-day retention).

## UI test launch arguments

- `-uiTesting`: set by every XCUITest (`launchApp()` in `TestNavigation.swift`). Disables
  UIKit animations for deterministic screenshot timing, and stubs Next Bar? home's location
  to a fixed West Village coordinate even if the Location primer test path denies/"Not now"s
  it — so `home`-screen tests always reach ranked results.
- `-uiTestingNoLocation`: added on top of `-uiTesting` to force the neighborhood-picker
  fallback deterministically, in `NextBarHomeScreenTests.testNoLocationShowsNeighborhoodPicker`.
  Without it, plain `-uiTesting` never exercises that branch, since it always stubs a location.

No TestFlight upload, no signing, no fastlane — that stays on `ios-testflight.yml` /
`Fastfile`, which build the separate Capacitor shell under `ios/App/`. The two workflows
are independent; this one never touches that lane's secrets.

## What is stubbed

- **`Session`** (`NextBar/App/Session.swift`) is the entire backend boundary. The only
  implementation right now is `PreviewSession` — an in-memory stub with 8 fixed Manhattan
  bars, three fake handle-search rows, and a `travel()` that always returns an empty
  dictionary (i.e. every route is "unknown"), so Next Bar? home's real
  "Route times unavailable" fallback path gets exercised on every launch rather than a
  fabricated ETA. Under `-uiTesting` it also holds the "checking routes" phase for 1.5s
  so XCUITest can observe the loading placeholders before they're replaced by cards.
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
- Next Bar? home now threads the real `CLLocationManager` result from screen 5 through
  `AppState.homeCoords`: granted coordinates rank "Near you", denied/"Not now" opens the
  neighborhood picker instead (see `-uiTesting`/`-uiTestingNoLocation` above). Open-now /
  hours copy ("Open until 11 PM") is not built: `NextBarCore` doesn't port an hours-open
  helper yet, and duplicating that logic ad hoc in the app would drift from the web. Add
  it to `NextBarCore` first, then wire it here.
- "Photos & hours" is a placeholder tinted rectangle, not Google Places UI Kit (decision
  3 — that's NB-03, a later push).

## Fonts

The brand pair is Poppins 400/500/600 (`Font.nb(_:_:)` in `App/Theme.swift`), plus
Poppins 700 for the Next Bar? home wordmark. The TTFs are bundled at
`apple/NextBar/Resources/Fonts/Poppins-{Regular,Medium,SemiBold,Bold}.ttf` (fetched from
the [Poppins OFL repo](https://github.com/google/fonts/tree/main/ofl/poppins)) and listed
under `project.yml`'s `NextBar` target `info.properties.UIAppFonts`, so XcodeGen registers
them with no further wiring needed.

## Next

- Wire a real `SupabaseSession: Session` (see the mission doc's `SupabaseClient.swift`
  table) and swap it in at `NextBarApp.session` — no other call site changes, by design.
- Google Places UI Kit for bar photos (NB-03).
- The plumbing checklist in `docs/SWIFT-PUSH-1-MISSION.md`: Supabase Auth providers, the
  Sign in with Apple + Associated Domains capabilities, the `apple-app-site-association`
  file, a Places iOS API key, and re-pointing `ios-swift.yml` at a signed TestFlight lane
  once those exist.
