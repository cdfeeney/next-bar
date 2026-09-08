# V9 review follow-up — saved-bar continuity, doc correction, fixture clock

Date: 2026-09-08. Risk tier **T1** (`bin/tier-classify.mjs` on the actual changed
paths: `tier=T1, t0FileCount=0, escalated=false, skippable=false`, project tier map).

This closes the two valid Medium findings left open when goal
`g-422a2f37-385b-4cf5-98da-0f387cc09a05` finalized candidate `4d8ced1` — T1 policy
treated them as nonblocking and refused `begin-fix`. It is not a rerun of that
candidate and not authority for further retirement. `4d8ced1` and its receipts
stand.

| Commit | Contents |
| --- | --- |
| `c6ef631` | accepted pre-retirement baseline |
| `7366b06` | the V9 retirement (S1/S3/S4/S5) |
| `4d8ced1` | reviewed predecessor candidate |
| `5d43558` | **this change** — the source/test/doc edits, and the commit every gate below was run against |

## 1. `next-bar:saved:v1` keeps its read path

`src/lib/saved.ts` and `src/types/saved.ts` are restored **byte-for-byte** from
the accepted baseline. Not "equivalent" — the same git blobs:

| Path | Baseline `c6ef631` blob | Blob at `5d43558` | Identical |
| --- | --- | --- | --- |
| `src/lib/saved.ts` | `e4059629e7af62a5b845af8533d3692694630e9a` | `e4059629e7af62a5b845af8533d3692694630e9a` | yes |
| `src/types/saved.ts` | `4976e49bee01f6e769fc556095a4a7468542324f` | `4976e49bee01f6e769fc556095a4a7468542324f` | yes |

`git diff c6ef631 5d43558 -- src/lib/saved.ts src/types/saved.ts` is empty, and
neither path appears in `git diff --name-status c6ef631 5d43558`.

**Why the audit's own conclusion did not settle it.** The audit was right that
nothing mounts these modules; that is not what the contract asks for.
`docs/V8-DATA-CONTINUITY-2026-08-14.md` freezes the key and requires the READ
PATH to survive until a deliberate migration into the named-list owner.
`src/lib/accountCache.ts:489` holds the key only as a member of a wipe list — a
delete site. `src/lib/storageInventory.test.ts` counts that as presence, and says
so in its own comment: *"a delete-only site (a `removeItem` call, or a wipe list
like `accountCache.ALL_KEYS`) is still a literal, so it counts as presence."*
That accepted limitation is exactly what the deletion leaned on. A wipe list is
not a reader.

### Restored interface, traced

| Symbol | Kind | Importers at `5d43558` |
| --- | --- | --- |
| `loadSaved` | `() => SavedBar[]` | `src/lib/saved.test.ts` only |
| `isSaved` | `(barId) => boolean` | none |
| `setSaved` | `(barId, saved) => void` | none |
| `toggleSaved` | `(barId) => boolean` | none |
| `sortSavedByRecency` | `(items) => SavedBar[]` | none |
| `SavedBar` (type) | `{ barId, savedAt }` | `src/lib/saved.ts` |

Measured with `grep -rn "from '@/lib/saved'" src/ e2e/` and the same for
`'@/types/saved'`.

**This is compatibility code, deliberately unmounted. It is not a completed UI
migration.** No surface calls it, nothing was wired, and no migration was
invented or run. The point is that a V7 device's bytes stay readable, and the
key stays accounted for by a real reader rather than by a delete literal.

### Retained live entrypoints — unchanged

Every surviving entrypoint the retirement touched around is blob-identical to
the baseline: `src/hooks/useRatings.ts`, `src/lib/pairwise.ts`,
`src/lib/pairwise.local.ts`, `src/lib/pairwise.server.ts`,
`src/lib/tasteAffinity.ts`, `src/lib/accountCache.ts`,
`src/app/settings/security/_deleteRequest.ts`,
`src/app/u/[handle]/night/[shareId]/opengraph-image.tsx`. Independently
confirmed by the lead's static check
(`D:/harness-handoffs/nextbar-overnight-20260907/v9-followup-lead-check.json`,
`identical_to_baseline: true` on all eight). Numeric ranking, import,
account-deletion, map, routing and the standard Places UI are untouched.

### Remaining retirement, actually counted

`git diff --numstat c6ef631 5d43558 -- src/`:

