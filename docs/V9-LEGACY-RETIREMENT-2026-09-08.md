# V9 legacy retirement audit — 2026-09-08

**Base candidate:** `6e8fab1c2a1c5543312c7e746e5973c359936edf` (branch
`harness/nb-overnight-20260907/v9-audit`, clean tree at audit time).
**Release contract:** V8 3.1.1, ledger SHA-256
`f040b8e32bff833cc7c55d46e5e7a300146a129aaf096c61e9d25cc9685eb976`.
**Method:** `product-roadmap-review`, product-audit mode; skill recorded on the goal
as `08d555d15ef241e4e344a02949bb2db8eeb3a71fd512e7a0479f29e85b6b286d`.

**This document specifies. It does not implement.** No product code was edited to
produce it. Every slice below still has to be admitted, implemented and verified
under `D:/harness-handoffs/nextbar-overnight-20260907/POST-REFACTOR-ACCEPTANCE.md`.

Companion document: `docs/V9-OVERLOOKED-WORK-2026-09-08.md`.

---

## 1. Confidence ceiling — what this audit can and cannot establish

| Can establish | Cannot establish |
|---|---|
| Which modules have no non-test importer anywhere in `src/`, `scripts/`, `e2e/` | Whether a live database row or an external caller depends on a retired shape |
| Byte and file counts of tracked repository artifacts | Vercel upload size, cold-start time, or any runtime performance number |
| That a documented founder decision already authorises a retirement | Whether the founder still wants a capability that is merely *deferred* |
| That a requirement's implementation file exists and is wired to a route | Whether that implementation fully satisfies the requirement's behaviour |

Two corrections were made mid-audit and are recorded because they are exactly the
error this method exists to catch:

- A first import scan flagged `src/lib/venueTags.ts` and `src/lib/tagPatch.ts` as
  test-only. **Both are live.** Their callers are `.mts` scripts —
  `scripts/backfill-venue-tags.mts:45`, `scripts/import-bars.mts:23`,
  `scripts/seed-bars-table.mts:16`, `scripts/review-mining-apply.mts:20` — which the
  first pass did not walk. Every claim below was re-verified with `git grep` across
  all tracked extensions.
- `src/lib/liveDbTarget.ts` and `src/lib/authenticatedE2eConfig.ts` have only test
  importers **by design**. They are test infrastructure, not dead code.

Deprecated naming was never treated as proof. Every "unreferenced" claim below is a
zero-non-test-importer result, not a comment that says "legacy".

---

## 2. Evidence register

| # | Source | What it establishes | Strength |
|---|---|---|---|
| E1 | `git ls-files public/bar-photos` → 3435 files; `du -sh public/bar-photos` → 203M | The retired photo cache is tracked, not merely present | fact |
| E2 | `src/middleware.ts:14` returns 404 for `/bar-photos/*`; matcher at line 54 | Those 3,435 files are unreachable by design | fact |
| E3 | No `.vercelignore` in the repository root; `vercel.json` carries only a cron entry | Nothing excludes `public/` from the deploy upload | fact |
| E4 | `ls -l src/lib/bars.places.ts` → 598,290 bytes; its only importer is `src/lib/bars.ts:11` | A 584 KB generated sidecar hangs off one module | fact |
| E5 | `src/lib/bars.ts` has no importer under `src/`; callers are `scripts/apply-migrations.ts:316` (dynamic) and `e2e/helpers/catalogTest.ts:2` | The static merged catalog is no longer the app's catalog | fact |
| E6 | `src/lib/catalog.ts` is the accessor (8 route/component importers); `src/components/CatalogRefresh.tsx` replaces its contents from Supabase after hydration | `catalog.ts` superseded `bars.ts` at runtime | fact |
| E7 | `src/hooks/usePairwise.ts` and `src/components/PairwiseSheet.tsx` have zero non-test importers, and neither appears in any `dynamic(() => import(...))` call | The pairwise UI is unwired | fact |
| E8 | `src/hooks/useRatings.ts:68-71` — "The pairwise UI was deliberately unwired in the U2 batch (rank-on-rankings replaced it)" | The unwiring was intentional and reviewed | fact |
| E9 | `src/lib/tasteProfile.ts` weights `LOVED_WEIGHT`/`LIKED_WEIGHT` and has zero non-test importers; `src/lib/tasteAffinity.ts` carries the approved numeric model and has three live importers | The tier taste model was replaced, not removed | fact |
| E10 | `src/app/settings/security/_deleteRequest.ts` header: it exists because `src/lib/accountDeletion.ts` "collapses every non-success onto `false`", and `src/lib` was outside that lane's write scope | A superseded, hazardous helper survives beside its replacement | fact |
| E11 | `src/app/u/[handle]/night/[shareId]/page.tsx:27` — "Deleting the file itself is left to the attended integration gate"; the same sentence in `src/components/ShareNightButton.tsx:21-23` | Removal is already founder-authorised, only deferred | fact |
| E12 | `node scripts/check-release-contract.mjs docs/V8-TRACEABILITY-LEDGER.json` → exit 0; coverage tally `{partial:67, complete:12, contradicted:16, stale:1, missing:54}` | The contract passes its own admission checks on this candidate | fact |

