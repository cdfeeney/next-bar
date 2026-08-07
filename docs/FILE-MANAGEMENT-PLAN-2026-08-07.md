# File and worktree management plan — 2026-08-07

**Nothing in this report was deleted, moved, archived, pruned, reset, stashed, cleaned, or altered.**
Every figure is metadata: `git` plumbing, directory sizes via `robocopy /L` (list-only), and
`fs.statSync` mtimes. **No file content was read.** Secret-risk files are identified by presence only.

## 0. Why this report exists right now

The overnight queue hit **`ENOSPC` — `C:` had 0.01 GB free of 221.27 GB**. `npm ci` in a fresh
worktree failed after 8.2 s with repeated `no space left on device`. Item 1 and Items 3–8 all need
`node_modules`, a Next build, or Playwright, so the disk is currently the binding constraint on the
entire queue.

**The headline: the queue can be unblocked without removing a single worktree, branch, or commit.**
Deleting only *regenerable* build output and dependency trees from non-protected worktrees recovers
**≈ 12.58 GB**. Worktree removal is a separate, lower-priority question.

## 1. Worktree inventory — 26 registered

`git worktree list --porcelain` returns **26** entries. Verified against the reference points:

| Ref | SHA |
|---|---|
| `origin/main` | `6ec5e5d7ad1d60bf434e2fef05735843be8e907c` |
| accepted web base | `efca4860d1b6af4f7f70b1c8f00930aad3b32256` |
| live-photos preserve point | `9051ba30fcc188b3d55436ef586015ecf86c28ab` |
| frozen Production packet | `99ff7b3ab497fb3b7b52944c75755f5afbb806e5` |
| auth candidate | `76d610fcfb5944244d34fd02c56989989bda2047` |

`+N/−M` = commits ahead of / behind `origin/main`. `pres` = number of branches or refs containing
this HEAD (**≥ 1 means the commits survive worktree removal**, because removing a worktree never
deletes its branch). `env` = a `.env.local` is present (secret-risk, presence only).

