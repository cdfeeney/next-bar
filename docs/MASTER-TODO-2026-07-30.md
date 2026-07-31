# Master to-do — Next Bar, 2026-07-30

Single consolidated list. Supersedes the split between
`OVERNIGHT-BRIEF-2026-07-30.md` (engineering) and `UX-BACKLOG-2026-07-30.md`
(product), both of which remain as the detailed backing.

Branch `feat/phase1-compliance-media` · HEAD `c02baf9` · 1,459 unit tests / 96 files · `tsc` clean.
<!-- Snapshot fields, valid ONLY at the SHA named on this line. A bare count with
     no SHA is how this banner reached `b05f42c` / "1,302 unit tests" while the
     branch had moved on. Re-measure rather than guess.
     Source of truth: docs/STATE-2026-07-30-EVENING.md. -->


**Owner key:** 🧑 operator only · 🤖 I can do it · ⚙️ mixed (I build, you decide/approve)

---

## 0. Blockers — nothing downstream moves without these

| # | Item | Owner | Blocks |
|---|---|---|---|
| B1 | **`SUPABASE_SERVICE_ROLE_KEY` is invalid** → account-deletion route is dark | 🧑 | **App Store submission.** Apple has mandated in-app deletion since 2022. Route + e2e already built; needs only the key. |
| B2 | Apple Developer enrolment, $99/yr individual (no D-U-N-S) | 🧑 | the entire submission path |
| B3 | Domain `next-bar.app` → Vercel, Brevo DKIM/SPF, Supabase allowlist | 🧑 | privacy / terms / support URLs |
| B4 | Google Maps browser key + **HTTP-referrer restriction** + **billing budget alert** | 🧑 | all photo work. Referrer restrictions are spoofable, so the budget alert is the actual backstop. |
| B5 | **D1** — media kill-switch transport: Vercel Edge Config vs edge-cached `/api/flags` | 🧑 | runtime media control. `NEXT_PUBLIC_*` is build-time inlined, so today there is no way to disable media without a redeploy. |
| B6 | **Decision:** delete demo items, or hide from Settings and keep for Apple review? | 🧑 | M2. Recommend hide-and-keep — `APP-STORE-PLAN` Q3 needs a seeded reviewer account and the demo seeder is that mechanism. |
| B7 | **Decision:** group chat scope — per-night invite thread vs true persistent realtime chat | 🧑 | N3, N4 |
| B8 | **Decision:** night-out photo storage + retention for geo-tagged photos | 🧑 | F2, F3, and the privacy labels |

---

## 1. Bugs — real defects, users affected

| # | Item | Owner | Size |
|---|---|---|---|
| G1 | **Vibe profile never persists server-side.** Ratings and pairwise both sync on sign-in; the profile has no merged-for flag, no push, and no DB column. Dies on device switch, storage clear, Safari↔PWA, or account switch. | 🤖 | M — schema change, migration authored-not-applied |
| G2 | **7 controls below Apple's 44px minimum** (see §2) | 🤖 | S |
| G3 | **B1 — distance widening does not re-run the pick.** Walkable→Cab→Anywhere must re-run against a wider radius, not re-filter what is already in hand. Verify still broken first. | 🤖 | M |
| G4 | ~~**Playwright full suite hangs indefinitely at teardown.**~~ **DONE (e812cf3)** — fixed by upgrading @playwright/test 1.60.0 → 1.62.0. The recorded claim that it "only reproduces in the multi-project run" is **REFUTED**: it reproduced on single-project runs too. `npm run test:e2e:teardown-guard` is the regression check. | 🤖 | M |
| G5 | iPhone install sheet z-index suspected below `BottomNav` | 🤖 | S — reproduce first |
| G6 | Vacuous subdirectory test in `photoFiles.test.ts` — santa round 3 proved deleting `entry.isFile()` leaves all 17 green | 🤖 | XS |

### G2 detail — every one fails the 44px rule, on all three viewports

| Surface | Control | Actual |
|---|---|---|
| `/settings` | Privacy Policy | **17px tall** |
| `/settings` | Terms of Use | **17px tall** |
| `/settings` | "Tell us if something's wrong." | 33px tall |
| `/map` | "Take the quiz →" | **17px tall** |
| `/map` | `$` price filter | 43px wide |
| `/` | "Try again" | 43px wide |
| `/install` | "Quiz" | 30px wide |

---

## 2. UI / UX — from the operator session

### Map