The first pass used a throwaway import-graph walker (kept in the job scratch
directory, never in the repository) that resolved `@/`-aliased and relative
specifiers across `src/**`. Its output was then re-verified file by file with
`git grep` over every tracked extension, which is what caught the `.mts` misses.

---

## 3. Findings

### A. Retired Google photo cache — 203 MB, 3,435 tracked files (measured)

`public/bar-photos/` holds 3,435 tracked `.webp` files totalling 203 MB.
`src/middleware.ts:14` answers every request under `/bar-photos/` with a bare 404,
and `src/components/GooglePlacePhoto.tsx:17` describes itself as "the replacement
for `public/bar-photos/` — 3,435 photo files". The directory is dead-served and
dead-read: nothing under `src/` resolves a URL into it.

What still references it, and whether each reference is load-bearing:

| Reference | Kind | Disposition |
|---|---|---|
| `src/middleware.ts:14,54` | live 404 guard for old bookmarks | **keep** — deleting the files does not delete the bookmarks |
| `scripts/refresh-places.mjs:86,308` and `scripts/photos-to-webp.mjs:23` | ingest tooling that writes the directory | retire or gate alongside it, or the next `--photos` run recreates all of it |
| `e2e/photo-card.spec.ts:18` | asserts `/bar-photos/attaboy.webp` is 404 | **keep** — this is the regression test for the guard |
| `src/types/index.ts:111` comment on `photoRef` | stale doc string pointing at the retired path | correct in the same slice |

The cost this actually imposes is repository weight: every clone, every worktree and
every deploy upload carries 203 MB that no user can fetch. **No runtime or bundle
number is claimed** — these files were never in a JS bundle.

### B. The static merged catalog is orphaned — a 584 KB sidecar behind an unused module (suspected)

`src/lib/bars.ts` (78 lines) merges the curated core, six expansion files and the
generated Places sidecar `src/lib/bars.places.ts` (**598,290 bytes**). At runtime the
app no longer reads it. `src/lib/catalog.ts` is the single accessor — imported by
`src/app/friends/page.tsx:23`, `src/app/friends/_components/FeedSection.tsx:8`,
`src/app/friends/_components/TonightPresence.tsx:6`,
`src/app/night-out/[token]/InvitePreview.tsx:11`,
`src/app/night-out/[token]/page.tsx:8`, `src/app/rankings/page.tsx:9`,
`src/app/u/[handle]/page.tsx:12` and `src/components/CatalogRefresh.tsx:5` — it seeds
from `bars.core.ts` alone, and `CatalogRefresh` replaces it from the Supabase `bars`
table after hydration.

