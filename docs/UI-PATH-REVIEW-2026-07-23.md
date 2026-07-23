# UI Path Review — 2026-07-23 (evening)

Click-path audit of every route, from four parallel read-only agent traces (core funnel · personal data · social · auth/shell). Companion: `CAPABILITIES-REVIEW-2026-07-23.md`. Overnight fixes queued in `NIGHTLOG-2026-07-24.md`.

## Route map (traces verified against source + e2e specs)

| Route | Entry points | Core path | Exit / notes |
|---|---|---|---|
| `/` | direct, BottomNav, `/where-next` 302, quiz Skip | WhereNextFlow state machine: locating → autoResults \| pickBar → (freeTextSeed) → confirmGps → pickRadius → (tweakVibe) → results | Hero/HowItWorks live on `/install`, not `/`. **`/` never links to `/quiz`** |
| `/quiz` | `/install` Hero, `/settings` only | 5 questions + neighborhoods → saveProfile → locate → results (top 10 + map) | InstallNudge dismissible |
| `/map` | BottomNav | Use-my-location → marker; loved/liked highlights | map never pans to the user's marker |
| `/rankings` | BottomNav, consensus, settings | filter pills, sorted ratings; empty state → seed sample night | only link to `/lists` lives here |
| `/tried` | — | pure redirect → `/rankings` | fine |
| `/lists` | `/rankings` header link only | create → ListCard accordion → BarPicker multi-add → remove/delete | not in BottomNav |
| `/settings` | BottomNav | account (sign in/out, SetPassword), stats, badges, taste card, install, vibe profile, demo seed, clear ratings | only sign-out in the app |
| `/friends` | BottomNav | Tonight 3-chip intent + reciprocity gate → circle FriendCards → find-friends search | demo-seeded follows (maya, jordan) |
| `/friends/consensus` | `/friends`, `/u/*` | PersonChips → consensus lists → vote → ResultScreen → share | deterministic demo votes |
| `/share/[barId]` | share button, OG unfurl | server card + CTA → `/` | unknown id = real 404 |
| `/u/[handle]` | FriendCards | profile + follow toggle + full list | unknown handle = soft-404 (HTTP 200) |
| `/auth` | settings card only | email+pw sign-in/up, forgot-password | callback validates redirect same-origin ✓ |
| `/install`, `/join` | header link / AppStoreCta | install instructions / waitlist form | iOS-Chrome etc. render no install UI |

**No CRITICAL dead ends** — every route has a forward path; BottomNav renders everywhere except /install, /join, /auth, /share, /api.

**Key insight — signing in today is a net downgrade.** Visible changes: two text strings (settings email, rankings footer) + cross-device rating sync. Costs: pairwise ranking prompts disabled, 0–10 scores dropped by server sync, clear-all-ratings breaks, demo data can permanently pollute the account. D1 work must flip this before pushing anyone to sign up.

## Findings (merged, deduped, ranked)

### HIGH
1. **Signed-in rating taps don't propagate** — `useRatings.ts:28,65-78,137-148`: `SERVER_BROADCAST` declared but never dispatched/listened; storage handler bails in server mode. ResultsView exclusions, map highlights, badges all stale until reload.
2. **"Clear all ratings" no-ops for signed-in users** — `settings/page.tsx:50-60` clears localStorage only; server ratings re-fetch after reload. Confirm dialog says "cannot be undone", then nothing happens. (Found independently by two agents.)
3. **Sign-in silently disables pairwise + drops scores** — `usePairwise.ts:81-86,98-99`; `ratings.server.ts:22-24,84-89` omit `score`. Signed-in users can never get the 0–10 scores /rankings promises.
4. **Demo sample night merges into real account on sign-in** — `useRatings.ts:108-111` uploads seeded ratings to Supabase as genuine; `clearSampleNight` is localStorage-only → unremovable server-side, skews taste/badges forever.
5. **Auth-callback errors are invisible** — `auth/callback/route.ts:28-39` redirects to `/auth?error=…` but `auth/page.tsx` never reads searchParams. Expired one-shot confirm/reset links land on a blank sign-in form (classic stuck-user path).
6. **Intent chip un-clearable after 5am rollover** — `useIntent.ts:37-45` + `intent.ts:94`: stale lit chip; tap-to-clear reads expired-null and *re-arms* a fresh intent instead.
7. **Demo people are indistinguishable from real ones** — no "demo" labeling; static intents mean "Maya is going out" *every* night (`demo/intents.ts:11`); copy claims "Only your circle sees this" while nothing leaves localStorage.
8. **Delete list = one tap, no confirm** — `lists/page.tsx:93,211-218`, adjacent to "+ Add a bar". Ratings/profile clears confirm; lists don't.
9. **One pairwise answer corrupts seeded scores tier-wide and breaks "Remove sample night"** — `pairwise.ts:205` re-idealizes all same-tier bars; changed scores defeat `seed.ts:96-100`'s keep-if-different check.
10. **GpsConfirm lacks a requesting state** — `GpsConfirm.tsx:53-66` + `WhereNextFlow.tsx:82-86`: while a fix is in flight it shows "We can't confirm where you are — Continue", or auto-proceeds immediately after render.

