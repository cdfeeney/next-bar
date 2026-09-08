# V9 legacy retirement — implemented 2026-09-08

**Goal:** `g-422a2f37-385b-4cf5-98da-0f387cc09a05` (T1, re-classified on the
actual changed paths — see §7).
**Worktree:** `D:/harness-worktrees/nb-overnight-20260907/v9-audit`, branch
`harness/nb-overnight-20260907/v9-audit`.
**Base:** `c6ef6319d40de403b992f6e47025b3de912d25a3` (clean tree at start).
**Specification:** `docs/V9-LEGACY-RETIREMENT-2026-09-08.md`, slices S1, S3, S4, S5.

**Deliberately NOT implemented:** S2 (shared-night remnant), S6 (retired photo
cache), S7 (static merged catalog). S2 is excluded by this goal's criterion 5:
the lead found that `opengraph-image.tsx` intentionally returns a neutral brand
card for links already in circulation, so the audit's blanket "deleting it has
no behaviour change" claim was too broad. S6 and S7 stay founder-gated.

This document records implementation. It is the deletion's evidence, not a new
product decision — every file removed here was already authorised by the audit
and by this goal's stored write scope.

---

## 1. What was deleted — 15 files, 2,553 tracked lines

| Slice | Path | Lines | Kind |
|---|---|---|---|
| S1 | `src/lib/accountDeletion.ts` | 22 | product |
| S1 | `src/lib/accountDeletion.test.ts` | 44 | test |
| S3 | `src/hooks/usePairwise.ts` | 461 | product |
| S3 | `src/hooks/usePairwise.test.ts` | 361 | test |
| S3 | `src/components/PairwiseSheet.tsx` | 192 | product |
| S3 | `src/components/PairwiseSheet.test.ts` | 161 | test |
| S3 | `src/lib/insertFlow.ts` | 354 | product |
| S3 | `src/lib/insertFlow.test.ts` | 555 | test |
| S4 | `src/lib/tasteProfile.ts` | 76 | product |
| S4 | `src/lib/tasteProfile.test.ts` | 116 | test |
| S5 | `src/lib/saved.ts` | 85 | product |
| S5 | `src/types/saved.ts` | 4 | product |
| S5 | `src/lib/goingList.ts` | 23 | product |
| S5 | `src/lib/goingList.test.ts` | 36 | test |
| S5 | `src/components/ResultsHoodChips.tsx` | 63 | product |

**One further tracked edit, and only one:** a single line removed from
`src/lib/storageInventory.test.ts`. See §6 — it is a live guard test that the
deletion itself told us to update, and the guard's own failure message named the
edit.

No replacement module, no abstraction and no compatibility shim was introduced.
This is deletion, per the Ponytail skill recorded on the goal (`ponytail`
4.9.0): delete verified dead code, do not replace it.

### Repository-maintenance savings (measured: `git ls-files` + `wc -l`)

| Measure | Before | After | Delta |
|---|---|---|---|
| Tracked files under `src/` | 445 | 430 | −15 |
| Tracked lines under `src/` | 99,402 | 96,849 | −2,553 |
| Tracked non-test files under `src/` | 272 | 263 | −9 |
| Tracked non-test lines under `src/` | 54,841 | 53,561 | −1,280 |

**No runtime, bundle, cold-start or deploy-size improvement is claimed.** None of
the removed modules was reachable from an App Router entry, so none of it was in
a client bundle to begin with. The saving is repository weight only.

---

## 2. Caller reconfirmation — before deletion

Method: `git grep` across **every tracked file** — all extensions, `.mts`
scripts and `e2e/` included, which is the miss the audit recorded against
itself — searching two independent things: the module path *and* every exported
symbol by word boundary. Plus a dedicated scan for `import(...)` dynamic
specifiers naming any candidate.

**Module-path references outside the candidate files — 8 hits, every one a prose
comment, zero imports:**

| Reference | Kind |
|---|---|
| `src/app/settings/security/_deleteRequest.ts:7` → `accountDeletion.ts` | comment explaining *why* the boolean helper was superseded |
| `src/hooks/useRatings.ts:69,150,493` → `usePairwise` | comments recording the U2 unwiring and the transcript-import migration |
| `src/hooks/useRatings.test.ts:659` → `usePairwise` | comment |
| `src/components/story/StoryViewer.tsx:50` → `PairwiseSheet` | comment citing a shared z-index rung |
| `e2e/rankings-score.spec.ts:6` → `PairwiseSheet` | comment describing the historical flow |
| `src/lib/tasteAffinity.ts:60` → `tasteProfile.ts` | comment contrasting the two taste models |