`bars.ts`'s two surviving callers are `scripts/apply-migrations.ts:316` (a dynamic
import on the seeding path) and `e2e/helpers/catalogTest.ts:2`. `bars.places.ts`'s
only caller is `bars.ts`.

**This is suspected waste, not proven waste, and must not be deleted casually.** Two
real dependencies sit on it:

- `scripts/check-client-catalog-bundle.mjs` reads `src/lib/bars.places.ts` directly
  and fails if any of its `googlePlaceId` markers appear in `.next/static/chunks`.
  It is the guard that keeps the sidecar out of the client bundle; deleting the
  sidecar deletes the guard's oracle.
- `scripts/apply-migrations.ts` uses `bars.ts` to seed the `bars` table. If the
  database is the source of truth, that path is still the bootstrap story for a
  fresh project.

The bounded move is therefore *not* "delete the catalog". It is to settle, with the
founder, whether the static catalog is still the seed of record — and to give the
bundle guard a new oracle before anything is removed.

### C. Legacy tier-era ranking cluster — 1,009 unwired lines (measured, low risk)

The V8 model is one numeric score, 1.0–10.0 (`CLAUDE.md`; `V8-R-RNK-001`). The tier
era left three unreferenced modules behind:

| Path | Lines | Non-test importers |
|---|---|---|
| `src/hooks/usePairwise.ts` | 462 | 0 — four comment mentions only |
| `src/lib/insertFlow.ts` | 354 | 1 — `usePairwise.ts:27`, i.e. only the unwired hook |
| `src/components/PairwiseSheet.tsx` | 193 | 0 — one comment in `src/components/story/StoryViewer.tsx:50` |

`src/hooks/useRatings.ts:68-71` records the intent and, importantly, the migration
consequence: the U2 batch unwired the pairwise UI, "which orphaned usePairwise's
one-time V7 transcript import — it never ran in production… The import lives HERE
now, on the sign-in path that actually executes." **V7 continuity does not depend on
the hook**, which is what makes this cluster safe to retire.

Three siblings **stay live** and must not be swept up:

- `src/lib/pairwise.ts` — `sortRatingsByScore` and `tierMidpoint` feed
  `src/app/rankings/page.tsx:7`; `buildRankOrderForTier` feeds
  `scripts/measure-replay-consistency.mts:7`.
- `src/lib/pairwise.local.ts` — `src/hooks/useRatings.ts:32`, `pairwise.server.ts:3`.
- `src/lib/pairwise.server.ts` — `src/app/settings/security/page.tsx:12`,
  `src/hooks/useRatings.ts:33`.

Separately, `src/lib/tasteProfile.ts` (76 lines) is the tier-weighted taste model
(`LOVED_WEIGHT = 2`, `LIKED_WEIGHT = 1`) and has zero non-test importers. Its
approved replacement `src/lib/tasteAffinity.ts` is live in
`src/components/ResultsView.tsx:13`, `src/hooks/useSuggestions.ts:6` and
`src/lib/matching.ts:13`. Two taste models exist; the unreachable one also
contradicts the approved rule that a low score is negative evidence rather than an
exclusion, because it drops Pass-rated bars entirely.

### D. Superseded account-deletion helper — 22 lines, safety-relevant (measured)

`src/lib/accountDeletion.ts` returns `false` on any non-success, a lost response
included. `src/app/settings/security/_deleteRequest.ts` exists precisely because
that is wrong, and says so: "the route deletes the auth user and only then writes
its reply, so a connection dropped in between leaves a destroyed account and a
browser telling its owner the account survived." The replacement classifies the
outcome as `deleted | refused | unknown`.

The old helper has zero non-test importers. It survived only because `src/lib` sat
outside the writing lane's scope. It is a loaded footgun: the next person who needs
"delete this account" will find the shorter, plainer-looking one first.

### E. Small orphans (measured, trivial)

