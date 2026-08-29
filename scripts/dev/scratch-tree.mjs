/**
 * A DISPOSABLE COPY OF THE WORKING TREE, SO A MUTATION HARNESS NEVER EDITS THE REAL ONE.
 *
 * WHY. `mutate3`/`mutate4` overwrite live safety guards in place and restore them afterwards. Twice
 * on 2026-08-28 a run was interrupted and the restore never happened: once leaving the production
 * refusal in `apply-migrations.ts` replaced by `void derivedLabel`, once leaving the endpoint rule
 * replaced by `if (false)`. Both were disabled guards sitting in a repo whose next command writes to
 * a database, and `try/finally` cannot help — a kill skips it.
 *
 * So the harness stops editing the working tree at all. It builds a throwaway git worktree at HEAD,
 * replays the uncommitted work into it, and mutates THERE. A killed run now leaves an orphaned
 * directory, which is litter rather than a disabled guard — and `git worktree prune` collects it.
 *
 * WHAT GETS REPLAYED, because "worktree at HEAD" is not the state under test:
 *   - tracked modifications and deletions, via `git diff HEAD` piped through `git apply`;
 *   - untracked, non-ignored files, copied — `git diff` cannot see them, and this round's work is
 *     mostly new files (whoami.ts, dbDump.ts, classification.ts, four test files);
 *   - `node_modules`, as a directory junction: vitest and tsx must resolve from somewhere, and
 *     copying it would cost minutes per run.
 *
 * NOT replayed, deliberately: `.env.local`. It holds real credentials for the production project,
 * and nothing under `scripts/` needs it — every CLI test builds its own temp cwd with its own
 * `.env.local`. A scratch tree that carries production credentials is a worse trade than a test
 * that fails loudly for want of them.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function git(repo, args, options = {}) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', shell: false, ...options });
  if (r.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return `${r.stdout ?? ''}`;
}

/**
 * Returns the scratch worktree path. Call `removeScratchTree` in a `finally` — and note that even
 * if that never runs, the real working tree is untouched, which is the whole point.
 */
export function createScratchTree(repo) {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-tree-'));
  const tree = join(dir, 'repo');

  git(repo, ['worktree', 'add', '--detach', '--no-checkout', tree, 'HEAD']);
  git(repo, ['-C', tree, 'checkout', 'HEAD', '--', '.'], { cwd: repo });

  // 1 — tracked changes, including the staged deletions.
  const patch = git(repo, ['diff', 'HEAD']);
  if (patch.trim()) {
    const patchFile = join(dir, 'uncommitted.patch');
    writeFileSync(patchFile, patch);
    git(tree, ['apply', '--whitespace=nowarn', patchFile]);
  }

  // 2 — untracked, non-ignored files. Most of this round's work is here, and `git diff` is blind
  //     to all of it: a harness that skipped this step would mutate code the tests never import.
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard'])
    .split('\n').map((l) => l.trim()).filter(Boolean);
  for (const rel of untracked) {
    const dest = join(tree, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(repo, rel), dest);
  }

  // 3 — node_modules, junctioned rather than copied.
  const link = join(tree, 'node_modules');
  if (!existsSync(link)) {
    const r = spawnSync('cmd', ['/c', 'mklink', '/J', link, join(repo, 'node_modules')], {
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`could not junction node_modules: ${r.stderr || r.stdout}`);
  }

  return { dir, tree, untracked: untracked.length };
}

export function removeScratchTree(repo, scratch) {
  if (!scratch) return;
  // The junction goes first: `rm -rf` on a junction can otherwise walk into the real node_modules.
  const link = join(scratch.tree, 'node_modules');
  if (existsSync(link)) spawnSync('cmd', ['/c', 'rmdir', link], { encoding: 'utf8' });
  git(repo, ['worktree', 'remove', '--force', scratch.tree], { allowFailure: true });
  rmSync(scratch.dir, { recursive: true, force: true });
  git(repo, ['worktree', 'prune'], { allowFailure: true });
}
