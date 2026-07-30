# UX/feature backlog — operator session 2026-07-30

Parsed from Connor's verbal dump. **Read the "my reading" column and correct
anything wrong before work starts** — 25 items misread is a wasted night.

Evidence gathered before planning; three of Connor's claims needed correcting and
are marked ⚠️.

---

## 1. Map filters

| # | Ask | My reading | File |
|---|---|---|---|
| M1 | Filters structure is wrong | Header becomes **"Tweak the vibe"**; the normal filters sit *underneath* it and are **collapsed by default** — you click into them rather than seeing always-on rails | `src/app/map/page.tsx` |
| M2 | Get rid of demo items "if we don't need them" | ⚠️ **CONFLICT** — see §7 | `src/lib/demo/seed.ts`, `src/app/settings/page.tsx` |

The horizontal filter rails are also what generated 88 false positives in
`mobile-controls.spec.ts`. Collapsing them behind a click removes that surface.

---

## 2. Rankings

| # | Ask | My reading |
|---|---|---|
| R1 | Lists toggle, top right | A control top-right of `/rankings` switching between lists |
| R2 | "Best Bars" = your ranked bars | The default list is your ranking |
| R3 | "Want to go" becomes a list | Fold the existing `next-bar:list:want-to-go:v1` into the same Lists model |
| R4 | User can add a list | Create-list affordance |
| R5 | Choosing a list when rating | **Checkmark toggle** on the rating flow — a bar can go to multiple lists |
| R6 | Share a list | In-app **and** text (SMS/share sheet) |
| R7 | Remove the top filter buttons | Delete `All / Loved / Liked / Pass / Want to go` — crowding the UI. `src/app/rankings/page.tsx:21-26` |

Connor mid-message: *"Oh wait I see a you lists thats good"* — Lists already
partly exist (`next-bar:lists:v1`). So R1–R4 are likely **extend**, not build.
Confirm what's already shipped before writing anything.

---

## 3. Next Bar (home)

| # | Ask | My reading |
|---|---|---|
| H1 | "Tweak the vibe" moves | **Centered at the bottom**, underneath the 5 phase options |
| H2 | Distance options only | Just **Walkable / Worth a cab / Anywhere** — nothing else at that level |
| H3 | Location moves | Neighborhood/location becomes an option **inside** Tweak-the-vibe, alongside beer/cocktails/wine |

H1+H3 are the B2–B4 "vibe-tweak re-layout" already in the backlog. Connor's
earlier instruction stands: **design together, do not land piecemeal.**

---

## 4. Plan a night out

| # | Ask | Size |
|---|---|---|
| N1 | Put the night out **to a vote** | Medium — voting primitives may exist (`vibe-vote.spec.ts`, `friends/consensus`) |
| N2 | **Suggest bars** to the group | Medium — `suggestions` tables exist (0009) |
| N3 | Invite a group for a given night → effectively a per-night group chat | **Large** |
| N4 | Persistent **group chat** for repeated nights out | **Large** — realtime infra, moderation, notifications |
| N5 | Test the **close friends** feature | Small — test-only |

---

## 5. Friends / Nights Out  ← the biggest new surface

| # | Ask |
|---|---|
| F1 | Review/see the shared night out from the Friends page |
| F2 | **Geo-tag photos** on a night out — saved or taken in-app |
| F3 | Next day, share photos of which bars you went to |
| F4 | **Map of where the group went** that night |
| F5 | Cached per account — a persistent **"Nights Out" view** |

Two observations that matter more than the feature itself:

- **User photos are FIRST-PARTY content.** This is the compliant media source the
  whole Phase-1 photo migration has been waiting for. `mediaPolicy.ts` already
  models `user` as a source ranked above Google. F2 partially solves the 3,386
  legacy-photo liability rather than adding to it.
- **Geo-tagging adds a new class of stored user location data.** That changes the
  App Store privacy nutrition labels (P4) and needs a retention answer. Do not
  ship F2 without deciding retention.

---

## 6. Settings / personas / quiz

| # | Ask | Status |
|---|---|---|
| S1 | Rename the **"Hood Hopper"** award — racially loaded | Confirmed at `src/lib/badges.ts:123`: `badge('hood-hopper', 'Hood Hopper', 'Hit 3 neighborhoods', …)`. Suggested: **"Borough Crawler"**, "Neighborhood Hopper", or "Three-Hood Night". Also update the `id` and `badges.test.ts:50,67`. |
| S2 | Personas friendlier and livelier; "Industry Crowd Insider" is verbose | Confirmed at `src/lib/quiz.ts:160`: `'Industry-crowd insider'`. All archetype strings live in `quiz.ts` — one file. |
| S3 | ⚠️ "After the quiz the vibe quiz doesn't save" | **DIAGNOSED — and it is not the save call.** See below. |