| Path | Lines | Evidence | Note |
|---|---|---|---|
| `src/lib/saved.ts` (+ `src/types/saved.ts`) | 85 | zero importers anywhere, tests included | `src/lib/accountCache.ts:489` still wipes `next-bar:saved:v1` — **keep that entry**, it is legitimate device compatibility |
| `src/components/ResultsHoodChips.tsx` | 63 | zero references outside itself | last touched 2026-07-27 (`492d3fe`) |
| `src/lib/goingList.ts` | 23 | test-only importer | `formatGoingList` has no product caller |

### F. Retired-but-present shared-night surface — removal already authorised (279 lines)

`src/app/u/[handle]/night/[shareId]/page.tsx` calls `notFound()` and does nothing
else. Its header records a founder decision, a server-side enforcement — migration
`0068` drops `public.get_shared_night(uuid)`, `share_night` and `unshare_night`,
closing a live **anon** `EXECUTE` grant — and an explicit deferral: "Deleting the
file itself is left to the attended integration gate."
`src/components/ShareNightButton.tsx` renders nothing and repeats the same
deferral. The cluster:

| Path | Lines | Blast radius |
|---|---|---|
| `src/app/u/[handle]/night/[shareId]/page.tsx` | 32 | none — the route already 404s |
| `src/app/u/[handle]/night/[shareId]/opengraph-image.tsx` | 110 | none |
| `src/components/ShareNightButton.tsx` | 30 | `src/components/RecapCard.tsx:8,70` must drop the import and the JSX |
| `src/lib/nights.server.ts` | 107 | `src/lib/demo/nights.ts:1` imports the `SharedNight` **type** only |

### G. Built but never wired — a decision, not a retirement

These are **not** deletion candidates. They are approved or planned capability that
exists in the repository and is unreachable from the running app. Confusing them
with dead code is how approved work gets deleted.

| Path | Size | Status |
|---|---|---|
| `src/components/composer/` — `GlobalComposer.tsx` (577) plus `ComposeStep.tsx` (274), `DestinationsStep.tsx` (442), `SharedReceipt.tsx` (189), `StoryAudienceSheet.tsx` (235), `types.ts` (524) | 2,241 product lines | `V8-R-CMP-001`…`V8-R-CMP-016` are **approved**. Zero non-test importers, no dynamic import, and the string "Share a moment" appears nowhere outside the directory. |
| `src/lib/push.ts` | 141 lines | Ships dark by design — `isPushEnabled()` needs two env flags that are unset everywhere. Its only importer is `src/app/settings/_signOut.ts:3`, the cleanup path. Nothing ever subscribes. |
| `src/lib/badges.ts` | 154 lines | Badges are an explicit **V9 deferral** (`D-C-24`, founder, 2026-08-23). Pre-built, unreferenced, awaiting a V9 product decision. |

### H. Intentional compatibility references — keep

- `src/middleware.ts:14` `/bar-photos/` 404 guard, and `e2e/photo-card.spec.ts:18`
  which tests it.
- `src/lib/accountCache.ts:489` wiping `next-bar:saved:v1` on sign-in.
- The V7 transcript import and journal-era reconciliation markers in
  `src/hooks/useRatings.ts` — these execute on the sign-in path and are load-bearing
  for upgrading devices.
- `src/lib/liveDbTarget.ts` and `src/lib/authenticatedE2eConfig.ts` — test-only by
  design.
- `src/app/opengraph-image.tsx`, `src/app/icon.tsx`, `src/app/apple-icon.tsx` —
  Next.js file conventions; no importer is expected.

---

## 4. Ranked slices

Ordered by evidence strength and user-visible safety against blast radius. Each is
one commit, one verification command, no behaviour change.