| # | Item | Owner | Size |
|---|---|---|---|
| M1 | Header becomes **"Tweak the vibe"**; normal filters sit underneath, **collapsed** — clicked into, not always-on rails | 🤖 | M |
| M2 | Remove demo items from the user-facing Settings surface | ⚙️ B6 | S |

M1 also removes the horizontal rails that produced 88 false positives in
`mobile-controls.spec.ts`.

### Home (Next Bar)

| # | Item | Owner | Size |
|---|---|---|---|
| H1 | "Tweak the vibe" **centered at the bottom**, under the 5 phase options | 🤖 | S |
| H2 | Distance options reduced to **Walkable / Worth a cab / Anywhere** only | 🤖 | S |
| H3 | Location/neighborhood moves **inside** Tweak-the-vibe, alongside beer/cocktails/wine | 🤖 | M |

**M1 + H1 + H2 + H3 are one coherent change** to how vibe, distance and location
present across `/` and `/map`. Landing them separately yields three inconsistent
surfaces — Connor's own earlier instruction was not to land these piecemeal.

### Rankings

| # | Item | Owner | Size |
|---|---|---|---|
| R1 | Lists toggle, top-right of `/rankings` | 🤖 | M |
| R2 | "Best Bars" = your ranked bars (default list) | 🤖 | S |
| R3 | "Want to go" becomes a list — fold `list:want-to-go:v1` into the Lists model | 🤖 | S |
| R4 | User can create a list | 🤖 | S |
| R5 | **Checkmark toggle** on the rating flow to pick which list(s) a bar joins | 🤖 | M |
| R6 | Share a list — in-app **and** text/share sheet | 🤖 | M |
| R7 | **Delete the top filter row** (All / Loved / Liked / Pass / Want to go) — crowding the UI | 🤖 | XS |

Lists already partly exist (`next-bar:lists:v1`), so R1–R4 are extend, not build.

### Plan a night out

| # | Item | Owner | Size |
|---|---|---|---|
| N1 | Put the night out **to a vote** | 🤖 | M — `vibe-vote` / `friends/consensus` primitives exist |
| N2 | **Suggest bars** to the group | 🤖 | M — 0009 suggestion tables exist |
| N3 | Invite a group for a given night — a per-night thread | ⚙️ B7 | L |
| N4 | Persistent **group chat** for repeated nights out | ⚙️ B7 | **XL** — realtime, moderation, notifications, abuse surface |
| N5 | Test the **close friends** feature | 🤖 | S — test only |

### Friends / Nights Out

| # | Item | Owner | Size |
|---|---|---|---|
| F1 | Review/see the shared night out from the Friends page | 🤖 | M |
| F2 | **Geo-tag photos** on a night out — saved or taken in-app | ⚙️ B8 | L |
| F3 | Next-day sharing of which bars you went to | 🤖 | M |
| F4 | **Map of where the group went** that night | 🤖 | M |
| F5 | Cached per account — persistent **"Nights Out" view** | 🤖 | L |

**User photos are first-party content.** `mediaPolicy.ts` already ranks `user`
above Google, so F2 *partly solves* the 3,386-legacy-photo liability rather than
adding to it. Counterweight: geo-tagging introduces stored user location data,
which changes the privacy labels (A7) and needs B8 answered first.

### Settings / personas / quiz

| # | Item | Owner | Size |
|---|---|---|---|
| S1 | ~~**Rename "Hood Hopper"**~~ **DONE (f7550db)** — shipped as **"Borough Crawler"**; `id` and `badges.test.ts` updated with it. | 🤖 | XS |
| S2 | Personas friendlier/livelier — "Industry-crowd insider" is verbose. All archetypes in `quiz.ts:160`. | 🤖 | S — copy only |
| S3 | Quiz answer sets should not always be 4 options | 🤖 | M |
| S4 | Quiz questions **more pointed and MECE** — distinct options per question | 🤖 | L — content design + `quiz.coverage.test.ts` rebaseline |
| S5 | `BarMedia` is unmounted — adopt on a real surface or delete | 🤖 | S |

---

## 3. Testing