**Exported-symbol references outside the candidate files — zero.** Searched with
`git grep -n -w`: `requestAccountDeletion`, `PendingPrompt`, `SessionProgress`,
`UsePairwiseReturn`, `MAX_COMPARISONS_PER_ADD`, `InsertSession`, `AnswerResult`,
`startInsertSession`, `answerComparison`, `skipSession`, `insertPosition`,
`TasteProfile`, `deriveTasteProfile`, `loadSaved`, `isSaved`, `setSaved`,
`toggleSaved`, `sortSavedByRecency`, `SavedBar`, `GOING_LIST_MAX_NAMES`,
`formatGoingList` — all zero hits.

**Dynamic imports — zero.** No `import('…')` specifier anywhere names a candidate.

`requestAccountDeletionOutcome` (14 hits) is the **surviving replacement** in
`src/app/settings/security/_deleteRequest.ts`, not the deleted
`requestAccountDeletion`; the word-boundary search is what separates the two.

**Internal edge, re-confirmed (criterion 3):** `insertFlow.ts`'s only importer
was `usePairwise.ts:27`, and it has no other caller. It dies only because the
hook does.

Deadness was never inferred from a filename or a "legacy" label. Every claim
above is a zero-importer result over tracked files.

---

## 3. Historical references left in place, on purpose

These name deleted files and were **not** edited. This goal's write scope is the
deletion candidates alone, and each of these is accurate history rather than a
live dependency:

- **`docs/V8-PRD-2026-08-13.md:123`** — "Learned ranker evidence is NOT capped to
  the five tags Settings displays; `TOP_TAGS_LIMIT` remains a presentation cap in
  `tasteProfile.ts` only." `TOP_TAGS_LIMIT` was a module-private `const` in
  `tasteProfile.ts:9`, never exported and never imported. The sentence is a
  statement about what the **ranker** does *not* do; the approved ranking model
  lives in `tasteAffinity.ts` and is untouched by this change. **No mounted
  product behaviour depended on the removed module** — proof in §4.
- The six code comments in §2. Each explains why a surviving file is shaped the
  way it is; deleting the referent does not make the explanation wrong.

---

## 4. Surviving entry points, traced AFTER deletion

| Flow | Live entry | Evidence |
|---|---|---|
| Numeric rankings | `src/app/rankings/page.tsx:7` imports `sortRatingsByScore`, `tierMidpoint` from `@/lib/pairwise` | file read |
| V7 transcript continuity | `src/hooks/useRatings.ts:393-399` — the one-time per (browser, user) merge on the sign-in path | file read |
| Account deletion | `src/app/settings/security/page.tsx:18,138` → `requestAccountDeletionOutcome` → `fetch('/api/account/delete')`; `src/app/api/account/delete/route.ts` untouched | file read |
| Server comparison deletion | `src/app/settings/security/page.tsx:12` → `deleteAllServerComparisons` from `@/lib/pairwise.server` | file read |
| Taste model | `deriveLearnedTaste` from `@/lib/tasteAffinity` in `ResultsView.tsx:13`, `useSuggestions.ts:6`, `matching.ts:13` | file read |
| Quiz archetype | `deriveArchetype` from `@/lib/quiz` in `WhereNextFlow.tsx`, `VibeQuiz.tsx`, `useSuggestions.ts`, `onboarding/location/page.tsx` | file read |
| Legacy device cleanup | `src/lib/accountCache.ts:489` still wipes `next-bar:saved:v1` | file read |
| Shared-night surface | `src/app/u/[handle]/night/[shareId]/page.tsx`, its `opengraph-image.tsx`, `src/components/ShareNightButton.tsx`, `src/lib/nights.server.ts` — all present | file listing |

**No mounted surface consumed `deriveTasteProfile`.** Every live `archetype` and
`topTags` reference resolves to the quiz `VibeProfile` path (`src/lib/quiz.ts`),
which is untouched; `/settings/profile` renders the **stored** quiz profile.

The post-deletion whole-repository search (§2's method, re-run on the deleted
tree) returns the same 8 comments and zero code references.

---

## 5. Coverage kept

`insertFlow.test.ts` imported three symbols from the **live** `@/lib/pairwise`
(`buildRankOrderForTier`, `computeScoresForTier`, `tierMidpoint`) as fixtures,
so its deletion had to be checked against their coverage. All three keep it in
`src/lib/pairwise.test.ts`, and `buildRankOrderForTier` additionally in
`src/lib/__evals__/pairwise.eval.test.ts`. Every `describe` block in the deleted
file tested `insertFlow` functions only.