### MEDIUM
11. Quiz map highlights ≠ listed cards — `quiz/page.tsx:97-106` recomputes matches without pass-exclusions/lovedTags.
12. autoResults hard-filters to quiz `preferredNeighborhoods` while labeled "Using your location" — `WhereNextFlow.tsx:198-211`, `matching.ts:113-116`.
13. No service-area check — precise fix anywhere on Earth auto-suggests NYC bars with 3,000-mile travel copy (`useGeolocation.ts:35-41`).
14. Signed-out "Pass" tap instantly removes card + reorders list under the finger; no undo on that surface (`ResultsView.tsx:49-55`).
15. Map "Use my location" plots a marker but never pans/zooms to it (`map/page.tsx:76-82`, `BarMap.tsx:111-113`).
16. Cancelling native share still hijacks clipboard + claims "Link copied ✓" (`GroupVote.tsx:214-227`).
17. Share recipient dead end — CTA goes to marketing homepage, not the bar (`share/[barId]/page.tsx:55-60`).
18. Fabricated votes shown as genuine — no-rating friend auto-votes `candidates[0]`, chip says "Jordan voted" (`groupVote.ts:156`).
19. Consensus "Tonight's pick" persists while /friends re-locks after clearing intent; GroupVote keyed only on participant ids → stale sessions (`consensus/page.tsx:166`).
20. Consensus selection set frozen after first toggle — later follows/ratings never join (`consensus/page.tsx:31-37`).
21. Built-in email sender (~2–4/hr) backs signup + reset; second signup in an hour silently never gets its email. *(Mitigated once Brevo SMTP lands.)*
22. SetPassword updates password with no re-auth — hijacked session → permanent takeover (`SetPassword.tsx:49`, documented tradeoff).
23. `/api/waitlist`: no email validation, no rate limit, leaks raw Supabase error text (`route.ts:31`).
24. "Clear all ratings" leaves `next-bar:pairwise:v1`; stale comparisons re-apply to fresh ratings (`settings/page.tsx:53-57`).
25. List count vs dangling barIds — "3 bars" showing 2; dangling ids unremovable (`lists/page.tsx:134,146-147`).
26. Nav gaps: `/lists` reachable only via one Rankings link; `/auth` only via Settings; `/` never prompts the quiz (LOW-14 funnel gap).

### LOW (batch)
Cross-tier rank inversion for unscored bars (`pairwise.ts:230-233`); localStorage corruption = silent total wipe (ratings/lists/pairwise loaders); filter pills on empty rankings; same-tab-only pairwise broadcast; friends search denies existing friends ("No one matching maya"); `/u/[unknown]` HTTP 200 soft-404; false "following each other unlocks" copy; cadence banner mount-only (wrong across midnight); `/join` success terminal (no onward CTA) + generic error; LocationPrompt `granted_snapped` dead UI; FreeTextSeed dead validation copy; quiz neighborhood options ignored (8 defined, 12 shown); results map plots only seed bar; "widen your radius" copy on radius-less surfaces; settings contradictory copy ("lives only on this device" vs sync; "unlocks Friends + Rankings" — it doesn't); install card buttonless on non-installable browsers; manifest icon reused for 192/512, no maskable.

### Test-coverage gaps flagged
No e2e covers: callback-error path, clear-ratings-while-authed, HIGH-1 server-mode staleness, HIGH-10 GpsConfirm race. Unit-thin: `quiz.ts`, `saved.ts`, `storedProfile.ts`.