| # | Item | Owner |
|---|---|---|
| T1 | ~~G4 — the teardown hang. Next: bisect `--project` singly, then `--workers=2` vs default~~ **DONE (e812cf3)** — see the G4 row above. No bisect needed; it was the Playwright 1.60→1.62 upgrade. | 🤖 |
| T2 | mobile-controls still owed: compact-iPhone viewport, landscape, modal/sheet states, failure screenshots | 🤖 |
| T3 | Confirm all 34 e2e specs run on both viewports (CLAUDE.md's own rule) | 🤖 |
| T4 | `CLAUDE.md` is **wrong** about the `/rankings` flake — it says cold-compile race; it was `clearStorage()` aborting the next `goto`. Re-test the `/quiz` claim too rather than trusting it. | 🤖 |
| T5 | No script-level test for the full-run indeterminate path — helper is tested, its use is a source grep. Real coverage needs executing the generator (API key + network). | 🤖 |
| T6 | N5 — close-friends coverage | 🤖 |

---

## 4. Security / compliance

| # | Item | Owner |
|---|---|---|
| C1 | B1 — service-role key → deletion go-live | 🧑 |
| C2 | ~~**Rate-limit audit**~~ **DONE** — `docs/C2-RATE-LIMIT-AUDIT-2026-07-30.md`. The claim that only `account/delete` and `waitlist` are limited was **WRONG**: `api/event` has a 60/minute limiter (`route.ts:30-34`). F1+F3 fixed in `4472f23`, F6+F7 in `f9ac038`, F1b/F5 in `9bd3a29`. | 🤖 |
| C3 | ~~**RLS audit**~~ **DONE** — `docs/C3-RLS-AUDIT-2026-07-30.md`. Not 24 policies: the final schema has **25 across 12 tables**. F3+F5 fixed in `926f498`; F2 became the C4 definer audit (`c02baf9`). | 🤖 |
| C4 | B4 — public API key needs referrer restriction + budget alert | 🧑 |
| C5 | B5 — D1 kill-switch transport | 🧑 |
| C6 | **L3** — Google review text still in git history. `filter-repo` is irreversible and invalidates every clone/PR/CI cache. | 🧑 |
| C7 | Secret-scan before any public push | 🤖 |
| C8 | **3,386 legacy Google photos still served.** The actual liability; closes only when the UI Kit path replaces them (needs B4). | ⚙️ |

---

## 5. App Store

| # | Item | Owner |
|---|---|---|
| A1 | B2 — Apple Developer enrolment | 🧑 |
| A2 | B1/C1 — account deletion live (**mandatory feature**) | 🧑 |
| A3 | B3 — domain live → finalize privacy/terms/support URLs on it | 🧑 |
| A4 | App icon 1024×1024, non-italic vector, **no alpha** | 🧑 |
| A5 | Screenshots — 6.7" (1290×2796) + 5.5" (1242×2208) | 🧑 |
| A6 | Listing copy — name, subtitle (≤30 chars), description, keywords, category (Food & Drink), copyright | 🤖 draft |
| A7 | **App Privacy nutrition labels** — inventory from the codebase: email (auth), display name/handle, bar ratings, RSVPs/suggestions, coarse+fine location (while-using, for matching), no tracking, no ads. **Update if F2 ships.** | 🤖 |
| A8 | Review-notes doc + seeded reviewer account | 🤖 (needs B6) |
| A9 | Capacitor scaffold (`ios/`, remote-origin, push/haptics/share) + Codemagic → TestFlight | ⚙️ |
| A10 | **Physical device pass** — portrait, landscape, Safari toolbar expanded/collapsed, installed standalone, keyboard-open. **Never claimable from here.** | 🧑 |
| A11 | Age rating questionnaire — declare 17+/frequent alcohol | 🧑 |

**Already done, do not redo:** 21+ age gate shipped; `/privacy` and `/terms` have
**no** placeholders left (APP-STORE-PLAN is stale on this); Sign in with Apple is
**not** required — email/password + magic link is exempt.

**Expect one 4.2 conversation with review.** Counter-argument: the native plugin
surface plus listing framing as a "social bar-night planner", not "our website in
an app".

---

## 6. Data quality

| # | Item | Owner |
|---|---|---|
| D1 | `vazacs` and `chelsea-music-hall` ship in the bundle but have **no `bars` row** | 🤖 |
| D2 | 18 parked venues awaiting judgement | 🧑 |
| D3 | 5 witness SUSPECT venues + `the-vault` (in two independent suspect lists) | ⚙️ |
| D4 | 8 pre-existing exact coordinate collisions | ⚙️ |
| D5 | **M2** — `expires_at` on `bar_photos` + deletion job (authored, not applied) | 🤖 |
| D6 | **M1** — ESLint module boundary so importing `barVisual`'s URL builders outside `mediaPolicy.ts` is a build failure | 🤖 |
| D7 | **H4** — retire the remaining `google`/`unverified` hours rows | 🤖 |
| D8 | **L4** — the client still receives all 1,256 venues. The real scale ceiling. | 🤖 L |

---

## 7. Review residue (santa-loop round 3, escalated)

| # | Item |
|---|---|
| V1 | `BACKUP_DIR` not constrained against `PHOTO_DIR`; `copyFileSync` can overwrite an existing backup |
| V2 | Backups unverified (no size/hash check) before deletion |
| V3 | `partitionPhotoFiles`' string branch silently loses subdirectory protection for a future caller |
| V4 | `assertDbIdsUsable` proves neither DB identity nor freshness — a different DB containing `pencil-factory`, or a lagging replica, passes |
| V5 | Dead code: `locationAcceptable` / `insideServiceArea` exported and tested, never called |
| V6 | Future index swaps should use `CREATE INDEX CONCURRENTLY` + rename (0029 took `ACCESS EXCLUSIVE` on a live table — brief, but not the pattern) |

None can delete anything today; all concern a future invocation.

---

## 8. Costs

### Known recurring

| Item | Cost |
|---|---|
| Apple Developer Program | **$99/yr** |
| Domain `next-bar.app` | ~$15–40/yr |
| Places UI Kit Query (Essentials) | **$1.00/1,000**, first 10,000/month free |
| Coordinates + hours | **$0** — OpenStreetMap, no quota, no 30-day clock |

### Photo cost — the only thing that scales

~5 widgets/session, lazy-mounted and kept mounted:

| Daily actives | Requests/mo | Cost/mo |
|---|---|---|
| 100 | 15,000 | ~$5 |
| 1,000 | 150,000 | ~$140 |
| 10,000 | 1.5M | ~$1,490 |
| 100,000 | 15M | ~$14,990 |

Free tier ≈ first **65 daily actives**. **Requests-per-session is the whole
ballgame** — 20/session instead of 5 multiplies every figure by 4. Trimming card
content saves nothing; one request bills the same regardless of what it returns.

### Still to establish

| # | Item |
|---|---|
| $1 | Supabase tier — free limits vs Pro $25/mo |
| $2 | Vercel tier — edge invocations (the share OG card is an edge module) |
| $3 | **Whether the Place Details hours refresh can be dropped entirely** — hours come from OSM now, so the Enterprise-tier refresh may be pure waste |
| $4 | Bandwidth from D8 (whole catalog per session) |
| $5 | Supabase Storage for night-out photos, once F2 is scoped |

---

## 9. Recommended order

**Now — Tier 1, overnight-safe, no operator, no prod write, no API spend**

1. **G1** vibe-profile persistence (worst bug: users lose data)
2. ~~**S1** Hood Hopper rename~~ — **DONE (f7550db)**, shipped as "Borough Crawler"
3. **R7** delete the rankings filter row
4. **G2** the 7 tap targets
5. **G6** the vacuous subdirectory test
6. **S2** persona copy rewrite
7. **N5/T6** close-friends coverage
8. **A7** privacy-label inventory from the codebase
9. ~~**G4/T1** the Playwright teardown hang~~ **DONE (e812cf3)**
10. **C2 + C3** rate-limit and RLS audit matrices

**Next — Tier 2, one coherent change**

11. **M1 + H1 + H2 + H3** the vibe/distance/location re-layout
12. **R1–R6** Lists

**Then — Tier 3, multi-session**

13. **N1 + N2** vote and suggest
14. **F1 + F4 + F5** Nights Out view + map of the night
15. **F2 + F3** photos + geo-tagging (gate on B8)
16. **N3 + N4** group chat (gate on B7) — largest item on the list
17. **S3 + S4** quiz redesign
18. **D5–D8**, then **V1–V6**

### Hard rules while working

- `LOOP_UNATTENDED=1` every tick; PowerShell does not persist env between them.
- No `--apply`, `db:migrate`, production write, push, PR, branch switch, photo
  deletion, or contacting venues without explicit approval.
- Never run `next build` while the dev server is live — shared `.next`.
- **Never gate on the full Playwright suite. Focused runs only. STATUS: ACTIVE.**
  G4 itself is fixed (`e812cf3`), so the *original* reason is gone — but this rule
  stands for a different one: `npm run test:e2e:teardown-guard` is not wired into any
  lane, so nothing forces the regression to be detected. Do not read the
  `DONE (e812cf3)` annotations elsewhere in this file as retiring it.
  **Agents MUST NOT self-assess the retirement conditions; only a human may retire
  this rule.** Conditions are listed in `OVERNIGHT-BRIEF-2026-07-30.md`.
- Fix layout defects; never weaken an assertion to reach green.
- Do not claim operator-only or physical-device criteria complete.
