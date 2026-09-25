# Swift push 1 — scaffold, sign-in, onboarding, Next Bar? home

Status: SPEC, written 2026-09-24 from the owner-approved mocks and the six owner decisions of the same day.
Source of truth for the look: canvas https://claude.ai/artifact/2YHvtk5Ko4n4cVLhsPgPA6 (artboards named below)
and `design-refs-20260923/home-mock-v3.png` (Next Bar? home, already shipped on the web as NB-01/NB-01b).
Owner decisions: HANDOFF-20260924-TWO-TRACKS.md (screen matrix) and HANDOFF-20260924-PM.md (the six answers).

## Decisions this spec builds on (do not reopen)

| # | Decision |
|---|---|
| 1 | Minimum iOS 17. SwiftUI only. |
| 2 | Bundle id `com.nextbar.app` — the same as the Capacitor shell. TestFlight build 17 replaces build 16. |
| 3 | Bar photos via Google Places UI Kit for iOS (billable per view, never cached). Own photo source is NB-03, later. |
| 4 | Phone/SMS sign-up is deferred to push 4. The "Continue with phone" button is NOT built in push 1. |
| 5 | Web = bug fixes only. Nothing in this push touches the Next.js app except the `apple-app-site-association` file. |
| 6 | Build model: Swift toolchain on the Windows laptop for `NextBarCore` (`swift build` / `swift test`); the GitHub `macos-26` runner builds the app, runs XCUITests, uploads to TestFlight. No rented Mac. |