### S3 root cause: the vibe profile has no server side at all

`saveProfile(p)` fires unconditionally on quiz completion (`quiz/page.tsx:55`) and
`loadProfile()` is consumed by `settings/page.tsx:61`,
`WhereNextFlow.tsx:100` and `useSuggestions.ts:114`. Locally it works.

What is missing is **persistence beyond the browser**:

| Data | Local key | Syncs to server on sign-in? |
|---|---|---|
| Ratings | `next-bar:ratings:v1` | ✅ `ratings:merged-for:v1` |
| Pairwise | `next-bar:pairwise:v1` | ✅ `pairwise:merged-for:v1` |
| **Vibe profile** | `next-bar:profile:v1` | ❌ **nothing** |

There is no `profile:merged-for` flag, no push to Supabase, and **no vibe/archetype
column anywhere in `supabase/migrations/`** (the only match is the unrelated
`vibe_votes` table in 0017).

So the quiz result is localStorage-only. It disappears when you sign in on another
device, clear browser data, or move between Safari and the installed PWA — and
`accountCache.ts` clears local caches when the merged-for flag names a different
user, so account switching can wipe it too. From the user's side that is exactly
"my quiz didn't save."

**Fix shape:** a `profiles` column (or small table) for tags + archetype +
preferred neighborhoods, a push on save when signed in, and a merge-on-sign-in
path mirroring what ratings already do. This is a schema change, so the migration
is authored-not-applied.

**Worth noting the trap:** taking "doesn't save" at face value leads straight to
`saveProfile`, which is fine, and to reporting "works as designed" — while the
user keeps losing their profile.
| S4 | Dislikes always-4 options; not comprehensive | Quiz answer sets are fixed-width |
| S5 | Quiz needs to be **more pointed and MECE** — distinct options that stand out per question | Content rewrite of `src/lib/quiz.ts`, plus `quiz.coverage.test.ts` will need rebaselining |

---

## 7. ⚠️ Conflict: deleting the demo items

Connor: *"get rid of the demo items if we dont need them."*

But `docs/APP-STORE-PLAN.md` open question Q3 asks for **a seeded test account for
Apple review**, and the demo seeder (`src/lib/demo/seed.ts`) is the existing
mechanism for exactly that. Deleting it removes the reviewer-onboarding path we
have not built a replacement for.

**Recommendation:** keep the seeding *capability*, remove it from the **user-facing
Settings surface**. That satisfies "not in my way" without deleting the thing
Apple review will need. Needs Connor's yes.

---

## 8. Proposed order

**Tier 1 — bug and low-risk wins (overnight-safe)**

1. **S3** — reproduce the quiz-save failure, then fix. A user losing their quiz
   result is the worst item on this list; everything else is polish or addition.
2. **S1** — rename Hood Hopper. Trivial, and it should not ship as-is.
3. **R7** — delete the rankings filter buttons. Pure removal.
4. **U1 (from the overnight brief)** — the 7 sub-44px tap targets, which include
   `/settings` Privacy/Terms at 17px.
5. **N5** — close-friends test coverage.
6. **S2** — persona rewrite (copy only, one file).

**Tier 2 — needs design agreement, land as one piece**

7. **M1 + H1 + H2 + H3** — the filter/vibe re-layout. These are one coherent
   change to how vibe/distance/location are presented across `/` and `/map`.
   Landing them separately produces three inconsistent surfaces.
8. **R1–R6** — Lists: extend what exists, add create + multi-select on rating +
   share.

**Tier 3 — multi-session features, not overnight**

9. **N1 + N2** — vote and suggest (primitives partly exist).
10. **F1 + F4 + F5** — Nights Out view + map of the night.
11. **F2 + F3** — photo capture and geo-tagging. **Gate on a retention decision**
    and a privacy-label update.
12. **N3 + N4** — group chat. Realtime, moderation, notifications, abuse surface.
    This is the largest item in the list by a wide margin.

**Tier 4 — quiz redesign**

13. **S4 + S5** — variable-length, MECE answer sets. Content design plus a test
    rebaseline; worth doing deliberately rather than overnight.

---

## 9. Questions that change the work

1. **Demo items** — delete outright, or hide from Settings and keep for Apple
   review? (Recommend: hide, keep.)
2. **Group chat scope** — a lightweight per-night invite thread, or true
   persistent group chat with realtime? These are very different builds.
3. **Night-out photos** — store in Supabase Storage under the user's account?
   And how long are geo-tagged photos retained?