`e2e/pairwise-flow.spec.ts` is **kept**: despite its name it drives the live
numeric score entry at `/rankings?add=…`, not the deleted sheet.

No test was added. In particular, no test asserts that a file was deleted.

---

## 6. The one regression the deletion caused, and its fix

`src/lib/storageInventory.test.ts` failed on the first full Vitest run:

```
FAIL src/lib/storageInventory.test.ts > V7→V8 storage-key inventory >
     every declared broadcast event is actually used in src/
AssertionError: remove the exemption when the broadcast goes away:
     expected [ 'next-bar:pairwise:local-update' ] to deeply equal []
```

`next-bar:pairwise:local-update` was a `window` CustomEvent name declared at
`src/hooks/usePairwise.ts:37` and nowhere else in `src/`, `e2e/` or `scripts/`
(verified against the base commit with `git grep … HEAD`). The guard's
`BROADCAST_EVENTS` list carried it as a deliberate exemption, and the guard
exists precisely to notice when such an exemption outlives its broadcast — its
failure message is the instruction: *remove the exemption when the broadcast
goes away.*

Fix: one line deleted from the exemption list. **This is not storage.** A
sibling assertion in the same file (`broadcast event names are not inventoried
as storage`) enforces that these are event names carrying no data at rest, so no
V7 key and no user data is involved. The guard stays armed for the two
broadcasts that remain (`next-bar:ratings:server-update`,
`next-bar:presence-changed`).

Why the pre-deletion caller search did not predict it: the search proved no
module *imports* the deleted files. This guard does not import anything — it
scans `src/` for string literals. A string-literal inventory is a caller of a
different kind, and the full suite is what surfaced it. That is the intended
division of labour, and it worked.

---

## 7. Verification

Tier re-classified on the actual changed paths
(`git diff --name-only HEAD | tier-classify.mjs`): **T1**, `nonRuntime:false` on
every path — matching the goal's stored tier, no upgrade required.

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` (`tsc --noEmit`) | exit 0, 13.0s |
| Unit — run 1 | `CI=1 npx vitest run` | **1 failed** / 2,991 passed / 7 skipped (2,999), 189 files. The §6 regression. |
| Unit — targeted re-check | `CI=1 npx vitest run src/lib/storageInventory.test.ts` | 8 passed, exit 0 |
| Unit — run 2 (after fix) | `CI=1 npx vitest run` | exit 0 — **188 files passed / 1 skipped (189)**, **2,992 tests passed / 7 skipped (2,999)**, 91.5s |
| Release contract | `node scripts/check-release-contract.mjs docs/V8-TRACEABILITY-LEDGER.json` | exit 0 — `RELEASE CONTRACT OK`, ledger 3.1.1, sha256 `f040b8e3…5eb976`, 16/16 artifacts, 150 requirements, coverage `{partial:67, complete:12, contradicted:16, stale:1, missing:54}`, 0 open decisions — **identical to the audit's E12 baseline**, so the deletions moved the contract not at all |
| Browser | `node scripts/run-e2e-release.mjs` (= `npm run test:e2e`) | *see below* |

Every command ran under `bounded-run.mjs`. Exit codes are the verbatim tool
results, not narration.

### Browser-run configuration and its limits

Release mode: production build, `reuseExistingServer:false`, 3 workers, 0
retries, `[['list'],['html']]` reporter — the config defaults, none overridden
on the command line. This lane pins `PLAYWRIGHT_PORT=3266` (confirmed free
before the run), so it builds and serves its own tree and cannot attach to a
sibling lane's server.

Environment is **staging-only**, synchronised with
`sync-worktree-env.mjs --source D:/projects/next-bar`: 4 staging keys, no
service-role key, no production project ref, `.env.local` gitignored. Lane
values added: `PLAYWRIGHT_PORT=3266`, `NEXT_PUBLIC_GOOGLE_MEDIA=0`,
`GOOGLE_MEDIA_RUNTIME_ENABLED=0`, `NEXT_BAR_ROUTING_ENABLED=true`,
`NEXT_BAR_PRODUCTION_PROJECT_REF`, `NEXT_BAR_STAGING_PROJECT_REFS`.

**Limits, stated rather than papered over:** Google media is disabled for this
run, so live Google photo/UI-Kit behaviour is NOT exercised here. Physical-iPhone
review remains separate final acceptance work. No deploy, migration, push or
external call was made by this goal.
