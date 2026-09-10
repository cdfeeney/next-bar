# V9-10 — Apple HIG / SDK applicability inventory for the V9 fixes

Written 2026-09-09 (goal `g-42060d3a`, docs only; product code untouched). Base for every claim:
branch `harness/nb-v9-20260908/v9` at `8e92271` (V9-01/02/03/04/06/07/11 and V9-10b on the branch).
Queue authority: `docs/V9-OVERNIGHT-QUEUE-2026-09-08.md` §V9-10.

This is an applicability inventory, not a compliance certificate. Every row names where a behaviour
actually lives (native UIKit/SwiftUI/Capacitor vs HTML/CSS inside `WKWebView`), the Apple source that
governs it, what evidence exists at the base, and how it can be verified. Nothing here claims
universal HIG compliance, and nothing here proposes replacing the approved Playfair Display / Nunito
Sans pair — Apple's typography guidance accommodates custom fonts when they stay legible and respect
accessibility settings, which is the bar applied below.

## 1. Where the app actually renders

| Layer | What it is | Files |
|---|---|---|
| Native shell | Capacitor 8.5.0 `CAPBridgeViewController` hosting one full-screen `WKWebView`; deployment target iOS 15.0; remote origin (`server.url`) | `ios/App/App/{AppDelegate,SceneDelegate}.swift`, `Info.plist`, `capacitor.config.ts`, `App.xcodeproj` (`IPHONEOS_DEPLOYMENT_TARGET = 15.0`) |
| Native permissions | Usage strings read by iOS from the plist | `Info.plist`: `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription` (V9-06) |
| Web app | Every screen, tile, sheet, nav, dialog and font | `src/app/**`, `src/components/**`, `tailwind.config.ts`, `src/app/globals.css` |

Consequence: HIG guidance about *design* (typography hierarchy, touch targets, safe areas, contrast,
motion, VoiceOver order, sheet dismissal) applies to the web layer and is implemented with CSS and
ARIA, verified in a browser and on a physical iPhone. SDK *APIs* (UIKit/SwiftUI) apply only where a
native view exists — today that is the web view container, the permission prompts and the media-capture
delegate. There are no native cards, tab bars or sheets in this app.

## 2. Rubric × fix inventory

Verification methods: **B** = browser gate (`npm run test:e2e`, production build, iPhone 13 + Pixel 7
projects); **S** = staging web in Safari on the phone; **D** = physical iPhone through the TestFlight
build (attended; never claimed by an unattended run).

