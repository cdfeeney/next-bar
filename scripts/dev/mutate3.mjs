import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { createScratchTree, removeScratchTree } from './scratch-tree.mjs';

/**
 * THIS HARNESS NEVER EDITS THE WORKING TREE.
 *
 * It used to overwrite live guards in place and restore them afterwards. Twice on 2026-08-28 a run
 * was interrupted and the restore never happened — once leaving the production refusal disabled in
 * apply-migrations.ts, once leaving the endpoint rule as `if (false)` — in a repo whose next
 * command writes to a database. `try/finally` does not survive a kill, so the fix is not a better
 * restore: it is having nothing to restore. Every mutation below lands in a throwaway git worktree
 * built from HEAD plus the uncommitted work, and a killed run leaves an orphaned directory instead
 * of a disabled guard.
 *
 * Paths are RELATIVE now, resolved against the scratch tree at use time.
 */
const REPO = 'D:/projects/next-bar';
const GUARD = 'scripts/lib/migration-target-guard.ts';
const RUNNER = 'scripts/apply-migrations.ts';
const BOOT = 'scripts/lib/catalogBootstrap.ts';
const WHOAMI = 'scripts/db-whoami.mts';

// EVERY script suite, not a chosen five. The round-3 MEDIUMs live in apply-migration-target-guard
// and check-migration-ledger, whose suites were outside the old list — so a mutation there could not
// have gone red no matter how well it was pinned.
const SUITES = ['scripts/'];

const LEGACY = 'scripts/apply-migration-target-guard.ts';
const DBDUMP = 'scripts/lib/dbDump.ts';
const RESET = 'scripts/db-reset-staging.mts';
const LEDGER = 'scripts/check-migration-ledger.ts';

/** Set once the scratch tree exists; every read and write below goes through it. */
let TREE = REPO;
const abs = (f) => join(TREE, f);
const src = (f) => readFileSync(abs(f), 'utf8');
const line = (f, needle) => src(f).split('\n').find((l) => l.includes(needle));

