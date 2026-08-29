import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { createScratchTree, removeScratchTree } from './scratch-tree.mjs';

// Mutates a throwaway worktree, never the checkout — see scratch-tree.mjs for why.
const REPO = 'D:/projects/next-bar';
const RELATIVE = 'scripts/db-reset-staging.mts';
let TREE = REPO;
const FILE = () => join(TREE, RELATIVE);
const SUITE = 'scripts/target-identity.guard.test.ts';

const FIXED = `  let productionRef: string;
  try {
    productionRef = readClassification().productionRef as string;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }`;

// The code exactly as it stood before this fix: its own reader, and the short-circuit that made an
// absent declaration disable the production refusal entirely.
const OLD = `  const envLocalPath = path.join(process.cwd(), '.env.local');
  const productionRef = existsSync(envLocalPath)
    ? (parseEnv(readFileSync(envLocalPath)).NEXT_BAR_PRODUCTION_PROJECT_REF ?? '').trim().toLowerCase()
    : '';`;

function run() {
  const r = spawnSync('npx', ['vitest', 'run', SUITE], { cwd: TREE, encoding: 'utf8', shell: true });
  const out = `${r.stdout}${r.stderr}`;
  return {
    failed: [...out.matchAll(/^\s+×\s+(.+?)(?:\s+\d+ms)?$/gm)].map((m) => m[1].trim()),
    summary: out.match(/Tests\s+.*$/m)?.[0].trim() ?? '(no summary)',
  };
}

const scratch = createScratchTree(REPO);
TREE = scratch.tree;
console.log(`=== SCRATCH TREE ===\n  ${TREE}`);

let red;
let green;
try {
const original = readFileSync(FILE(), 'utf8');
if (!original.includes(FIXED)) { console.log('ANCHOR MISSING'); process.exit(1); }

console.log('=== BASELINE (fixed) ===');
console.log(run().summary);

// Restore the old private reader, plus the guarded comparison it fed.
let mutated = original.replace(FIXED, OLD);
mutated = mutated.replace('  if (ref === productionRef) {', '  if (productionRef && ref === productionRef) {');
// The rewritten reset script no longer imports dotenv at all — it connects with the certified
// target instead of reloading the environment — so the old reader's import is added standalone.
mutated = mutated.replace(
  "import pg from 'pg';",
  "import pg from 'pg';\nimport { parse as parseEnv } from 'dotenv';",
);
try {
  writeFileSync(FILE(), mutated);
  red = run();
} finally {
  writeFileSync(FILE(), original);
}
green = run();
} finally {
  removeScratchTree(REPO, scratch);
}

console.log('\n### MUTATION: private classification reader + `productionRef &&` short-circuit');
console.log(`  MUTATED : ${red.summary}`);
for (const f of red.failed) console.log(`    RED: ${f}`);
if (red.failed.length === 0) console.log('    *** NOT PINNED ***');
console.log(`  RESTORED: ${green.summary}`);