| Rubric item | Native or web | Apple source | Affected screens / fixes | Evidence at base | Verify |
|---|---|---|---|---|---|
| Typography hierarchy, custom-font legibility | Web (next/font self-hosted faces) | https://developer.apple.com/design/human-interface-guidelines/typography | All screens (V9-11); bottom-nav labels (V9-10b) | `docs/V9-TYPOGRAPHY-CONTRACT-2026-09-09.md`; `e2e/typography-contract.spec.ts` asserts loaded faces + no synthetic weights (family/weight only, not size); V9-10b labels scale `clamp(9px,2.9vw,11px)` — below Apple's 11 pt tab-label guidance only at 320 px (SE 1st gen, cannot run current iOS), 10.9 px at 375 px (both panel lanes MEDIUM, owner-visible) | B (faces), D (legibility) |
| Larger text / Bold Text (Dynamic Type) | Web — `WKWebView` does NOT apply Dynamic Type to CSS `px` sizes; only Safari's per-site text zoom and the user's `-webkit-text-size-adjust` path scale it | https://developer.apple.com/design/human-interface-guidelines/typography (Dynamic Type section); https://developer.apple.com/documentation/uikit/uifontmetrics | Every screen | `e2e/native-shell-contract.spec.ts:246` and `e2e/a11y-mobile.spec.ts:116` prove routes still fit at 125 % / 200 % root font size; no `rem`-based scale hook exists for the shell; `vw`-sized nav labels ignore text size exactly as the previous `px` sizes did | B (zoom simulation), D (Settings › Accessibility › Larger Text — expect NO change inside the shell; record as a known limit) |
| Touch targets (44 pt) | Web; repo contract is 44 **px** CSS | https://developer.apple.com/design/human-interface-guidelines/accessibility (Buttons and controls, 44×44 pt) ; https://developer.apple.com/design/human-interface-guidelines/buttons | Nav (V9-10b), plan form (V9-02), picker (V9-04), lightbox ✕ (V9-07), camera controls (V9-06) | `e2e/mobile-controls.spec.ts` (`MIN_TAP_PX = 44`, every visible control on five routes, both projects); `a11y-mobile.spec.ts:108`; at 1× CSS px = pt on iPhone so the contract is equivalent on-device | B, D (spot-check with Accessibility Inspector on Mac if available) |
| Safe areas and adaptive layout | Web (`viewportFit: 'cover'` + `env(safe-area-inset-*)`) | https://developer.apple.com/design/human-interface-guidelines/layout ; https://developer.apple.com/documentation/uikit/uiscrollview/contentinsetadjustmentbehavior | Nav (`BottomNav.tsx` `pb-[max(0.5rem,env(safe-area-inset-bottom))]`), map overlays (`map/page.tsx:160,253`), settings headers, lightbox ✕ (V9-07 clears the top inset) | `src/app/layout.tsx:93,99`; `globals.css:109`; `native-shell-contract.spec.ts:608` (nav anchored through overscroll) | B, D (notch + home-indicator devices; landscape) |
| Keyboard reachability | Web; iOS keyboard resizes the web view's visual viewport | https://developer.apple.com/design/human-interface-guidelines/virtual-keyboards | Plan form (V9-02), recipient search (V9-04), profile/settings forms | V9-02 fixed the horizontal overflow; no `interactive-widget` viewport hint and no keyboard-avoidance logic in `NightOutPlanFields.tsx` — primary CTA reachability with the keyboard up is unverified in emulation (Playwright has no iOS keyboard) | D only (open each field, confirm the CTA can be reached by scrolling; note whether the bottom nav overlaps the field) |
| Sheet / navigation close and back | Web (`role="dialog" aria-modal` overlays; Escape + backdrop + ✕) | https://developer.apple.com/design/human-interface-guidelines/sheets ; https://developer.apple.com/design/human-interface-guidelines/modality | Map filter sheet (`map/page.tsx:267`), lightbox (V9-07, `BarLightbox.tsx:202`), quick-add sheet, profile dialog | `native-shell-contract.spec.ts:406,479,642` (focus/scroll restore); V9-07 journeys (✕ restores map pose + focus) | B; D (swipe-to-dismiss is NOT offered — web dialogs do not get the native sheet gesture; acceptable, record as a difference, not a defect) |
| Contrast and non-colour cues | Web (tokens `bg #0a0a0a`, `accent #ff5b3a`, `muted #8a8a85`, `tailwind.config.ts:27-33`) | https://developer.apple.com/design/human-interface-guidelines/color ; https://developer.apple.com/design/human-interface-guidelines/accessibility (Color and effects) | Nav active state (border + tint + `aria-current`), map link (blue underline, V9-07), camera states (V9-06 text, not colour) | Active nav tab uses border + tint + `aria-current="page"`, not colour alone; muted `#8a8a85` on `#0a0a0a` ≈ 5.6:1 (passes 4.5:1); no automated contrast check in the gate | B (add axe/contrast check only if the owner wants it in the gate), D (Increase Contrast setting) |
| VoiceOver labels, order, focus | Web (ARIA) | https://developer.apple.com/design/human-interface-guidelines/accessibility (VoiceOver) | Nav (`role="navigation" aria-label="Primary"`, badge `aria-label`), lightbox (dialog semantics, focus restore — V9-07 fixed WebKit tap-focus), picker (V9-04), camera (`data-camera-reason`, text states) | `a11y-mobile.spec.ts`; `native-shell-contract.spec.ts:430,642`; V9-07 iPhone-13 journey found and fixed the WebKit focus-restore gap | B (DOM order/focus), D (VoiceOver rotor walk of Next Bar?, Map popup → lightbox → ✕, plan form) |
| Reduced motion | Web (`prefers-reduced-motion`) | https://developer.apple.com/design/human-interface-guidelines/motion | Carousel, smooth scroll, lightbox (`BarLightbox.tsx:163`), nav `active:scale-95` | `globals.css:147` disables smooth scroll; `native-shell-contract.spec.ts:510,563` | B (media emulation), D (Settings › Accessibility › Motion › Reduce Motion — WKWebView honours the media query) |
| Corner concentricity | **Web only** — no native container exists to configure | https://developer.apple.com/documentation/uikit/uiview/cornerconfiguration ; https://developer.apple.com/documentation/swiftui/concentricrectangle ; https://developer.apple.com/design/human-interface-guidelines/layout | Tiles/cards (`rounded-2xl` ×130, `rounded-3xl` ×43, `rounded-full` ×189 in `src/`), pill nav, map sheet `rounded-t-*` | Radii come from Tailwind's default scale (1rem / 1.5rem), consistent per component family; nested radii are not derived (inner = outer − padding) anywhere | B (visual), D (screen-edge sheets near the device corner). **No native change**: `UICornerConfiguration` (iOS 26) and `ConcentricRectangle` style native views; the only native view here is the full-screen web view, and applying a corner configuration to it would clip web content, not style the tiles. Do not hard-code device radii in CSS. |
| Permission and recovery UX | Native prompt (plist string) + web recovery copy | https://developer.apple.com/design/human-interface-guidelines/privacy ; https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription ; https://developer.apple.com/documentation/webkit/wkuidelegate | Camera (V9-06): prompt on first capture; denied/busy/no-lens/no-API states; Settings guidance in `src/components/capture/cameraCopy.ts` | Plist key on the branch (needs a NEW binary); `Permissions-Policy: camera=(self)`; `cameraState.test.ts`; guidance text says Settings › Privacy & Security › Camera › Next Bar — on iOS 18 the app-scoped path is Settings › Apps › Next Bar › Camera (Fable MEDIUM r2; both paths reach the toggle, wording nit) | D only (prompt, deny → recovery copy, re-grant) |
| Location permission | Native prompt + web fallback | https://developer.apple.com/design/human-interface-guidelines/privacy | Next Bar? (location-first), Map locate | `NSLocationWhenInUseUsageDescription` present; `LocationAccessHelp.tsx` recovery copy | D |
| App icon / tile icons | Native asset catalog (app icon) vs web SVG/PNG (in-app tiles) | https://developer.apple.com/design/human-interface-guidelines/app-icons | V9-09 brief (separate goal) | `ios/App/App/Assets.xcassets` (app icon), in-app icons in `src/` | Owner decision in V9-09 |