const MUTATIONS = [
  {
    name: 'RULE: pg is the authority — go back to trusting the URL authority',
    file: GUARD,
    from: '  const ref = byUser ?? byHost;',
    to: '  const ref = (() => { try { const u = new URL(connectionString);'
      + ' return refFromUser(decodeURIComponent(u.username || "")) ?? refFromHost(u.hostname); }'
      + ' catch { return byUser ?? byHost; } })();',
  },
  {
    name: 'RULE: the authority may not contradict pg — stop comparing',
    file: GUARD,
    from: '    if (authorityRef && authorityRef !== ref) {',
    to: '  if (false) {',
  },
  // RETIRED — 'RULE: pg resolved user and host must name ONE project'.
  //
  // It went NOT PINNED the moment round 4's endpoint rule landed, and the reason is redundancy,
  // not missing coverage. The endpoint rule forces pg's effective host to EQUAL the authority's,
  // so `byHost` and the authority's host-ref are now the same value and the two checks refuse
  // exactly the same payloads; disabling either alone changes no verdict. Its old payload
  // (`?host=` pointing elsewhere) is also caught earlier now, by the endpoint rule itself.
  //
  // The check STAYS in the guard — it is the cheaper and more direct statement of the rule — but a
  // matrix row that can only ever print NOT PINNED teaches nothing, and leaving one there trains
  // the reader to skim past exactly the words that should stop them. The behaviour is pinned in
  // target-spoofing.test.ts under 'a connection string whose two halves name different projects'.
  {
    name: 'RULE: a declared production ref is MANDATORY',
    file: GUARD,
    from: '  if (!classification.productionRef) {',
    to: '  if (false) {',
  },
  {
    name: 'RULE: a ref in two lists is a refusal',
    file: GUARD,
    from: '  if ([...staging, ...development].includes(classification.productionRef)) {',
    to: '  if (false) {',
  },
  {
    name: 'RULE: the label may not contradict the ref',
    file: GUARD,
    get from() { return line(GUARD, 'value.trim().toLowerCase() !== derived'); },
    get to() { return this.from.replace(/if \(.*\) \{/, 'if (false) {'); },
  },
  {
    name: 'WIRING: delete the bootstrap guard call in apply-migrations.ts',
    file: RUNNER,
    from: '    assertNonProductionBootstrapTarget({ environmentLabel: derivedLabel });',
    to: '    void derivedLabel;',
  },
  {
    name: 'WIRING: apply-migrations reads the classification from process.env instead of the file',
    file: RUNNER,
    from: '    const bootstrapClassification = readClassification();',
    to: '    const bootstrapClassification = {'
      + ' productionRef: process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? null,'
      + ' stagingRefs: (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? "").split(/[,\s]+/).filter(Boolean),'
      + ' developmentRefs: (process.env.NEXT_BAR_DEVELOPMENT_PROJECT_REFS ?? "").split(/[,\s]+/).filter(Boolean) };',
  },
  {
    name: 'RULE: only staging/development may be bootstrapped',
    file: BOOT,
    from: "  if (!['staging', 'development'].includes(target.environmentLabel ?? '')) {",
    to: '  if (false) {',
  },
  {
    name: 'WIRING: db:whoami stops turning a guard refusal into exit 2',
    file: WHOAMI,
    from: '  if (error instanceof TargetRefusal) fail(`REFUSED: ${error.message}`, 2);',
    to: '  if (error instanceof TargetRefusal) fail(`could not connect: ${error.message}`, 1);',
  },
  {
    name: 'RULE: a DECLARED ref must be well-formed (round 3, CRITICAL R3-1)',
    file: GUARD,
    from: '    if (!PROJECT_REF.test(ref)) {',
    to: '    if (false) {',
  },
  {
    name: 'RULE: staging and development may not overlap (round 3, R3-4)',
    file: GUARD,
    from: '  if (inBoth.length > 0) {',
    to: '  if (false) {',
  },
  {
    name: 'RULE: the libpq environment is refused (round 3, CRITICAL R3-2)',
    file: GUARD,
    from: '  assertNoLibpqEnvironment();',
    to: '  void 0;',
  },
  {
    name: 'RULE: identity is the CLIENT, not the URL — take the host from the authority again',
    file: GUARD,
    from: '  const resolvedHost = resolved.host ?? null;',
    to: '  const resolvedHost = (() => { try { return new URL(connectionString).hostname || null; }'
      + ' catch { return resolved.host ?? null; } })();',
  },
  // RETIRED — 'RULE: BOTH halves of the authority are compared (round 3, R3-5)'.
  //
  // Round 4's endpoint rule requires pg's effective host to EQUAL the authority's host, so both
  // halves of the host comparison now read one string and can never disagree. Collapsing them
  // changes no verdict, and a row that can only ever report NOT PINNED teaches nothing. The check
  // stays in the guard as defence in depth if the endpoint rule is ever relaxed; the AUTHORITY
  // comparison itself is still pinned by the row above it, through the ?user= override.
  {
    name: 'WIRING: the legacy layer reads the classification from process.env again (round 3, R3-6)',
    file: LEGACY,
    from: '    classification = readClassification();',
    to: '    classification = { productionRef: process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? null,'
      + ' stagingRefs: (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? "").split(/[,\s]+/).filter(Boolean) };',
  },
  {
    name: 'RULE: the endpoint refuses libpq startup options (round 4, CRITICAL — options=reference)',
    file: GUARD,
    from: '  if (effective.options.trim()) {',
    to: '  if (false) {',
  },
  {
    name: "RULE: the effective host must match the URL's authority (round 4, HIGH)",
    file: GUARD,
    from: '  if (effectiveHost !== authorityHost) {',
    to: '  if (false) {',
  },
  {
    name: 'RULE: the endpoint must be a Supabase pooler or direct host (round 4, HIGH)',
    file: GUARD,
    from: '  if (!lower.endsWith(POOLER_HOST_SUFFIX) && refFromHost(lower) === null) {',
    to: '  if (false) {',
  },
  {
    name: "RULE: the effective port must match the URL's authority (round 4, HIGH)",
    file: GUARD,
    from: '  if (effectivePort !== authorityPort) {',
    to: '  if (false) {',
  },
  {
    name: 'WIRING: the RESET connects from process.env instead of the certified target (round 4, CRITICAL)',
    file: RESET,
    from: '  const client = new pg.Client({ connectionString: certified.connectionString });',
    to: '  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });',
  },
  {
    name: 'WIRING: check-migration-ledger reads the classification from process.env again (round 4, MEDIUM)',
    file: LEDGER,
    from: '    const classification = readClassification();',
    to: "    const classification = { productionRef: process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? null,"
      + " stagingRefs: (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? '').split(/[,\s]+/).filter(Boolean),"
      + ' developmentRefs: [] };',
  },
  {
    name: 'WIRING: the dump connects from process.env instead of the certified target (round 4, CRITICAL)',
    file: DBDUMP,
    from: '  const client = new pg.Client({ connectionString: certified.connectionString });',
    to: '  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });',
  },
  {
    name: 'WIRING: the guard covers only --bootstrap again (round 4, CRITICAL)',
    file: RUNNER,
    from: "const GUARD_TAG = BOOTSTRAP ? '[bootstrap-guard]' : '[migrate-guard]';",
    to: "const GUARD_TAG = BOOTSTRAP ? '[bootstrap-guard]' : '[migrate-guard]';\nif (!BOOTSTRAP) { /* mutation: the pre-round-4 scope */ } else",
  },
];

function run() {
  const r = spawnSync('npx', ['vitest', 'run', ...SUITES], { cwd: TREE, encoding: 'utf8', shell: true });
  const out = `${r.stdout}${r.stderr}`;
  const failed = [...out.matchAll(/^\s+×\s+(.+?)(?:\s+\d+ms)?$/gm)].map((m) => m[1].trim());
  return { failed, summary: out.match(/Tests\s+.*$/m)?.[0].trim() ?? '(no summary)' };
}

/**
 * THE WORKING TREE THIS HARNESS STARTED FROM.
 *
 * Round 4 (MEDIUM): every mutation below overwrites a live safety guard and restored it only AFTER
 * the test run, with no `finally`. A Ctrl+C, a killed terminal, or a throw inside `run()` in that
 * window left a DISABLED GUARD sitting in the working tree, looking exactly like the real thing —
 * in a repo whose next command writes to a database. The restore is now unconditional, and the
 * tree is compared against this snapshot at the end so a survivor cannot go unnoticed.
 */
function gitStatus() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', shell: true });
  return `${r.stdout ?? ''}`.trim();
}
/** Of the REAL repo. It must be identical at the end, because nothing here should touch it. */
const TREE_BEFORE = gitStatus();

