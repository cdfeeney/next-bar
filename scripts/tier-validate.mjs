#!/usr/bin/env node
/**
 * tier-validate.mjs (goal g-8354588a) — Windows-portable wrapper.
 *
 * package.json previously piped `git ls-files` straight into
 * `~/.claude/bin/tier-classify.mjs`; cmd.exe (npm's script shell on
 * Windows) does not expand `~`, so node resolved a literal "~" path and
 * died with MODULE_NOT_FOUND (proven overnight 2026-08-05, Gate 1).
 * Resolve the harness directory explicitly instead: CLAUDE_CONFIG_DIR
 * when set (the same override the harness's own tooling honors),
 * os.homedir()/.claude otherwise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `||`, not `??`: a set-but-EMPTY CLAUDE_CONFIG_DIR must fall through to
// the home default, matching the harness's own handling of this variable
// (bash `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` and the security hook's
// falsy check) — `??` would resolve the classifier against a relative
// "bin/..." path (santa: Fable).
const harnessRoot =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const classifier = path.join(harnessRoot, 'bin', 'tier-classify.mjs');

if (!existsSync(classifier)) {
  console.error(`tier-validate: classifier not found at ${classifier}`);
  process.exit(2);
}

const ls = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
// `.error` is how spawnSync reports a child that never LAUNCHED (e.g. git
// missing from PATH: ENOENT, status null) — without this check the real
// cause is discarded for a generic message (santa: Fable).
if (ls.error) {
  console.error(`tier-validate: ${ls.error.message}`);
  process.exit(1);
}
if (ls.status !== 0) {
  console.error(ls.stderr?.trim() || 'tier-validate: git ls-files failed');
  process.exit(ls.status ?? 1);
}

const run = spawnSync(process.execPath, [classifier, '--validate'], {
  input: ls.stdout,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (run.error) {
  console.error(`tier-validate: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