## 3. Per-fix summary (what is native, what is web, what still needs the phone)

| Fix | Native part | Web part | Device step still owed |
|---|---|---|---|
| V9-01 copy / short results | none | copy removal, diagnosis doc | none (copy) |
| V9-02 plan-form overflow | keyboard geometry only | shared form sizing | form with keyboard up, long name, date/time pickers |
| V9-03 plan discoverable | none | Social › Plans listing, reload recovery | kill/reopen app |
| V9-04 recipient picker | none | search + groups, dedupe | VoiceOver through the picker |
| V9-06 camera | `NSCameraUsageDescription`; **own-origin `WKUIDelegate` media grant (see §4)** | capture states, Settings copy, Permissions-Policy | prompt, deny/recover, busy camera — needs the new binary |
| V9-07 map → lightbox | none | link, dialog, ✕ with top safe-area, Escape capture | ✕ under the notch; VoiceOver focus after close |
| V9-10b nav width | none | fluid labels, equal slots | 375 px device legibility of 10.9 px labels |
| V9-11 fonts | none | Playfair/Nunito faces | cold-load on cellular; Larger Text (expect no scaling — known) |

## 4. The one justified minimal native change

**Own-origin media-capture grant** (V9-06, already specified in `docs/V9-06-CAMERA-2026-09-09.md` §2):
subclass `CAPBridgeViewController`, instantiate it in `SceneDelegate.swift`, override `capacitorDidLoad()`
and install a retained forwarding `WKUIDelegate` whose
`webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)` answers `.grant`
only for `type == .camera`, `https`, and the configured server host, `.deny` otherwise. Source:
https://developer.apple.com/documentation/webkit/wkuidelegate ; availability iOS 15.0+, which matches the
deployment target, so no fallback branch is needed. Justification: Capacitor 8.5.0 grants capture to any
origin left in-shell (host-only `allowNavigation`, prefix `serverURL` match); config and headers narrow
it but cannot close it. This is a behaviour fix in the only native surface the app has; it is not a
styling API. It requires a Mac/CI compile and a new internal TestFlight build.

No corner-geometry native change is justified: there is no native container to configure (§2, corner
row). No SwiftUI rewrite, no Dynamic Type bridge (would require a native font-scale → CSS custom
property bridge; out of scope, recorded as a known limit).

## 5. Findings for the owner (from this inventory; none change code in this goal)

1. Nav label size at 375 px is 10.9 px, under Apple's 11 pt tab-label guidance; at 320 px it is 9.3 px.
   Options: raise the clamp floors to 10 px / 11 px and accept a ~4 px overflow risk at 320 only, or keep
   as is (320 px devices cannot run current iOS). Owner call; both panel lanes on V9-10b flagged it.
2. Dynamic Type does not reach the web layer; the app scales only with Safari-style text zoom. Not a
   regression, but worth a line in the App Store review notes if Apple asks (guideline 4.2 concerns).
3. Camera Settings-path wording: iOS 18 shows Settings › Apps › Next Bar › Camera. Fix in the V9-06 fix
   round when it reopens after the native change.
4. Keyboard reachability of the plan form's primary action is unverifiable in emulation; it is item one
   of the physical-device checklist in the follow-up run's `INSTRUCTIONS.md`.
5. Web dialogs do not offer the native sheet swipe-to-dismiss; they offer ✕, Escape and backdrop tap.
   Consistent with HIG for custom modals; document, do not emulate the gesture.

## 6. Verification record for this document

T2 docs-only goal: the stored verification is a file check (size, ≥ 6 Apple URLs, inventory rows).
No product code changed; no browser or device evidence is claimed by this document beyond what the
cited specs already recorded on the branch.