/**
 * REFUSE TO START ON A MUTATED TREE.
 *
 * The `finally` below cannot survive a SIGKILL, and on 2026-08-28 one did not: this harness was
 * killed mid-row and left `assertNonProductionBootstrapTarget` replaced by `void derivedLabel` in
 * apply-migrations.ts — the production refusal, disabled, in a working tree whose next command
 * writes to a database. It was caught only because a test happened to assert on the guard's tag.
 *
 * So the harness now looks before it runs. Every row's replacement text is a signature of its own
 * mutation; if one is already present, something died holding it and NOTHING here should proceed —
 * a second run would "restore" the mutated file as if it were the original.
 */
/**
 * `--only <substring>` runs just the rows whose name contains it (case-insensitive, repeatable).
 * A full matrix is ~35 minutes; re-proving twenty untouched rules to check six changed ones is time
 * spent not reviewing. The pre-flight survivor check below still scans EVERY row, because a
 * leftover mutation from any row is dangerous whether or not this run intends to touch it.
 */
const ONLY = process.argv.reduce((acc, a, i) => (
  a === '--only' && process.argv[i + 1] ? [...acc, process.argv[i + 1].toLowerCase()] : acc
), []);
const SELECTED = ONLY.length === 0
  ? MUTATIONS
  : MUTATIONS.filter((m) => ONLY.some((needle) => m.name.toLowerCase().includes(needle)));
if (ONLY.length > 0) {
  console.log(`=== SUBSET: ${SELECTED.length} of ${MUTATIONS.length} rows ===`);
  for (const m of SELECTED) console.log(`  - ${m.name}`);
  if (SELECTED.length === 0) { console.error('no row matched --only'); process.exit(1); }
}

for (const m of MUTATIONS) {
  if (!m.to || !m.file) continue;
  if (readFileSync(join(REPO, m.file), 'utf8').includes(m.to)) {
    console.error('*** A MUTATION IS ALREADY INSTALLED — a previous run died holding it ***');
    console.error(`    ${m.file}`);
    console.error(`    ${m.to.split('\n')[0]}`);
    console.error('    Restore it from git before running this harness or any database command.');
    process.exit(1);
  }
}

const scratch = createScratchTree(REPO);
TREE = scratch.tree;
console.log(`=== SCRATCH TREE ===\n  ${TREE}\n  ${scratch.untracked} untracked files replayed`);

try {

console.log('=== BASELINE ===');
console.log(run().summary);

for (const m of SELECTED) {
  const { from, to } = m;
  console.log(`\n### ${m.name}`);
  if (!from || !to) { console.log('  SKIPPED — no anchor'); continue; }
  const original = src(m.file);
  if (!original.includes(from)) { console.log('  SKIPPED — anchor not found'); continue; }
  let red;
  try {
    writeFileSync(abs(m.file), original.replace(from, to));
    red = run();
  } finally {
    // Still unconditional, but no longer load-bearing: this is a scratch copy, and the file that
    // matters was never touched.
    writeFileSync(abs(m.file), original);
  }
  const green = run();
  console.log(`  MUTATED : ${red.summary}`);
  for (const f of red.failed) console.log(`    RED: ${f}`);
  if (red.failed.length === 0) console.log('    *** NOT PINNED ***');
  console.log(`  RESTORED: ${green.summary}`);
}

} finally {
  removeScratchTree(REPO, scratch);
}

const TREE_AFTER = gitStatus();
console.log('\n=== WORKING TREE ===');
if (TREE_AFTER === TREE_BEFORE) {
  console.log('  untouched — every mutation happened in the scratch tree');
} else {
  console.log('  *** THE REAL WORKING TREE CHANGED — IT SHOULD NOT HAVE ***');
  console.log('  before:');
  console.log(TREE_BEFORE.split('\n').map((l) => `    ${l}`).join('\n'));
  console.log('  after:');
  console.log(TREE_AFTER.split('\n').map((l) => `    ${l}`).join('\n'));
  process.exitCode = 1;
}