Palette: the warm-grey ladder approved 2026-09-24 (base #0b0a09, card #161412, raised #211e1b, fill #2c2824, selected #3a3531;
text #f5f2ee / #a8a29b / #6f6962; orange #ff5b3a, orange text #ff8a6e, soft #3a1c14, deep #9e2f1a, pressed #e0482a).
The mocks were drawn on #0a0a0a/#141414 before that decision — build to the ladder, not the mock hexes.
Type: Poppins 400/500/600 (the brand pair per CLAUDE.md V9-11; bundle the font files, never system fonts).

## Repository layout (assumption — same repo, new top-level folder)

```
apple/
  project.yml                 # XcodeGen spec — authored on Windows, generates NextBar.xcodeproj on the runner
  NextBar/                    # the app target (SwiftUI)
    App/                      # NextBarApp.swift, RootView (TabView), Session
    Features/Auth/            # CreateAccount, CheckInbox, SignIn
    Features/Onboarding/      # Username, LocationPrimer, Quiz, FindFriends, OnboardingFlow
    Features/Home/            # NextBarHome, ResultCard, TweakVibeSheet, DistanceChips
    Resources/                # Poppins TTFs, Assets.xcassets, Info.plist strings
  NextBarUITests/             # XCUITests, one per screen below; screenshots as artifacts
  Packages/NextBarCore/       # Swift package: models + logic, no UIKit/SwiftUI import
    Sources/NextBarCore/
    Tests/NextBarCoreTests/
```

Why one repo: the runner, fastlane lane, signing secrets (`ASC_*`, `IOS_*`) and Santa review flow already live here.
A second workflow file `.github/workflows/ios-swift.yml` builds `apple/`; the Capacitor workflow stays untouched
until the owner retires the shell.

## NextBarCore — what gets ported (verifiable on Windows, first)

Port from `src/lib` and `src/types/index.ts`, test-for-test. Each TS test file becomes a Swift test file with the
same cases and the same expected numbers; a port whose tests differ from the TS ones is wrong.

| Swift file | From | Must keep |
|---|---|---|
| `Models.swift` | `types/index.ts`: `Coords`, `Neighborhood`, `VibeTag`, `VibeProfile`, `Bar`, `Rating` | `Codable` with the exact JSON keys Supabase returns (snake_case where the web reads snake_case) |
| `Constants.swift` | `lib/constants.ts` | every named number (RADIUS_WALK 1.5, RADIUS_CAB 4, RESULTS_COUNT 5, late-night hours 22–4, boosts 0.12 …) |
| `VibeAxes.swift` | `lib/vibeAxes.ts` | `AXIS_ORDER`, `VIBE_AXES`, `axisOf` |
| `Quiz.swift` | `lib/quiz.ts` | the 8 questions verbatim (7 single-pick + 1 neighborhood multi-select), `deriveArchetype` |
| `TasteAffinity.swift` | `lib/tasteAffinity.ts` | `deriveLearnedTaste`, `learnedTasteScore`, `EMPTY_TASTE` |
| `Matching.swift` | `lib/matching.ts` | the ranker: distance bands, learned taste, exact miles as final tie-break only; explicit vibe vs quiz prior; late-night bias; the 15-candidate cut before routing |
| `TravelTime.swift` | `lib/travelTime.ts` | `TravelBand`, `matchesTravelBand`, `isWalkable`, `routeCopy`, `WALKABLE_SECONDS` 900, caps 15/5 |
| `Haversine.swift` | wherever `haversineMiles` lives | same output to 1e-9 mi on the TS fixtures |
| `SupabaseClient.swift` | new | thin layer over `supabase-swift`: `claimHandle(_:)` → rpc `claim_handle(desired)`, `searchHandles(_:)` → rpc `search_handles(query)`, `profile()` / `saveProfile()` → `profiles`, `bars()` → the same catalog read the web makes, `travel(origin, ids, mode, walkableOnly, band)` → `POST https://next-bar.com/api/travel` (the routing key stays server-side) |

Exit criterion for the Windows loop: `swift test` green on `Packages/NextBarCore` with at least the case count of the
TS files it ports. This is the only part of push 1 that can be verified without the runner, so it goes first and an
overnight worker may own it.

## Screens (each = one SwiftUI view + one XCUITest + one screenshot artifact)

Common: `NavigationStack` per flow; Back is the system chevron (44pt); one orange filled button per screen, 50pt tall,
pill radius; body text ≥ 13pt; every icon-only control has an accessibility label; no fake status bar; light and
dark render (dark is the product, light must not break). Tab bar hidden for every onboarding screen.

### 1. Tab shell — `RootView`
`TabView` with five tabs in this order: Next Bar? (house), Map (pin), Rankings (list), Tonight (people), Account
(person). SF Symbols, 10pt labels, tint-only active state (no pill). Push 1 ships real content only on Next Bar?;
the other four show their title and a one-line "Coming in the next build" body — never a blank view.
Signed-out launch goes to Create account, not to a tab.

### 2. Create account — artboard `CreateAccount.dc.html`
Title "Create your account". Buttons in order: **Continue with Apple** (white pill, Apple glyph,
`SignInWithAppleButton`), **Continue with Google** (outlined pill; Supabase OAuth in `ASWebAuthenticationSession`),
divider "or", **Email** field (`.textContentType(.emailAddress)`, `.keyboardType(.emailAddress)`),
**Continue with email** (orange). Footer "By continuing you agree to the Terms and Privacy Policy." with both links
opening `https://next-bar.com/terms` and `/privacy` in `SFSafariViewController`. Bottom line "Have an account? Sign in".
No phone button (decision 4). No password field on this screen: email path = Supabase magic link
(`signInWithOTP(email:)`), which lands in Check inbox.
XCUITest: all four controls present; empty email disables Continue; a malformed email shows one inline error line.

### 3. Check inbox — artboard `CheckInbox.dc.html`
Envelope glyph in a raised circle, "Check your inbox", "We sent a link to {email}. Tap it to finish signing up."
Buttons: **Open Mail** (orange; opens `message://`, hidden if the URL cannot be opened), **Resend email** (outlined;
disabled 30 s after each send with the countdown in the label), text link "Wrong email? Change it" (pops back).
The magic link opens the app via the universal link `https://next-bar.com/auth/callback?...` (Associated Domains
entitlement `applinks:next-bar.com`) and the app exchanges the code for a session. Until the AASA file is live the
link opens the web callback — acceptable for the first runner build, not for testers.
XCUITest: resend disabled state and countdown; Change it returns to Create account with the email prefilled.

### 4. Username — artboard `Username.dc.html`
Segmented progress bar 1 of 4 (Username · Location · Quiz · Friends). Title "Pick a username". One big field with a
grey "@" prefix, 28pt, orange underline; live availability via `search_handles`/`claim_handle` debounced 300 ms:
green check when free, red line "Taken" when not. Up to three suggestion chips under the field (derived from the
display name / email local part; tapping fills the field). Helper "Friends find you by this. You can change it later."
**Continue** claims the handle; on 23505/taken show the red line and stay.
XCUITest: typing a taken handle (fixture) shows "Taken" and disables Continue; a free one enables it.

### 5. Location primer — NB-01b (approved), web `src/app/onboarding/location`
Progress 2 of 4. Same copy as the web primer. One orange **Share my location** button →
`CLLocationManager.requestWhenInUseAuthorization()`; a text "Not now" that continues without location (the home then
opens on the neighborhood picker exactly as the web does). `NSLocationWhenInUseUsageDescription` in Info.plist uses
the web primer's one-sentence reason.
XCUITest: with location denied in the simulator the flow still reaches Quiz.

### 6. Vibe quiz — artboard `Quiz.dc.html`
Progress 3 of 4 on the outer bar; inside, "1 of 8" in the nav bar centre, **Skip** at the right (skips the whole quiz),
an 8-segment bar, the question as the 30pt title, full-width option cards 60pt tall (selected = orange fill, others
= card fill with hairline), helper "Tunes your first picks. You can change it any time from Tweak the vibe.", **Next**
(disabled until a pick; the neighborhood question allows many picks and "None, surprise me"). Questions and options
come from `NextBarCore.Quiz`, never retyped. Answers → `VibeProfile` → `saveProfile()` (same `profiles` write as the
web). Back inside the quiz goes to the previous question, not out of the quiz.
XCUITest: answering all 8 lands on Find friends; Skip on question 1 also lands on Find friends with an empty profile.

### 7. Find friends — artboard `FindFriends.dc.html`
Progress 4 of 4. Title "Find your friends". Search field "Search by username" (uses `search_handles`); result rows =
44pt initials avatar, name, @handle, a round **+** (follow request) that becomes an orange check. Section
"Or send friends your link" with two rows: **Share invite link** (`ShareLink` with `https://next-bar.com/u/{handle}`)
and **Copy link** (haptic on copy). **Done** → Next Bar? home. Skip top-right does the same.
Contacts import is NOT in push 1 (no Contacts permission string yet).
XCUITest: search fixture returns rows; + toggles to check; Done lands on the home tab.

### 8. Next Bar? home — `home-mock-v3.png`, web `WhereNextFlow` + `ResultsView` + `ResultCard` as the behaviour spec
Content-first: with location granted the screen opens straight on results. Header: wordmark (Poppins 700), the
**Tweak the vibe** pill (opens a `.sheet` of the vibe axes, same tags as the web), the distance segmented control
**Walkable · Worth a cab · Anywhere** (`Picker(.segmented)`), one location line "Near you · {neighborhood}".
Cards in a `ScrollView`/`LazyVStack`: 16:9 hero photo (Places UI Kit `PlaceDetailsCompactView` or the app's own
`AsyncImage` when the bar carries a photo URL), gradient with "{rank}. {name}" and "{NEIGHBORHOOD} · $$", meta line
"● Open until 11 PM · Walk 2 min", one text action **Photos & hours** (opens a sheet with the photo carousel, hours,
Open in Maps). Five results (`RESULTS_COUNT`). Ranking and band filtering run in `NextBarCore.Matching`; walk times
come from `/api/travel`.
Loading contract (bug fixed on the web 2026-09-24, keep it): while routes are pending show three pulsing 16:9
placeholders and "Checking street routes…", never an empty-state sentence; a probe that fails or times out (10 s)
shows the cards without minutes plus the one-line "Route times unavailable".
Without location: the home opens on the neighborhood picker (web `pickBar`/neighborhood path), no permission wall.
`.refreshable` re-ranks. `.sensoryFeedback(.selection)` on band change.
XCUITest: five cards render for a fixed Manhattan location with a stubbed catalog; the loading placeholders appear
before the first card; band change re-orders; Tweak the vibe sheet opens and applies one tag.

## Plumbing checklist (owner or attended session; each is a prerequisite it names)

- [ ] Supabase Auth → Providers: **Apple** (Services ID, key, team id) and **Google** (iOS client id). Needed by screen 2.
- [ ] Apple Developer → App ID `com.nextbar.app`: **Sign in with Apple** + **Associated Domains** capabilities. Screens 2–3.
- [ ] `public/.well-known/apple-app-site-association` on next-bar.com (`applinks` for `/auth/callback`, `/u/*`, `/share/*`,
      `/night-out/*`; `appID` = `{TEAM_ID}.com.nextbar.app`). Served as `application/json`, no redirect. Screen 3. (Web change, allowed: it is the one file the web keeps for the Swift app.)
- [ ] Google Places **iOS** API key, restricted to bundle `com.nextbar.app` — separate from the web/server keys. Screen 8.
- [ ] Info.plist strings: location (screen 5). Camera / photos / contacts strings wait for their pushes.
- [ ] Runner: `apple/` workflow with XcodeGen → `xcodebuild test` (simulator, iPhone 15, iOS 17) → screenshots as artifacts →
      fastlane `pilot` upload as build 17 with the existing `ASC_*`/`IOS_*` secrets. The provisioning profile must be
      regenerated after the two new capabilities are added.

## Order of work

1. `NextBarCore` port + tests (Windows, `swift test`). Overnight-eligible once the toolchain is installed.
2. `apple/project.yml` + app skeleton + tab shell + workflow; first runner build must upload build 17 (a shell with five tabs and Create account). Attended.
3. Screens 2, 3, 4 (auth + username) with the plumbing rows they need.
4. Screens 5, 6, 7.
5. Screen 8.
Each step: Codex + Fable review of the diff, runner green with screenshots, owner look on TestFlight before the next.

## Out of scope for push 1

Map, Rankings, Tonight/Feed/Plans, group thread, new night out, camera, Account, Settings, Edit profile, push
notifications, phone sign-up, Contacts import, own photo pipeline. They are pushes 2–5 in the two-tracks handoff.