| Measure | Value |
| --- | --- |
| Files still deleted | **13** (was 15 at `4d8ced1`; `saved.ts` and `types/saved.ts` came back) |
| Source lines deleted | 2,465 |
| Source lines added | 41 (`src/lib/saved.test.ts`) |
| **Net source lines removed** | **2,424** |
| Net non-test product lines removed | 1,191 |

The lead's independent check reports the same 13 / 2,424 / 1,191. The 2,465
deletions are 2,464 lines from the 13 deleted files plus one line removed from
`src/lib/storageInventory.test.ts` (the retired broadcast name).

**No runtime speed claim is made or implied.** Fewer files is a smaller
maintenance surface, nothing more; nothing here was measured for speed.

## 2. Compatibility regression — `src/lib/saved.test.ts`

Two cases, both real behavior, neither a file-existence assertion:

1. *reads a V7 saved record without rewriting the stored bytes* — seeds the exact
   record shape `e2e/v7-continuity.spec.ts` installs
   (`[{"barId":"attaboy","savedAt":"2026-08-12T20:30:00-04:00"}]`), reads it via
   `loadSaved()`, asserts the parsed value AND that
   `localStorage.getItem(KEY)` is still the identical string.
2. *leaves an unreadable legacy value in place instead of clearing it* — a value
   the validator rejects still returns `[]` **and** is still in storage
   afterwards, so the reader's empty-array fallback can never become a silent
   delete of data a later migration needs.

## 3. Continuity-doc CustomEvent correction

The paragraph above the frozen-key table was wrong in two directions, not one.
It claimed two broadcast names, `next-bar:ratings:server-update` and
`next-bar:pairwise:local-update`. Measured against `BROADCAST_EVENTS` in
`src/lib/storageInventory.test.ts` at `5d43558`, the real list is
`next-bar:ratings:server-update` and `next-bar:presence-changed`:
`pairwise:local-update` left the guard with its last dispatcher (the one-line
deletion in `7366b06`), and `presence-changed` was never named in the doc at all.
The paragraph now names the true pair and records the retired third.

Scope held: **only** that paragraph changed. The frozen-key table is untouched,
including the `next-bar:saved:v1` row, which continues to read *"`src/lib/saved.ts`
still reads it, no UI calls it"* — now true again. No inventory-checker rewrite.

## 4. Night Out fixture clock

`e2e/night-out.spec.ts` — one-line change plus the comment explaining why it must
not be simplified away:

```
-    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00'));
+    await page.clock.setFixedTime(new Date('2026-07-24T20:00:00-04:00'));
```

A date-time literal with no offset is parsed in the **host's** zone, so the
pinned instant moved with the machine. Reproduced deterministically — no system
clock change, no reliance on Windows Node honoring a `TZ` env var; each host's
instant is constructed explicitly and rendered through
`Intl.DateTimeFormat(..., { timeZone: 'America/New_York' })`:

```
corrected literal  -> UTC 2026-07-25T00:00:00.000Z | NYC 7/24/26, 20:00:00
offset-free on EDT (UTC-4) -> UTC 2026-07-25T00:00:00.000Z | NYC 7/24/26, 20:00:00
offset-free on PDT (UTC-7) -> UTC 2026-07-25T03:00:00.000Z | NYC 7/24/26, 23:00:00
deadline 23:00 EDT -> UTC 2026-07-25T03:00:00.000Z
headroom hours: corrected = 3 | offset-free on PDT host = 0
this runner local zone: America/New_York
```

Zero headroom is the exact deadline, where `remainingLabel` returns
'immediately' — the assertion the pin exists to make deterministic. The
`-04:00` form gives every host the same three hours. Assertions unchanged.

The same one-line correction was independently reached in vibe candidate
`3a5bcf9`; only that line is reused, none of its product changes.

## 5. Verification — commands, commit, counts, exit status

