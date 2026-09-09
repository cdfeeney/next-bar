# Actual renders, 2026-09-09 — what each capture is and which approved reference it answers to

Captured by `e2e/visual-capture.spec.ts` (opt-in: `VISUAL_CAPTURE_DIR`), production build at candidate base `3d29726`
+ foundation A, both Playwright devices, after `document.fonts.ready`. Browser emulation — **not the installed app**.

| Capture (`<screen>--<device>.png`) | Route | Approved reference (`../approved/`) | Note |
|---|---|---|---|
| `next-bar-home` | `/` | `next-bar-five-bars-typography-refinement.png` | the V9-11 typography reference |
| `map` | `/map` | `next-bar-map-v1.png` | |
| `rankings` | `/rankings` | `next-bar-rankings-numeric-lists.png` | |
| `social` | `/friends` | `next-bar-social-v2-core.png` | signed-out state |
| `plan-night-out-form` | `/friends/consensus` | `next-bar-night-out-start-flow.png` | V9-02 overflow surface, at rest (no selectors opened, no keyboard) |
| `settings` | `/settings` | `next-bar-account-a-settings.png` | |
| `nights` | `/nights` | — (no approved reference; operational state) | signed-out, so the empty/sign-in state |

Two sets: the root directory is the base as shipped (every screen loaded **Poppins 400/700 only**); `with-fonts-ee5913e/`
is the same screens with the approved Playfair Display + Nunito Sans pair applied during the §6 probe in
`docs/V9-COVERAGE-AUDIT-2026-09-09.md` (then reverted — no font change is in this candidate).

## Not captured (gaps, stated)

- **Plan details** (`/night-out/<token>`) → `next-bar-night-out-invite-recipient-v1.png`. Needs the member fixtures that
  live in `e2e/night-out.spec.ts`; not wired into the capture spec yet.
- **Photos & hours** (opened `BarLightbox` on a result card) → `next-bar-lightbox-refinement.png`. Needs a result-card
  interaction and a media fixture.
- Camera, Add Story, onboarding, share destinations, Story tags, account tabs, manual pin, operational states: no
  capture; their approved references are listed in `../README.md`.