| # | Worktree | Branch | HEAD | +/− main | pres | dirty | untr | env | Size | node_modules | artifacts | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `next-bar` | `feat/phase1-compliance-media` | `c02baf9` | +83/−6 | 13 | 0 | 0 | Y | 1646 MB | 398 MB | 587 MB | **KEEP** |
| 2 | `…Temp\…\wf-fix` | *detached* | `15a4876` | +1/−1 | **1 (remote only)** | 0 | 0 | n | 198 MB | — | — | **UNKNOWN — BLOCKED** |
| 3 | `nb-account-conflict-e2e` | `test/account-conflict-e2e` | `c60bc07` | +260/−0 | 1 | 0 | 0 | Y | 965 MB | 513 MB | 252 MB | ARCHIVE CANDIDATE |
| 4 | `nb-account-sync` | `feat/beta1-account-sync` | `09a934d` | +259/−0 | 8 | 0 | 0 | Y | 1259 MB | 513 MB | 545 MB | **KEEP** |
| 5 | `nb-beta1-rc` | `release/beta1-rc` | `415a486` | +252/−0 | 9 | 0 | 0 | n | 1365 MB | 513 MB | 651 MB | ARCHIVE CANDIDATE |
| 6 | `nb-google-photos` | `fix/auth-cross-context-email` | `76d610f` | +268/−0 | 1 | 0 | 0 | n | 1222 MB | 513 MB | 508 MB | **KEEP — PROTECTED** |
| 7 | `nb-import` | `feat/bar-mass-import` | `c058121` | +1/−30 | 1 | 0 | 0 | n | 112 MB | — | — | ARCHIVE CANDIDATE |
| 8 | `nb-ios` | `main` | `127dcae` | +3/−5 | 2 | 2 | 0 | Y | 704 MB | 506 MB | — | **KEEP — PROTECTED** |
| 9 | `nb-onboarding-ux` | `fix/onboarding-map-and-recovery` | `34dc516` | +260/−0 | 5 | 0 | 0 | n | 201 MB | — | — | ARCHIVE CANDIDATE |
| 10 | `nb-overnight` | `feat/overnight-2026-07-30` | `51f937e` | +261/−6 | 1 | 3 | 4 | Y | 1501 MB | 403 MB | 892 MB | **KEEP — PROTECTED** |
| 11 | `nb-overnight-20260807` | `chore/prime-foundation` | `232c028` | +1/−0 | 1 | 0 | 0 | n | 198 MB | — | — | **KEEP — active run** |
| 12 | `nb-platform-preflight` | `codex/platform-preflight-2026-08-03` | `1c29598` | +199/−6 | 1 | 1 | 0 | n | 938 MB | 466 MB | 272 MB | **KEEP — PROTECTED** |
| 13 | `nb-prod-migrations-0042` | `release/prod-migrations-0033-0036-0042` | `99ff7b3` | +262/−0 | 1 | 0 | 0 | n | 201 MB | — | — | **KEEP — frozen packet** |
| 14 | `nb-qa1` | `feat/qa1-home` | `2cdc7e7` | +1/−31 | 4 | 0 | 1 | Y | 574 MB | 398 MB | 64 MB | ARCHIVE CANDIDATE |
| 15 | `nb-qa2` | `feat/qa2-findbar` | `ffce6a2` | +1/−30 | 4 | 0 | 1 | Y | 668 MB | 398 MB | 159 MB | ARCHIVE CANDIDATE |
| 16 | `nb-qa3` | `feat/qa3-board` | `83c146e` | +1/−30 | 4 | 0 | 1 | Y | 626 MB | 398 MB | 116 MB | ARCHIVE CANDIDATE |
| 17 | `nb-qa4` | `feat/qa4-not-tonight` | `8ab7e82` | +1/−30 | 4 | 0 | 1 | Y | 620 MB | 398 MB | 110 MB | ARCHIVE CANDIDATE |
| 18 | `nb-qa5` | `feat/qa5-join-og` | `fdeeb96` | +1/−30 | 4 | 0 | 1 | Y | 850 MB | 398 MB | 340 MB | ARCHIVE CANDIDATE |
| 19 | `nb-qa5-card` | `feat/qa5-hero-card` | `9a4e96a` | +1/−31 | 4 | 0 | 1 | Y | 621 MB | 398 MB | 111 MB | ARCHIVE CANDIDATE |
| 20 | `nb-qa5-lists` | `feat/qa5-lists` | `4c87289` | +1/−31 | 4 | 0 | 1 | Y | 580 MB | 398 MB | 71 MB | ARCHIVE CANDIDATE |
| 21 | `nb-qa5-swipe` | `feat/qa5-discover` | `2660381` | +1/−31 | 4 | 0 | 1 | Y | 677 MB | 398 MB | 168 MB | ARCHIVE CANDIDATE |
| 22 | `nb-release-migrations` | `release/prod-migrations-0033-0036` | `6e553fa` | +3/−0 | 10 | 0 | 0 | n | 198 MB | — | — | ARCHIVE CANDIDATE |
| 23 | `nb-staging-deploy` | *detached* | `6ec5e5d` | +0/−0 | **12** | 1 | 0 | Y | 198 MB | — | — | **KEEP — PROTECTED** |
| 24 | `nb-testflight-node22` | `fix/testflight-node22` | `7cc7fea` | +0/−4 | **17** | 1 | 0 | n | 198 MB | — | — | **KEEP — PROTECTED** |
| 25 | `next-bar-ceo` | `feat/ceo-v2` | `a0f165d` | +7/−30 | 2 | 0 | 0 | n | 480 MB | 368 MB | — | ARCHIVE CANDIDATE |
| 26 | `next-bar-share` | `feat/share-loop-week1` | `bd501a5` | +14/−41 | 2 | 0 | 0 | n | 780 MB | 368 MB | 300 MB | ARCHIVE CANDIDATE |

