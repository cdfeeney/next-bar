# Next Bar workspace consolidation — 2026-08-13

## Target

Use `D:/projects/next-bar` as the single visible canonical checkout after V7 is
preserved. Git branches keep archived work; they do not need permanent worktree
folders.

## Inventory

- 39 registered worktrees.
- 6 worktree heads are already contained in the integrated V7 branch.
- 16 worktrees have tracked or untracked local changes.
- 20 clean worktree branches are not ancestors of V7 and must remain as branches
  unless explicitly retired.
- `feat/phase1-compliance-media` has 25 commits not in V7 plus four untracked
  design/growth documents. A simulated merge into V7 has 14 conflicts, so it is
  V8 review material, not a last-minute V7 merge.
- The local `main` worktree has user changes in `.gitignore` and an iOS package
  file; do not discard them.

## Safe order

1. Push the integrated V7 branch so the release candidate is preserved remotely.
2. Finish the attended V7 physical-device checklist and internal TestFlight gate.
3. Preserve every dirty worktree as a named branch commit, stash, or explicit
   archive; keep environment files out of Git.
4. Remove clean worktree checkouts with `git worktree remove` while retaining
   their branches.
5. Move the chosen integrated branch into `D:/projects/next-bar`, then remove the
   superseded main checkout/junction only after its local changes are preserved.
6. Run `git worktree prune` and verify one canonical checkout plus any explicitly
   active overnight worktree.
7. Build the V8 PRD from the operator UI references and the preserved design,
   account-sync, security, social, notification, and native-feel notes.

No database, Vercel production project, TestFlight, or App Store operation is
part of workspace cleanup.

## Progress

- Integrated V7 branch pushed to GitHub at `2ce81c1`.
- V8 design/growth inputs committed and pushed on
  `feat/phase1-compliance-media` at `53eaaea`.
- Internal TestFlight `1.0 (7)` upload completed successfully in GitHub run
  `31760573887`.
- Removed two clean worktree checkouts whose commits were already contained in
  remote V7: `nb-v7-catalog-delivery-20260813` and
  `expansion-packet-g779223`.
- Dirty, locked, private-environment-bearing, and unintegrated worktrees remain
  untouched pending explicit preservation.
- Verified full-ref backup:
  `D:/ClaudeData/NextBar/checkpoints/NEXTBAR-WORKTREES-BACKUP-2026-08-13.bundle`.
- Verified backup after preserving four additional edit sets as named stashes:
  `D:/ClaudeData/NextBar/checkpoints/NEXTBAR-WORKTREES-BACKUP-WITH-STASHES-2026-08-13.bundle`.
- Registered worktrees reduced from 39 to 15; 23 obsolete checkout folders were
  removed without `--force`. Branches remain in Git and the verified bundles.
- Windows unregistered but could not fully remove the previously identified
  locked `nb-overnight-20260807` directory. Its changes are in the named stash
  `workspace-cleanup:nb-overnight-20260807:2026-08-13`; the directory remains on
  C intentionally rather than being force-deleted.
- Remaining registered worktrees contain private environment files, active
  edits, or the current/canonical release checkout. Consolidate their credentials
  and edits explicitly before removing them.