| # | Slice | Paths | Preserved behaviour | Dependencies | Blast radius | Verification |
|---|---|---|---|---|---|---|
| **S1** | Delete the superseded account-deletion helper | `src/lib/accountDeletion.ts`, `src/lib/accountDeletion.test.ts` | The danger-zone flow is untouched; `_deleteRequest.ts` stays the only client of `/api/account/delete` | none — zero non-test importers | 2 files | `npm run typecheck` then `CI=1 npx vitest run src/app/settings` |
| **S2** | Remove the authorised shared-night remnant | delete `src/app/u/[handle]/night/[shareId]/` (2 files), `src/components/ShareNightButton.tsx`, `src/lib/nights.server.ts` and their tests; edit `src/components/RecapCard.tsx` to drop the import and JSX; relocate or delete the `SharedNight` type used by `src/lib/demo/nights.ts:1` | `/u/[handle]/night/[shareId]` still returns 404 (the route no longer exists); Saved Nights Out and `/night-out/[token]` untouched | migration `0068` is already applied | 6 files plus 1 edit | `npm run typecheck` then `CI=1 npx vitest run` then `npx playwright test e2e/recap-home.spec.ts e2e/app-shell-smoke.spec.ts` |
| **S3** | Retire the unwired pairwise UI cluster | `src/hooks/usePairwise.ts`, `src/hooks/usePairwise.test.ts`, `src/components/PairwiseSheet.tsx`, `src/components/PairwiseSheet.test.ts`, `src/lib/insertFlow.ts` and its tests | `/rankings` numeric entry; `pairwise.ts`, `pairwise.local.ts`, `pairwise.server.ts`; the V7 transcript import in `useRatings.ts`; comparison deletion in `settings/security` | `insertFlow.ts` dies only because `usePairwise.ts` does — re-confirm it has no other caller at implementation time | 1,009 product lines plus tests | `npm run typecheck` then `CI=1 npx vitest run` then `npx playwright test e2e/rankings-score.spec.ts e2e/pairwise-flow.spec.ts e2e/v7-continuity.spec.ts` |
| **S4** | Retire the tier-weighted taste model | `src/lib/tasteProfile.ts`, `src/lib/tasteProfile.test.ts` | `tasteAffinity.ts` is and remains the only taste model | **do not** follow it into `src/lib/quiz.ts` — `deriveArchetype` has six live callers including `WhereNextFlow.tsx` and `VibeQuiz.tsx` | 2 files | `npm run typecheck` then `CI=1 npx vitest run src/lib` |
| **S5** | Delete the small orphans | `src/lib/saved.ts`, `src/types/saved.ts`, `src/lib/goingList.ts`, `src/components/ResultsHoodChips.tsx` and their tests | `accountCache.ts:489` keeps wiping the legacy key | none | ~7 files, 171 product lines | `npm run typecheck` then `CI=1 npx vitest run` |
| **S6** | Untrack the retired photo cache | `public/bar-photos/` (3,435 files) plus `.gitignore`; retire or gate `scripts/photos-to-webp.mjs` and the `--photos` path of `scripts/refresh-places.mjs`; correct the `src/types/index.ts:111` comment | `/bar-photos/*` still 404s via middleware; `e2e/photo-card.spec.ts:18` still passes | **founder decision required** — 203 MB of Google-sourced imagery; confirm there is no archival need before it leaves the working tree | 3,438 files | `npm run typecheck`, `npx playwright test e2e/photo-card.spec.ts`, and `git ls-files public/bar-photos` returning nothing |
| **S7** | Sever the UI from the static merged catalog | `src/lib/bars.ts`, `src/lib/bars.places.ts`, `src/lib/bars.expansion*.ts`, `scripts/check-client-catalog-bundle.mjs`, `scripts/apply-migrations.ts`, `e2e/helpers/catalogTest.ts` | The Supabase-backed catalog and the slim edge card are unchanged | **blocked on a founder decision** (is the static catalog still the seed of record?) and on giving the bundle guard a new oracle first | large | `npm run build`, `npm run check:catalog-bundle`, `npm run test:e2e` |