**Every one of the 26 has `pres ≥ 1`** — no worktree holds commits reachable only from its own
working directory. Removing any worktree loses **no commit**. The risk is entirely in *uncommitted*
work, catalogued in §3 — with the single caveat in the next paragraph.

> **Methodology correction (independent review, 2026-08-07).** The `pres` column was first computed
> with `git branch --all --contains`, which counts the worktree's **own** `* (HEAD detached at …)`
> line as a preserving ref. That is circular: the pointer disappears the moment the worktree is
> removed, so it preserves nothing. Recomputed with
> `git for-each-ref --contains <sha>`, excluding the `refs/remotes/origin/HEAD` symbolic alias.
> Three rows changed — `wf-fix` 2→**1**, `nb-staging-deploy` 14→**12**, `nb-testflight-node22`
> 18→**17**. The other 23 were already correct, and no classification changed. Corrected figures are
> in the table above.
>
> **`wf-fix` is the one genuinely fragile entry.** Its only containing ref is
> `refs/remotes/origin/fix/ios-testflight-macos26` — a **remote-tracking ref with no local branch**.
> If that branch is deleted upstream *and* this worktree is removed, commit `15a4876` becomes
> unreachable locally. Before touching `wf-fix`, create a local ref:
> `git branch preserve/wf-fix-15a4876 15a4876`.

## 2. Worktree-count reconciliation

Mission time recorded **25**. This report measures **26**. The delta is **+1 and fully explained**:
`nb-overnight-20260807` was created by this run at 05:0x on 2026-08-07 (`git worktree add … -b
chore/prime-foundation 6ec5e5d`). No worktree appeared or disappeared for any other reason. No entry
is `prunable` and none is `locked`. The earlier "C1 count" could not be located in the repository or
docs from this session; the reconciliation above is against the mission-time figure this run measured
itself, and that limitation is stated rather than guessed.

## 3. Uncommitted work — the only irreplaceable content

| Worktree | Tracked-dirty | Untracked |
|---|---|---|
| `nb-overnight` | `docs/CONTINUATION-2026-08-05.md`, `docs/MASTER-TODO-2026-07-30.md`, `docs/OPERATOR-BUGS-2026-07-28.md` | `docs/CTO-OPERATOR-PLAN-2026-07-31.md`, `docs/PORTFOLIO-AND-COMPANY-AGENT-AUDIT-2026-08-05.md`, `docs/STAGING-ACCEPTANCE-NOTES-2026-08-01.md`, `docs/THURSDAY-BETA-RELEASE-PLAN-2026-08-05.md` |
| `nb-ios` | `.gitignore`, `ios/App/CapApp-SPM/Package.swift` | — |
| `nb-platform-preflight` | `docs/IOS-TESTFLIGHT-RUNBOOK.md` | — |
| `nb-staging-deploy` | `.gitignore` | — |
| `nb-testflight-node22` | `.github/workflows/ios-testflight.yml` | — |
| `nb-qa1`…`nb-qa5-swipe` (8) | — | `playwright.local.config.ts` (one per worktree, same filename) |

**`nb-overnight` is the highest-value item in this entire inventory.** Seven operator planning
documents — four of them untracked and therefore existing nowhere else — sit in a worktree that is
already on the protected list. It must not be cleaned, checkpointed, or broad-committed. (A prior
loop-guard checkpoint has swept protected operator docs into a commit before; narrow-commit only.)

## 4. Secret-risk surface — presence only

`.env.local` is present in **14** worktrees: `next-bar`, `nb-account-conflict-e2e`,
`nb-account-sync`, `nb-ios`, `nb-overnight`, `nb-staging-deploy`, and all 8 `nb-qa*`.
**No `.env.local` was opened and no value was read.** Consequences:

- These files are untracked by design and are **not** recoverable from git. Any removal or archive of
  those worktrees destroys local credentials unless they are copied first.
