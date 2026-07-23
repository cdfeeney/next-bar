# Next Bar — Viral/Social Blueprint & North Star (2026-07-23)

> Definitive plan derived from viral-comp research (BeReal, Beli, Partiful, Strava, Letterboxd, Untappd) + nightlife-app failure analysis. This is the north star the overnight loop executes against. Code-able steps run unattended; account/key-gated steps are ESCALATED (never faked).

## North Star
**"The app your friend group opens to decide where to go tonight — and the log of where you've been."**
Win at *small scale* first: a single dense friend group (or one NYC neighborhood/campus) must feel alive with 10–50 people, not a million. Value = (1) a great solo suggestion, (2) a group that converges on one bar in 60 seconds, (3) a taste identity you return to refine.

## Where we already are (assets)
- Solo utility: vibe quiz, 269 geocoded bars, **location-first suggest** (just shipped), map, open-now scaffolding.
- Beli half already built: ratings (Loved/Liked/Pass), **pairwise comparison scoring**, /rankings, taste archetype.
- Social shell: /friends (demo), /friends/consensus (placeholder), auth scaffolding (Supabase, v0.5), PWA installable.

## The gap (what the research says to build)
Both research pulls rank the **group decision loop** as the #1 unlock, then live intent, taste profile, shareable lists (K-factor), badges. Next Bar has the single-player + Beli-ranking half; it is missing the **multiplayer coordination + identity + invite** half.

## Failure modes to avoid (from dead nightlife apps)
- Cold-start/density death → seed ONE dense group, not a city. Small-network value first.
- Over-broadcasting location/status → intent is opt-in, friends-only, never public-by-default.
- Daily streaks feel fake for nightlife → cadence is **weekly (Thu–Sat)**, not daily.
- Generic popularity ≠ right vibe → keep recs personal/vibe-driven, never "most popular."
- Notifications: event-triggered + local only ("your group hasn't decided"), never promo spam.

---

## Phased Blueprint (each step: disjoint, test-gated, keep build green)

Legend: 🟢 code-able unattended · 🟡 code-able but real value needs an escalated dependency · 🔴 escalate (needs account/key/decision).

### Phase A0 — Brand refresh (operator-supplied 2026-07-23, run FIRST)
- **A0 🟢 Poppins font swap.** Brand kit: font = **Poppins** (Google Fonts), weights Bold 700 (wordmark/headlines/accent words), Medium 500 (secondary headlines), Regular 400 (subtitles/captions, slight letter-spacing on small labels). Colors UNCHANGED — tailwind.config.ts already matches the kit (bg #0a0a0a, accent/coral #ff5b3a, text #f5f5f0, muted #8a8a85). Implementation: `next/font/google` Poppins (subsets latin, weights 400/500/700, `display: 'swap'`, CSS variable) in `src/app/layout.tsx`; point BOTH `fontFamily.display` and `fontFamily.sans` in tailwind.config.ts at the variable (display keeps bold weight via existing `font-display` usage — verify headlines render 700, add `font-bold` to `.font-display` contexts only if weight looks wrong in build output; simplest correct: display = ['var(--font-poppins)','sans-serif'] and rely on existing sizing). next/font self-hosts at build time — no runtime network calls, PWA-safe. Verify: build green + e2e smoke (app-shell) still passes; visual = headings no longer serif.

### Phase A — Identity & retention (safe quick wins, pure client from existing ratings)
- **A1 🟢 Taste Profile page/section.** Derive from ratings + visited bars: dive vs cocktail vs wine ratio, neighborhood heatmap, archetype, counts. Letterboxd/Beli "taste identity." New `src/lib/tasteProfile.ts` (pure, unit-tested) + a profile surface (extend /settings or new `/you`). Tests: lib unit + e2e render.
- **A2 🟢 Explorer score + Badges.** Compute from ratings/visits: neighborhood-completion, variety (5 speakeasies, 5 rooftops), streak-of-weekends. `src/lib/badges.ts` (pure, unit-tested) + badge shelf on profile. Untappd/Strava mechanic.
- **A3 🟢 Lists ("Top 10 date bars", "Rooftops").** User-curated named lists over the catalog, stored locally (mirror ratings persistence pattern). `src/lib/lists.ts` + UI to create/add/view. Letterboxd core.

### Phase B — The multiplayer unlock (#1 leverage)
- **B1 🟢 Group consensus flow (local/demo first).** Turn `/friends/consensus` placeholder into a real loop: pick candidate bars (from your/among-friends top lists) → vote → converge to a single pick with a result screen. Pure client + demo friends now; wire to real data in D. Partiful/"where do we go tonight." Tests: reducer unit + e2e happy path.
- **B2 🟢 Live intent signals.** Per outing: "going / maybe / here now" toggles, friends-only. Local/demo state now. Converts discovery → coordination.
- **B3 🟡 Shareable pick/list cards (K-factor).** OG-image route (like existing `opengraph-image.tsx`) that renders a "Tonight's pick" or "My Top 10" card → shareable link → recipient needs app to save. Code-able now; real invite tracking needs D.

### Phase C — Cadence (retention trigger)
- **C1 🟡 "Tonight" surface + weekly cadence UI.** A Thu–Sat "Time for your Next Bar" surface with the reciprocity idea (see friends' picks after you pick). Build the surface + logic 🟢; the actual **web-push/notification wiring is 🔴 escalate** (VAPID keys / APNs).

### Phase D — Real network (escalate the config, build the code)
- **D1 🔴 Real auth + social graph.** Supabase auth exists in code but needs dashboard config (redirect URLs already noted in memory) → escalate. Then replace demo friends with real follows, sync ratings/lists/consensus to Supabase. Code-able against the schema; **going live needs the operator's Supabase config**.
- **D2 🔴 Push notifications** (VAPID/web-push, later APNs for App Store) — escalate keys.
- **D3 🔴 Open-now / venue truth** (Google Places key) — escalate (already scoped in project memory).

### Phase E — App Store + monetization (later, mostly escalate)
- App-Store hardening (privacy/terms, account-deletion UI, 17+ gate, a11y, /api/health) — from the earlier roadmap. Monetization (labeled promoted listings, sponsored venue updates, ticketing/affiliate) only AFTER engagement exists.

---

## Overnight loop plan (unattended, while operator sleeps)
**Order (safest-first, highest-leverage-early):** A0-brand → A1 → A2 → B1 → A3 → B2 → B3 → C1(UI only). (A1 landed `dff0d32`.)
**Per tick:** implement ONE step → `npm test && npx tsc --noEmit && npm run build` (+ e2e on interactive steps) → commit locally. **Rules:** keep build green every tick; ESCALATE-don't-fake anything 🔴/🟡-blocked; ONE worktree; **NEVER push**; do NOT run `npm run build` while a dev server holds `.next` (documented footgun); pure-client + localStorage only (no external calls).
**Escalation queue for the morning:** Supabase auth config (redirect URLs), web-push VAPID keys, Google Places key, Apple Developer enrollment — all needed to turn 🟡/🔴 steps fully live.

## Top-5 mechanics to copy (from research, mapped to steps)
1. Group decision loop (Partiful) → **B1**.
2. Pairwise → personal leaderboard (Beli) → **already built**; surface it in Taste Profile A1.
3. Check-in feed + friend/neighborhood leaderboards (Strava/Untappd) → **A2** + later D1 feed.
4. Taste profile + shareable lists (Letterboxd) → **A1 + A3 + B3**.
5. Nightly prompt + reciprocity gate (BeReal), weekly cadence → **C1** (UI now, push escalated).
