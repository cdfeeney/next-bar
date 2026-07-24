/**
 * B5c-3 review-mining, step 3: apply CONFIRMED tag changes to the
 * hand-authored catalog files.
 *
 * Input JSON: [{ "barId": "...", "action": "add"|"remove", "tag": "..." }]
 * (the workflow's confirmed-high `apply` list — verify + confidence
 * gating happen upstream, this tool only executes).
 *
 * Dry-run by default (prints the plan); `--write` edits the files.
 * All-or-nothing: any unlocatable bar/tag aborts before a single file is
 * written, so a stale input list can't half-apply. (A crash mid-write can
 * still leave some files updated — the catalog files are git-tracked, so
 * `git checkout -- src/lib` is the recovery path; run from a clean tree.)
 *
 * Run: npx tsx scripts/review-mining-apply.mts <changes.json> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTagChange, type TagAction } from '../src/lib/tagPatch';
import { TAG_VOCABULARY } from '../src/lib/catalog';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const BAR_FILES = [
  'bars.ts',
  'bars.extra.ts',
  'bars.expansion.ts',
  'bars.expansion2.ts',
  'bars.expansion3.ts',
].map((f) => path.join(scriptDir, '..', 'src', 'lib', f));

type Change = { barId: string; action: TagAction; tag: string };

const [, , inputPath, writeFlag] = process.argv;
if (!inputPath) {
  console.error('usage: npx tsx scripts/review-mining-apply.mts <changes.json> [--write]');
  process.exit(2);
}
const write = writeFlag === '--write';

const parsed: unknown = JSON.parse(readFileSync(inputPath, 'utf8'));
// Shape guard at the parse boundary (Opus review): reject malformed input
// with a clear message instead of confusing downstream errors.
if (
  !Array.isArray(parsed) ||
  !parsed.every(
    (c) =>
      typeof c === 'object' && c !== null &&
      typeof (c as Change).barId === 'string' &&
      typeof (c as Change).tag === 'string' &&
      typeof (c as Change).action === 'string',
  )
) {
  console.error('ABORT: input must be an array of {barId, action, tag} string objects');
  process.exit(1);
}
const changes = parsed as Change[];
const badTag = changes.find((c) => !(TAG_VOCABULARY as readonly string[]).includes(c.tag));
if (badTag) {
  console.error(`ABORT: '${badTag.tag}' (${badTag.barId}) is not in TAG_VOCABULARY`);
  process.exit(1);
}
// Validate at the parse boundary (DeepSeek review): with a typo'd action
// the add/else branch in applyTagChange would silently treat it as a
// remove of a coincidentally-present tag.
const badAction = changes.find((c) => c.action !== 'add' && c.action !== 'remove');
if (badAction) {
  console.error(`ABORT: action '${badAction.action}' (${badAction.barId}) is not add|remove`);
  process.exit(1);
}

// Transform every file in memory first — nothing is written unless ALL
// changes locate cleanly.
const sources = new Map(BAR_FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const applied: Array<Change & { file: string }> = [];

for (const change of changes) {
  // Exactly-one-file pre-flight (DeepSeek review): a bar id duplicated
  // across catalog files would otherwise get patched only where it is
  // found first, leaving a stale twin. (bars.test.ts would also catch the
  // dup — but only AFTER files were written.)
  const containing = BAR_FILES.filter((f) =>
    (sources.get(f) as string).includes(`id: '${change.barId}',`),
  );
  if (containing.length !== 1) {
    console.error(
      `ABORT: bar '${change.barId}' found in ${containing.length} catalog files (expected exactly 1)`,
    );
    process.exit(1);
  }
  const file = containing[0];
  sources.set(
    file,
    applyTagChange(sources.get(file) as string, change.barId, change.action, change.tag),
  );
  applied.push({ ...change, file: path.basename(file) });
}

for (const a of applied) {
  console.log(`${a.action === 'add' ? '+' : '-'} ${a.barId}: ${a.tag}  (${a.file})`);
}
console.log(`\n${applied.length} changes across ${new Set(applied.map((a) => a.file)).size} files`);

if (write) {
  for (const [file, text] of sources) {
    if (text !== readFileSync(file, 'utf8')) writeFileSync(file, text);
  }
  console.log('WRITTEN.');
} else {
  console.log('Dry run — pass --write to apply.');
}