- An archive of any of these must be encrypted or the `.env.local` excluded. Never place one in a
  shared, synced, or cloud-backed location.

## 5. Disk accounting

### Registered worktrees

| Category | Size | Regenerable? |
|---|---|---|
| All 26 worktrees, total | **17.17 GB** | partly |
| `node_modules` (18 worktrees) | **7.56 GB** | **yes** — `npm ci` |
| Build/test artifacts | **5.03 GB** | **yes** |
| — of which `.next` | 5141 MB | yes |
| — `playwright-report` | 6 MB | yes |
| — `test-results`, `.vercel` | < 1 MB | yes |
| Source + `.git` + untracked | ≈ 4.58 GB | **no** |
| **Regenerable subtotal** | **12.58 GB** | |

### Wider Next Bar surface

| Path | Size | Note |
|---|---|---|
| `C:\Users\cdfee\projects` | 20.68 GB | contains 25 of the 26 worktrees |
| `C:\Users\cdfee\Downloads` | **15.76 GB** | largest single non-worktree item; **user data, out of scope** |
| `…\AppData\Local\ms-playwright` | 2.10 GB | browser binaries; regenerable via `npx playwright install` |
| `…\AppData\Local\Temp` | 0.75 GB | includes the `wf-fix` worktree (198 MB) |
| `…\AppData\Local\Temp\claude` | 0.53 GB | agent scratch |
| `C:\Users\cdfee\.claude` | 0.67 GB | harness + session data |
| `…\AppData\Local\npm-cache` | 0.69 GB | regenerable via `npm cache clean --force` |

**These rows OVERLAP — do not add them naively.** `C:\Users\cdfee\projects` (20.68 GB) already
contains 25 of the 26 worktrees, i.e. it subsumes almost all of the 17.17 GB worktree total from the
previous table. `…\Temp\claude` (0.53 GB) is a subset of `…\Temp` (0.75 GB). Summing every printed
figure gives ≈ 58.3 GB, which double-counts. The de-duplicated total is:

```
projects 20.68 + Downloads 15.76 + ms-playwright 2.10 + Temp 0.75 + .claude 0.67 + npm-cache 0.69
  = 40.65 GB   (worktrees counted once, inside `projects`; Temp\claude counted once, inside Temp)
```

**Scope limit, stated honestly:** that de-duplicated ≈ 40.6 GB is of a 221.27 GB volume. The
remaining ≈ 180 GB is outside the Next Bar surface (OS, other applications, other user data) and was
not inventoried. **Freeing Next Bar space will unblock the queue but will not by itself explain why a
221 GB disk is full.** A full-volume audit is a separate attended task.

**Artifact coverage — what was searched and found empty.** Every worktree was probed for all of:
`.next`, `coverage`, `playwright-report`, `test-results`, `blob-report`, `.turbo`, `dist`, `build`,
`.vercel`, `traces`, `screenshots`. Only four types exist anywhere in the inventory (`.next`,
`playwright-report`, `test-results`, `.vercel`); the rest — **including `coverage`, `traces`, and
`screenshots`** — matched **zero** directories across all 26 worktrees. Their absence is a measured
result, not an omission, so the 5.03 GB artifact figure is not undercounted on those categories.

### Safely recoverable, ranked by risk

| Rank | Action | Recovers | Risk |
|---|---|---|---|
| 1 | Delete `.next` in the 16 non-protected worktrees | **2.28 GB** | **none** — pure build output |
| 2 | `npm cache clean --force` | 0.69 GB | none — re-downloads |
| 3 | Delete `node_modules` in the 16 non-protected worktrees | **4.83 GB** | none — `npm ci` restores |
| | *subtotal, steps 1–3* | **7.80 GB** | |
| 4 | Delete `.next` + `node_modules` in the 10 KEEP/protected worktrees (attended, one at a time) | ≈ 5.5 GB | low — but these hold the dirty work in §3; touch nothing else |
| 5 | Remove `ms-playwright` browsers | 2.10 GB | low — one `npx playwright install` to restore |
| **Total without removing any worktree** | | **≈ 15.4 GB** | |