**Deliberately not proposed:**

- Consolidating `src/lib/catalog.ts` with `src/lib/catalog.slim.ts`. The split is not
  duplication for its own sake — `src/lib/catalog.slim.ts:11-25` records that the
  2026-07-24 expansion pushed the share card's merged import to 1.03 MB against the
  edge runtime's 1 MB limit and blocked all deploys.
- Anything under `src/components/WhereNextFlow.tsx`, `src/components/ResultsView.tsx`,
  `src/components/ResultCard.tsx`, `src/lib/matching.ts`, `src/lib/routeSearch.ts`,
  `src/lib/resultsRefresh.ts`, `src/lib/travelTime.ts`. The concurrent
  `v8-recommendations` lane owns those files for `V8-R-NXT-008` and `V8-R-NXT-009`.
  Two write-capable lanes on one file is how both changes get lost.

## 5. Recommended first three slices

**S1, S2 and S3, in that order, as three separate commits.**

Each rests on zero-importer proof rather than judgement; each is authorised by an
existing founder decision or by a code comment written by the very lane that
deferred the removal; and none touches a file the V8 recommendations lane is
writing. Together they retire 1,310 lines of unreachable product code and one real
safety hazard (S1), and none of them needs a new product decision.

S6 and S7 are the two largest wins by volume and both are **founder-gated** — S6 on
whether 203 MB of imagery may leave the working tree, S7 on whether the static
catalog is still the seed of record. Neither should be started from this audit alone.

## 6. Measured versus suspected waste

| Measured | Number | How |
|---|---|---|
| Tracked retired photo files | 3,435 files / 203 MB | `git ls-files … \| wc -l`, `du -sh` |
| Generated Places sidecar | 598,290 bytes | `ls -l src/lib/bars.places.ts` |
| Unwired pairwise cluster | 1,009 product lines | `wc -l` on the three files |
| Shared-night remnant | 279 product lines | `wc -l` on the four files |
| Zero-importer small orphans | 171 product lines | `wc -l` |
| Built-but-unwired composer | 2,241 product lines | `wc -l` on the six files |

| Suspected — deliberately not quantified | Why |
|---|---|
| Deploy upload size recovered by S6 | The absence of a `.vercelignore` is a fact; the upload size is not, and this audit ran no deploy |
| Any runtime, cold-start or bundle improvement | None of the retired code is reachable from an App Router entry, so **no client-bundle saving is claimed at all** |
| CI minutes recovered | Not measured |

## 7. Observed defects (reported, not fixed)

1. **`src/lib/accountDeletion.ts` misreports a lost delete response as "nothing was
   removed."** Unreferenced today; a hazard the moment someone imports it. → S1.
2. **The approved global composer is unreachable.** `src/components/composer/`
   implements `V8-R-CMP-001`…`016` and is mounted nowhere. See
   `docs/V9-OVERLOOKED-WORK-2026-09-08.md`, item 2.
3. **`scripts/check-client-catalog-bundle.mjs` is run by nothing.** It exists as
   `npm run check:catalog-bundle`, is referenced only by `package.json:20`, and does
   not appear in `.github/workflows/ci.yml`. The guard against a 584 KB bundle
   regression is not armed.
4. **The release contract's `coverage` field has drifted from the code.**
   `V8-R-STO-014` and `V8-R-STO-015` are recorded as unimplemented while
   `src/lib/media/reEncode.ts` (wired at `src/app/api/media/upload/route.ts:209`) and
   `src/lib/media/signedUrl.ts` implement them. See
   `docs/V9-OVERLOOKED-WORK-2026-09-08.md`, item 1.
5. **`src/lib/matching.test.ts:489` still cites `LAST_VERIFIED_HARD_FILTER_DAYS = 180`**
   while `src/lib/constants.ts:30` says `365`. A stale comment, not a behaviour bug.

No product code was modified by this audit.
