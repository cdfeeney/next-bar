# Overnight brief — 2026-07-30

Branch `feat/phase1-compliance-media` · HEAD `87b05b0` · 1,302 unit tests, `tsc` clean.

Two constraints shape what "overnight" can mean, both learned the hard way:

- **`/loop-start` does not schedule anything.** It writes a runbook and returns.
  Real recurrence needs `/loop`; otherwise overnight is one continuous session
  that must never yield. See [[background-wait-is-not-a-loop-tick]].
- **The full Playwright suite hangs indefinitely at teardown** (worker force-kill,
  8h observed). Focused per-spec runs exit correctly and are the only safe gate.
  Never let a tick wait on the full suite until item T1 is fixed.

---

## A. UI

| # | Item | Overnight? | Notes |
|---|---|---|---|
| U1 | **7 tap targets below Apple's 44px minimum** | ✅ | Live and failing. Also an App Store + a11y item. |
| U2 | mobile-controls still owed: compact-iPhone viewport, landscape, modal/sheet states | ✅ | Spec repaired, coverage incomplete |
| U3 | iPhone install sheet z-index suspected below `BottomNav` | ✅ | Unconfirmed — reproduce first |
| U4 | `BarMedia` is still unmounted — adopt on a real surface or delete it | ✅ | Dead component |
| U5 | B1 — distance widening must RE-RUN the pick against a wider radius, not re-filter | ✅ | Operator-confirmed behaviour; verify still open |
| U6 | B2–B4 vibe-tweak re-layout (banner pinned, entry moves, neighborhood inside, Run-again as an action) | ⚠️ | Design-coupled; land as one piece, not piecemeal |

**U1 in detail — every one fails the 44px rule:**

| Surface | Control | Actual |
|---|---|---|
| `/settings` | Privacy Policy | **17px tall** |
| `/settings` | Terms of Use | **17px tall** |
| `/settings` | "Tell us if something's wrong." | 33px tall |
| `/map` | "Take the quiz →" | **17px tall** |
| `/map` | `$` price filter | 43px wide |
| `/` | "Try again" | 43px wide |
| `/install` | "Quiz" | 30px wide |

Consistent across iPhone 13, iPhone 17 and Pixel 7, so they are genuine layout
defects rather than viewport artifacts.

---

## B. Testing

| # | Item | Overnight? | Notes |
|---|---|---|---|
| T1 | **Playwright full-suite teardown hang** | ✅ | Highest-value. 3 hypotheses already refuted: not WebKit-wide, not failure-payload size, not spec-specific. **RESOLVED (e812cf3)** by upgrading @playwright/test 1.60.0 → 1.62.0. The "only reproduces in the multi-project run" claim recorded here is **REFUTED** — it reproduced on single-project runs as well. Regression check: `npm run test:e2e:teardown-guard`. |
| T2 | Vacuous subdirectory test in `photoFiles.test.ts` | ✅ | santa round 3 PROVED it: deleting `entry.isFile()` leaves all 17 tests green. Needs a fixture named `ghost-bar.webp` that is a directory. |
| T3 | 5 witness SUSPECT venues + `the-vault` | ✅ | `the-vault` appears in two independent suspect lists |
| T4 | No script-level test for the full-run indeterminate path | ⚠️ | Helper is tested; its use is a source grep. Real coverage needs executing the generator (API key + network). |
| T5 | `CLAUDE.md` is wrong about the `/rankings` flake | ✅ | It says cold-compile race; it was `clearStorage()` aborting the next `goto`. The `/quiz` note may be equally wrong. |
| T6 | Confirm every one of 34 e2e specs runs on both viewports | ✅ | Per CLAUDE.md's own rule |

---

## C. Security

| # | Item | Overnight? | Severity |
|---|---|---|---|
| S1 | **`SUPABASE_SERVICE_ROLE_KEY` invalid → account-deletion route is DARK** | ❌ operator | **App Store blocker.** Mandatory since 2022. Route + e2e already built. |
| S2 | Rate limiting exists only on `account/delete` and `waitlist` | ✅ | Audit every API route; CLAUDE-adjacent rule says all endpoints |
| S3 | RLS audit — 24 policies exist; confirm every table with user data has them | ✅ | Read-only audit |
| S4 | Google Maps browser key will be **public in the client bundle** | ❌ operator | Needs HTTP-referrer restriction **and** a billing budget alert. The referrer restriction is spoofable, so the budget alert is the real backstop. |
| S5 | D1 — media kill-switch transport (Edge Config vs edge-cached `/api/flags`) | ❌ operator | No runtime way to disable media today; `NEXT_PUBLIC_*` is build-time inlined |
| S6 | L3 — Google review text still in **git history** | ❌ operator | `filter-repo` is irreversible and invalidates every clone/PR/CI cache. Own maintenance window. |
| S7 | Secret-scan the repo before any public push | ✅ | |

---

## D. Pre-App-Store

Ordered by dependency, not effort.

| # | Item | Owner | Blocks |
|---|---|---|---|
| P1 | Apple Developer enrolment, $99/yr individual (no D-U-N-S) | Operator | everything |
| P2 | Service-role key re-copy → account deletion go-live | Operator | submission (mandatory feature) |
| P3 | Domain `next-bar.app` live → Vercel + Brevo DKIM/SPF + Supabase allowlist | Operator | privacy/terms/support URLs |
| P4 | **App Privacy "nutrition labels"** — inventory from the codebase | ✅ overnight | questionnaire |
| P5 | Listing copy — name, subtitle (≤30 chars), description, keywords, category (Food & Drink), copyright | ✅ draftable | submission |
| P6 | Review-notes doc + seeded review account | ✅ overnight | review |
| P7 | App icon 1024×1024, non-italic vector, **no alpha** | Operator/design | submission |
| P8 | Screenshots — 6.7" (1290×2796) + 5.5" (1242×2208) | Operator | submission |
| P9 | Capacitor scaffold (`ios/`, remote-origin, push/haptics/share) + Codemagic → TestFlight | ⚠️ partly | device testing |
| P10 | Physical Safari/PWA/TestFlight pass: portrait, landscape, toolbar expanded/collapsed, standalone, keyboard-open | Operator | **never claimable from here** |
| P11 | Age rating questionnaire — declare 17+/frequent alcohol | Operator | submission |