Steps 1–3 alone recover **7.80 GB** and are sufficient to unblock the queue.

## 6. Classification rules applied

- **KEEP** — on the operator's protected list, holds the active run, holds a frozen release packet,
  or is the main checkout.
- **ARCHIVE CANDIDATE** — commits preserved by a branch, but the worktree still holds untracked
  content, a uniquely-held tip, or a `.env.local` that would be destroyed.
- **REMOVE CANDIDATE** — see the gate below.
- **UNKNOWN — BLOCKED** — cannot be classified from metadata alone.

### REMOVE CANDIDATE gate — all seven conditions required

1. clean state (no tracked-dirty, no untracked)  2. no active lease  3. commits preserved by a
branch or ref  4. untracked content inventoried  5. no unique release / native / migration / user
evidence  6. a written recovery procedure  7. **future explicit operator approval**

> **Condition 2 is asserted, not yet demonstrated.** What was actually checked: no entry in
> `git worktree list --porcelain` is `locked` or `prunable`, and the harness write-lease store shows
> this run holding the only lease. That is **not** a proof of "no active lease" — it does not detect
> a peer editor, an open file handle, or a live agent session in another worktree. It costs nothing
> today because **zero worktrees are REMOVE CANDIDATE**, so the condition is never exercised. Before
> the first real removal, verify with `worktree-guard.mjs check` from the target worktree **and** an
> open-handle check, and record the result. Do not treat the current table as satisfying condition 2.

**Result: ZERO worktrees are classified REMOVE CANDIDATE today.**

Every otherwise-eligible worktree fails condition 1 or 5:

- The 8 `nb-qa*` worktrees each carry one untracked `playwright.local.config.ts` **and** a
  `.env.local` → fail conditions 1 and 5. They **promote to REMOVE CANDIDATE** the moment the
  operator preserves or discards those two files per worktree. They are the largest cluster
  (**5216 MB** combined) and the most obvious future win.
- `nb-account-conflict-e2e` holds a `.env.local` and a tip preserved by only its own branch → fails 5.
- `nb-beta1-rc`, `nb-onboarding-ux`, `nb-import`, `nb-release-migrations`, `next-bar-ceo`,
  `next-bar-share` are clean with preserved commits, but each still holds unique release or feature
  evidence that has not been independently confirmed as superseded → fails 5 pending operator review.

This is deliberately strict. **Nothing needs to be removed to unblock the queue** (§5), so there is
no reason to relax the gate under time pressure.

### `wf-fix` — UNKNOWN, BLOCKED

`C:\Users\cdfee\AppData\Local\Temp\claude\…\scratchpad\wf-fix`, detached at `15a4876`, +1/−1 vs
`origin/main`, 198 MB, no `node_modules`. Its commit **is** contained by 2 branches, so nothing is
lost. But it lives under `AppData\Local\Temp`, which Windows and cleanup tools may clear without
warning, and its purpose is not identifiable from metadata. **Operator question:** is this a
disposable scratch worktree, or does it need relocating out of `Temp`? Do not remove it until
answered — `git worktree prune` would deregister it silently if Temp is ever cleared.

## 7. Obsolete and contradictory state documents

Metadata-level observation only, no contents read:

- `nb-overnight` carries four **untracked** planning documents dated 2026-07-31 → 2026-08-05
  (§3) alongside three modified tracked ones. Untracked planning docs are invisible to every other
  worktree and to CI, so any plan they contain cannot be assumed known elsewhere.
- Two migration release branches coexist: `release/prod-migrations-0033-0036` (`nb-release-migrations`,
  +3) and `release/prod-migrations-0033-0036-0042` (`nb-prod-migrations-0042`, `99ff7b3`, +262). The
  frozen Production packet is the **latter**. The former is a superseded earlier cut and is a prime
  archive target once the operator confirms that reading.