Everything below ran against **`5d43558`** on a clean worktree, port **3705**
(controller-assigned; the `3266` in the goal body is stale — lead confirmed 3705
authoritative and disjoint from the vibes lane's 3842). Env synced with
`node ~/.claude/bin/sync-worktree-env.mjs --source D:/projects/next-bar <this worktree>`:
staging-only, gitignored, 4 staging keys + 6 kept lines. No production
credentials.

| Check | Exact command | Result | Exit |
| --- | --- | --- | --- |
| Stored structured verification | `node node_modules/typescript/bin/tsc --noEmit --diagnostics` | ran and emitted diagnostics: 1466 files, 468929 lines, total time 3.15s; recorded by the store as `succeeded`, `output_sha256 86542ae8…`, bound to tree `45ff877b…` | 0 |
| Typecheck | `npm run typecheck` | clean | 0 |
| Targeted | `npx vitest run src/lib/saved.test.ts src/lib/storageInventory.test.ts src/lib/accountCache.test.ts` | 3 files, 53 passed | 0 |
| Full Vitest | `npm test` (CI=1) | **189 files passed, 1 skipped; 2994 tests passed, 7 skipped, 0 failed**; 114.42s | 0 |
| Release contract | `npm run check:contract` | `RELEASE CONTRACT OK`; ledger 3.1.1, 16/16 artifacts, 150 requirements, 0 open decisions | 0 |
| Browser gate — iPhone 13 | `npm run test:e2e -- --project="iPhone 13"` | **360 passed, 1 skipped, 0 failed**; 6.3m | 0 |
| Browser gate — Pixel 7 | `node scripts/run-e2e-release.mjs "--project=Pixel 7"` | **360 passed, 1 skipped, 0 failed**; 4.1m | 0 |

Combined browser coverage: **720 passed, 2 skipped, 0 failed** across both
required viewports, production build, 3 workers, 0 retries, HTML reporter
preserved.

### Candidate commit vs tested commit

The frozen candidate is the **docs-only child of `5d43558`** — it adds this file
and nothing else. Suites were not rerun to recapture a summary; the mapping is
proved statically instead:

- `git diff --name-status 5d43558 <candidate>` lists exactly one entry, this
  document.
- `git rev-parse 5d43558:src` and `<candidate>:src` are the same tree,
  `7b191dfa520fbca7a6a6b8edb3754fe66693f1e7`; `:e2e` likewise,
  `b7ac53dbe4945c769dae8fa5591c89627235bff6`.
- `git diff --stat 5d43558 <candidate> -- src/ e2e/ scripts/ public/
  package.json package-lock.json playwright.config.ts tsconfig.json
  next.config.ts` is empty.

So every count in the table above describes the candidate's runtime tree
exactly. The stored structured verification was additionally re-run on the
candidate itself.

### The single unfiltered command did NOT complete — disclosed, not counted

`npm run test:e2e` with no project filter was attempted first and was
**terminated by `bounded-run` at 570,310 ms**, having reported 538 of ~722 tests
with no summary line. That is a timeout, not a pass, and nothing from it is
claimed as evidence; its partial HTML report was discarded. This session's
subprocess ceiling is 600 s, below the goal's 1,800,000 ms allowance, so the run
was completed as the two per-project invocations the goal permits. **The exact
single full command is not claimed to have run.** Each project's HTML report was
moved out of the way before the next run could overwrite it:
`D:/harness-handoffs/nextbar-overnight-20260907/v9-followup-reports/playwright-report-{iphone13,pixel7}/`.

The two spellings differ because of argument forwarding, not intent:
`npm run … -- --project="Pixel 7"` reached the runner split into two argv entries
and crashed before the suite started (exit `0xC0000409`, 2s). Invoking
`scripts/run-e2e-release.mjs` directly preserves the single argument. That script
**is** `npm run test:e2e` — same file, same `PLAYWRIGHT_RELEASE=1`.

### The specific changed paths, observed

- The corrected fixture ran green on both viewports:
  `night-out.spec.ts:1733 › … three rows are editable in place` — `ok` on
  iPhone 13 (3.3s) and Pixel 7 (1.3s).
- The 2 skips are the one pre-existing `/friends` overscroll skip per project
  (`native-shell-contract.spec.ts:327`), unrelated to this change.
- No server or Playwright process was left behind; port 3705 confirmed free
  after each run.

## Limits

- **Physical-iPhone and live-Google validation were not performed.** That remains
  an open release limit, unchanged by this work.
- The browser gate ran as two per-project invocations, not one command (above).
- Static blob comparison carries the predecessor's whole-repository importer
  audit forward across a verified three-file source delta; it is not itself a
  fresh whole-repository scan, and not a release attestation.
- The restored reader has **no mounted caller**. It is preserved compatibility
  code awaiting a deliberate migration — the migration itself is still owed.