**Already done, do not redo:** 21+ age gate shipped; `/privacy` and `/terms` no
longer contain placeholders (the app-store plan is stale on this); Sign in with
Apple is **not** required (email/password + magic link is exempt).

**Expect one 4.2 conversation with review.** The counter-argument is the native
plugin surface plus listing framing as a "social bar-night planner", not "our
website in an app".

---

## E. Financial

### Recurring, known

| Item | Cost |
|---|---|
| Apple Developer Program | **$99/yr** |
| Domain `next-bar.app` | ~$15–40/yr |
| Places UI Kit Query (Essentials) | **$1.00/1,000**, first 10,000/month free |
| Places Photo (legacy API — not used) | $7.00/1,000 |
| Coordinates + hours | **$0** — now OpenStreetMap, no quota, no 30-day clock |

### Photo cost model (the dominant variable)

At ~5 photo widgets per session, lazy-mounted and kept mounted:

| Daily actives | Requests/mo | Cost/mo |
|---|---|---|
| 100 | 15,000 | ~$5 |
| 500 | 75,000 | ~$65 |
| 1,000 | 150,000 | ~$140 |
| 10,000 | 1.5M | ~$1,490 |
| 100,000 | 15M | ~$14,990 |

Free tier covers roughly the first **65 daily actives**. Two things matter more
than the rate:

- **Requests per session is the whole ballgame.** At 20/session instead of 5 —
  what uncontrolled remounting gives you — every figure ×4.
- **Trimming card content saves nothing.** One request bills the same regardless
  of what it returns. Only *fewer requests* helps.

### Cost items still to establish

- **Supabase tier** — 1,256-venue catalog, auth, RLS. Free tier limits vs Pro $25/mo.
- **Vercel tier** — edge function invocations; the share OG card is an edge module.
- **Place Details for hours may now be droppable entirely** — hours come from OSM,
  so the ~$few/mo Enterprise-tier refresh may be pure waste. Worth checking
  before budgeting for it.
- **L4 — the client still receives all 1,256 venues.** Bandwidth per session, and
  the real ceiling at scale. Phase 2.

---

## F. The overnight queue — ordered, one item per tick

Everything here is doable with **no operator, no production write, no API spend**.

1. **T1 — the Playwright teardown hang.** Highest leverage: it is what makes an
   automated gate untrustworthy. Bisect by project, then by worker count.
2. **U1 — the 7 tap targets.** Pure layout, immediately verifiable, and clears an
   App Store/a11y class in one pass. Fix the layout, never the assertion.
3. **T2 — the vacuous subdirectory test.** One fixture. Then re-prove by mutation.
4. **P4 — App Privacy nutrition-label inventory**, generated from the codebase:
   email (auth), display name/handle, bar ratings, RSVPs/suggestions,
   coarse+fine location (while-using, for matching), no tracking, no ads.
5. **U2 — remaining mobile-controls coverage:** compact iPhone, landscape,
   modal/sheet states. Screenshots on failure.
6. **S2 + S3 — rate-limit and RLS audits.** Read-only; produce a per-route and
   per-table matrix.
7. **P5 + P6 — draft listing copy and the review-notes doc** with a seeded
   account script (authored, not applied).
8. **U4 — `BarMedia`: adopt or delete.** Do not leave it unmounted a third night.
9. **T5 — correct `CLAUDE.md`'s flake note**, and re-test the `/quiz` claim rather
   than trusting it.
10. **M1 — ESLint module boundary** so importing `barVisual`'s URL builders
    outside `mediaPolicy.ts` is a build failure.
11. **M2 — `expires_at` on `bar_photos` + deletion job.** Authored, NOT applied.
12. **U5 — B1 distance widening** must re-run the pick. Verify it is still broken
    before fixing.

### Hard rules for the night

- `LOOP_UNATTENDED=1` on every tick — PowerShell does not persist env between them.
- No `--apply`, no `db:migrate`, no production write, no push, no PR, no branch
  switch, no photo deletion, no contacting venues.
- Never run `next build` while the dev server is live; they share `.next`.
- **Never gate a tick on the full Playwright suite** until T1 lands.
- Focused behavioural verification before claiming any surface works. A green
  unit suite is not evidence a surface renders.
- Fix layout defects; never weaken an assertion to get green.
- Do not claim operator-only or physical-device criteria complete.

---

## G. Carried forward, unresolved

- 28→0 orphan photo files done; **3,386 legacy Google photos remain** and are the
  actual liability. Closes only when the UI Kit path replaces them (needs P-items).
- `vazacs` and `chelsea-music-hall` ship in the bundle but have no `bars` row.
- 18 parked venues + 8 pre-existing exact coordinate collisions.
- santa round 3 residue: `BACKUP_DIR` unconstrained vs `PHOTO_DIR`; backups
  unverified; `partitionPhotoFiles`' string branch; `assertDbIdsUsable` proves
  neither DB identity nor freshness; dead `locationAcceptable`/`insideServiceArea`.
- `CREATE INDEX CONCURRENTLY` + rename is the correct pattern for a future index
  swap (0029 took `ACCESS EXCLUSIVE` on a live table — brief, but not the pattern).