- `nb-ios` sits on branch `main` at `127dcae`, which is **+3/−5 versus `origin/main`** — local `main`
  has diverged from the remote. Any assumption that "`main` is `origin/main`" is currently false.

## 8. Attended cleanup sequence — one worktree at a time

**Do not run any of this unattended.** Ordered lowest-risk first. Verify free space after each step;
stop as soon as enough has been recovered.

```powershell
# STEP 0 — baseline. Record it before touching anything.
Get-PSDrive C | Select-Object Used,Free

# STEP 1 — build output only, non-protected worktrees. Zero risk: pure build product.
#   Do ONE worktree, verify, then the next.
Remove-Item -Recurse -Force 'C:\Users\cdfee\projects\nb-qa1\.next'

# STEP 2 — npm cache. Regenerates on next install.
npm cache clean --force

# STEP 3 — dependency trees, non-protected worktrees, ONE AT A TIME.
#   MUST verify the target is a real directory, not a junction, first —
#   a recursive delete through a junction has gutted the real node_modules before.
$p = 'C:\Users\cdfee\projects\nb-qa1\node_modules'
$i = Get-Item $p -Force
if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE POINT — STOP' }
Remove-Item -Recurse -Force $p

# STEP 4 — Playwright browsers (only if still short). One reinstall to restore.
Remove-Item -Recurse -Force 'C:\Users\cdfee\AppData\Local\ms-playwright'
```

**Protected worktrees** (`nb-google-photos`, `nb-ios`, `nb-overnight`, `nb-platform-preflight`,
`nb-staging-deploy`, `nb-testflight-node22`) — do not touch in steps 1–3. If their build output is
needed later, handle each individually, attended, after confirming the dirty files in §3 are safe.

**Never** run `git worktree prune`, `git clean`, `git reset`, or `git stash` anywhere in this
sequence. None of them is required to recover space, and each can destroy the uncommitted work in §3.

## 9. Archive validation and recovery

Archive **before** removal, and prove the archive before trusting it.

> **Do NOT use `Get-ChildItem -Recurse | Compress-Archive`.** That pattern was in the first draft of
> this document and is broken. Reproduced 2026-08-07: two files named `index.ts` in different
> subdirectories produced a **4-entry** zip containing `a\index.ts`, `b\index.ts`, **and two
> colliding root-level `index.ts` entries** — directory structure partially discarded, duplicate
> names, and **no error raised**. In a Next.js tree full of repeated `page.tsx` / `route.ts` /
> `index.ts` leaf names, that silently yields an archive you cannot trust or restore from. Stage a
> filtered copy first, then compress the *directory*.

```powershell
$src='C:\Users\cdfee\projects\nb-qa1'
$stage='C:\archive-stage\nb-qa1'
$dst='D:\archive\nb-qa1-2026-08-07.zip'

# CREATE — stage with robocopy (preserves structure, excludes regenerable trees),
#          then compress the DIRECTORY so paths are retained.
$excl = @('node_modules','.next','test-results','playwright-report','.turbo')
robocopy $src $stage /E /XD @excl /R:0 /W:0 | Out-Null

# robocopy exit codes: 0-7 = success (bit 3+ = failures). 8 or above MUST abort.
# Without this, a half-staged tree still compresses cleanly and passes every check below.
if ($LASTEXITCODE -ge 8) { throw "robocopy FAILED with $LASTEXITCODE — do not archive, do not delete" }

# Source-completeness baseline, computed with the SAME exclusions. Entry-count
# equality against the stage proves only that zip==stage; it says nothing about
# whether the stage captured the source. This is the check that does.
$srcCount = (Get-ChildItem $src -Recurse -File -Force |
  Where-Object { $p = $_.FullName.Substring($src.Length)
                 -not ($excl | Where-Object { $p -match "\\$([regex]::Escape($_))\\" }) }).Count
$stageCount = (Get-ChildItem $stage -Recurse -File -Force).Count
if ($srcCount -ne $stageCount) { throw "STAGING INCOMPLETE: source $srcCount vs stage $stageCount" }

Compress-Archive -Path $stage -DestinationPath $dst -CompressionLevel Optimal

# VALIDATE — archive opens, preserves paths, and carries the files that exist nowhere else.
Add-Type -A System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($dst)
"entries: $($z.Entries.Count)"
# every entry must carry a directory component — a bare leaf name means flattening happened
$flat = @($z.Entries | Where-Object { $_.FullName -notmatch '[\\/]' -and $_.Name })
"flattened entries (MUST be 0): $($flat.Count)"
# duplicate FullName means collision — MUST be 0
"duplicate paths (MUST be 0): $((($z.Entries.FullName | Group-Object | Where-Object Count -gt 1)).Count)"
$z.Entries | Where-Object { $_.Name -in @('playwright.local.config.ts','.env.local') } |
  Select-Object FullName,Length
$z.Dispose()

# compare against source count — they must match
(Get-ChildItem $stage -Recurse -File -Force).Count
```

