# Mobile-shell attended device checklist — 2026-08-05 (goal g-b07c73bc)

Companion to `e2e/mobile-shell-pack.spec.ts`. The operator reported three
shell items against TestFlight build 5 (`docs/MORNING-HANDOFF-2026-08-05.md`):
a background issue, an oversized top/safe-area region, and wonky scrolling on
the Next Bar surface. The spec pins the **web layer's** contribution on
iPhone 13 / Pixel 7 / iPhone 17 viewports; everything below is what a browser
**cannot** prove and must be checked on physical hardware, attended.

**Nothing in the Playwright pack is physical-device proof. This checklist is
the only closure path for the native halves.**

## Blocking precondition — the build must serve this branch

TestFlight build 5 wraps `next-bar-two.vercel.app`, which is **Production**
(`6ec5e5d`). Production contains **none** of this branch's shell-relevant
work (SignInGate login-on-open, search-bar autohide, deferred catalog swap,
Cancel/BottomNav safe-area ownership). Running this checklist against build 5
re-tests the old code and proves nothing about the fixes — that is the exact
per-binary-environment defect the g-39169b3b ADR's architecture C exists to
close. **Do not start the checklist until a build points at a surface serving
this branch** (Staging binary per ADR-C, or a post-release build).

Also note: build 5 writes to **Production data**. Any sign-in, rating, or
share made during device testing on it lands in the live database.

## Web-proven vs device-only

| Reported item | Proven in the browser pack | Device-only remainder |
|---|---|---|
| Login-on-open | Gate renders for installed-PWA and Capacitor signal sets; never in plain browser; backdrop dismiss; one dialog after resume cycles (`signin-gate.spec.ts`, `mobile-shell-pack.spec.ts`) | Gate appears on a real cold open of the shell; Apple sign-in completes and returns into the shell |
| Oversized top region | Web layer contributes zero top padding: header at y=0, `viewport-fit=cover` intact | How the shell resolves the real status-bar inset (`black-translucent` + WKWebView); whether a black/blank band renders above the header |
| Background issue | A `visibilitychange` hidden→visible cycle keeps route, scroll positions, and input alive; overlays stay single | Real suspension: WKWebView process termination and cold resume, memory purge, iOS snapshot restore |
| Wonky scrolling | Autohide reveal/hide, tap pass-through at rest, no horizontal overflow, resume keeps positions (`search-autohide.spec.ts`, `a11y-mobile.spec.ts`, `mobile-controls.spec.ts`) | Momentum/rubber-band feel, scroll-jank under real touch, keyboard-driven viewport resize |

## Checklist (attended, physical device)

Record per row: device + iOS version + build number + PASS/FAIL + note.

1. **Cold open, signed out** — force-quit, reopen. The "Sign in to Next Bar"
   window appears over `/`. Backdrop tap dismisses; it does not trap.
2. **Cold open, signed in** — no gate; the Where-next surface is immediately
   interactive.
3. **Top region at rest** — on `/`: the status bar area shows app background
   (not a detached black band); the "Next Bar" header sits directly under the
   status bar; total chrome above the first content is visually comparable to
   Safari on the same device. Screenshot both for the record.
4. **Top region after rotation** — rotate to landscape and back; the top
   inset does not accumulate (the double-inset class of defect).
5. **Short background** — scroll mid-list, switch to another app ~10s,
   return. Same screen, same scroll position, no reload flash, exactly one
   overlay at most.
6. **Long background** — repeat with ≥5 minutes away (allow WKWebView
   suspension). A cold reload is acceptable iOS behavior; landing anywhere
   other than a fresh `/` (or losing signed-in state) is a FAIL.
7. **Scroll feel on `/`** — flick-scroll the list: momentum is smooth, no
   stutter; rubber-band at both ends settles back; the search bar hides on
   scroll-down and reveals on a gentle scroll-up (matching the web spec's
   behavior, now under real touch).
8. **Keyboard interaction** — focus the search input: the keyboard does not
   cover it; dismissing the keyboard restores the layout without a stuck
   bottom gap.
9. **Repeated resume overlay check** — background/resume 3× in a minute:
   still at most one sign-in dialog, one age gate, no stacked overlays.

## Disposition

Every FAIL becomes its own goal with the device row attached as evidence; do
not fold fixes into this regression pack. The pack's browser specs stay the
regression net for whatever web-layer share of the defect exists.