The archive is valid only when **all five** hold: robocopy exited `< 8`; **source file count equals
staged file count**; **flattened entries = 0**; **duplicate paths = 0**; the zip entry count matches
the staged file count; and both irreplaceable files appear with a full path.

> **Why the source-count check is the load-bearing one.** `Compress-Archive -Path <dir>` roots every
> entry under the staged directory's own name, so paths *are* retained — but zip-vs-stage equality
> only proves the compression step was faithful. If robocopy silently staged a partial tree, the zip
> matches the stage perfectly and every other assertion passes while the archive is missing files.
> Checking robocopy's exit code and the source count is what closes that hole. (Raised by the Codex
> review lane, 2026-08-07; the first version of this procedure asserted only zip-vs-stage.)

**Do not delete a worktree unless all five checks pass.** Any throw above means stop and investigate
— never proceed to removal on a failed or unverified archive.

Recovery of a removed worktree needs **no archive at all** for committed work, because every branch
survives:

```powershell
git worktree add C:\Users\cdfee\projects\nb-qa1 feat/qa1-home   # commits restored from the branch
cd C:\Users\cdfee\projects\nb-qa1; npm ci                        # node_modules restored
# then copy .env.local and playwright.local.config.ts back from the archive — ONLY these are unrecoverable
```

**Do not remove a worktree until its archive has passed the validation step above.** An unvalidated
archive is not a recovery procedure.

## 10. Verification that this report changed nothing

- `git status` in this worktree shows only this new file.
- All sizing used `robocopy /L` (list-only; copies nothing) and `fs.statSync`.
- No `Remove-Item`, `git clean`, `git worktree prune`, `git reset`, `git stash`, or move/archive
  command was issued against any inventoried path.
- The one deletion this run performed was its **own** failed partial `npm ci` output inside
  `nb-overnight-20260807`, verified beforehand to be a real directory and not a reparse point. That
  worktree was created by this run minutes earlier and held no user content.

## 11. Operator decisions required

1. **Approve the §8 sequence** (steps 1–3 recover **7.80 GB** with no worktree removal, no branch
   deletion, and no commit loss). This is what unblocks the overnight queue.
2. **`wf-fix`** — disposable scratch, or relocate out of `Temp`?
3. **The 8 `nb-qa*` worktrees** — preserve or discard `playwright.local.config.ts` and `.env.local`
   per worktree? Answering promotes 5216 MB from ARCHIVE to REMOVE eligibility.
4. **`release/prod-migrations-0033-0036`** — confirm it is superseded by the `-0042` packet, making
   `nb-release-migrations` archivable.
5. **`Downloads` at 15.76 GB** and the ≈ 180 GB unaccounted for on `C:` — out of this report's scope;
   schedule a full-volume audit if space pressure recurs.
