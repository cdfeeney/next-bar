/**
 * Capability analysis for the repository-owned tier classifier.
 *
 * WHY THIS EXISTS (attended operator decision, 2026-08-08)
 * -------------------------------------------------------
 * The previous tier policy classified changes by PATH ENUMERATION only. Every
 * T0 rule was a literal path, so any new file at an unlisted path landed at T1
 * however destructive — a new `scripts/purge-photos.mjs` calling `unlinkSync`,
 * a new `cleanup-accounts.mts` running `delete from auth.users`, a new admin
 * DELETE route. Adding more globs is whack-a-mole and gives false confidence.
 *
 * The rejected alternative was to fail closed on unknown PATHS. That decays:
 * its false-positive rate is set by repo churn, not by risk, so one scaffolding
 * tool or bulk rename produces hundreds of T0 classifications at once.
 * Operators then experience false positives continuously and false negatives
 * never, and the locally rational response is warn-not-deny, then an allowlist,
 * then a wildcard — an enumeration file with worse provenance than the one it
 * replaced.
 *
 * So we fail closed on CAPABILITY instead: classify by what a change can DO,
 * regardless of where it lives. A new fixture has no capabilities and stays
 * cheap, so codegen storms page nobody. A new deletion script has them wherever
 * it is put, so a rename cannot hide it.
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { matchesAnyGlob, normalizePath } from './tier-glob.mjs';

/** Tier ordering. Higher rank always wins; nothing may lower a floor. */
export const TIER_RANK = { T2: 0, T1: 1, T0: 2 };
export const RANK_TIER = ['T2', 'T1', 'T0'];

/** Return the higher of two tiers. */
export function maxTier(a, b) {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * Baked-in PATH floors: files whose ROLE is high-risk no matter what they
 * contain, so content scanning cannot clear them. These are not read from
 * `.claude/tier-map.json` — deleting a glob there must not weaken them.
 *
 * This is the one place path matters for escalation. It is intentionally small
 * and role-based, not an enumeration of every dangerous file.
 */
export const BAKED_PATH_FLOORS = [
  // --- The tier policy and its enforcement grade themselves. A change here must
  // never be graded by a (possibly weakened) version of itself.
  { glob: '.claude/**', tier: 'T0', capability: 'agent-policy' },
  { glob: 'AGENTS.md', tier: 'T0', capability: 'agent-policy' },
  { glob: 'CLAUDE.md', tier: 'T0', capability: 'agent-policy' },
  { glob: 'scripts/tier-classify.mjs', tier: 'T0', capability: 'tier-classifier' },
  { glob: 'scripts/lib/tier-*.mjs', tier: 'T0', capability: 'tier-classifier' },
  // The whole enforcement directory, not just `tier-*`: the RED proof lives
  // here too, and deleting it would silently turn the adversarial suite into
  // coverage theater.
  { glob: 'scripts/__tests__/**', tier: 'T0', capability: 'tier-enforcement-test' },
  // Feeds the gate its input. A one-line edit making this print nothing would
  // make every subsequent change classify as "no paths given" — a green gate
  // that inspected nothing.
  { glob: 'scripts/changed-paths.mjs', tier: 'T0', capability: 'tier-classifier' },

  // --- CI and release behaviour: a workflow edit can delete the gate that
  // protects everything else, or add a step that reads deployment secrets.
  { glob: '.github/workflows/**', tier: 'T0', capability: 'ci-release' },
  { glob: 'fastlane/**', tier: 'T0', capability: 'ci-release' },
  { glob: '**/deploy*.sh', tier: 'T0', capability: 'ci-release' },
  { glob: '**/deploy*.mjs', tier: 'T0', capability: 'ci-release' },
  { glob: '**/release*.sh', tier: 'T0', capability: 'ci-release' },
  { glob: '**/release*.mjs', tier: 'T0', capability: 'ci-release' },

  // --- Supply chain: a dependency addition executes arbitrary install scripts.
  { glob: 'package.json', tier: 'T0', capability: 'dependency-manifest' },
  { glob: 'package-lock.json', tier: 'T0', capability: 'dependency-manifest' },
  { glob: 'npm-shrinkwrap.json', tier: 'T0', capability: 'dependency-manifest' },
  { glob: 'yarn.lock', tier: 'T0', capability: 'dependency-manifest' },
  { glob: 'pnpm-lock.yaml', tier: 'T0', capability: 'dependency-manifest' },

  // --- Schema and privilege surfaces against live user data.
  { glob: 'supabase/migrations/**', tier: 'T0', capability: 'migration' },
  { glob: 'supabase/schema.sql', tier: 'T0', capability: 'migration' },
  { glob: 'supabase/functions/**', tier: 'T0', capability: 'edge-function' },

  // --- Un-gateable request-path controls: these run BEFORE any per-route check.
  { glob: 'src/middleware.ts', tier: 'T0', capability: 'request-middleware' },
  { glob: 'next.config.js', tier: 'T0', capability: 'request-middleware' },
  { glob: 'next.config.ts', tier: 'T0', capability: 'request-middleware' },
  { glob: 'next.config.mjs', tier: 'T0', capability: 'request-middleware' },

  // --- Environment/credential material. `.env.example` and friends are
  // committed TEMPLATES holding placeholders, not secrets; they are reviewed at
  // the default tier rather than floored, so adding a documented config key
  // does not fire the T0 panel.
  {
    glob: '.env',
    tier: 'T0',
    capability: 'credential-handling',
  },
  {
    glob: '.env.*',
    tier: 'T0',
    capability: 'credential-handling',
    except: ['.env.example', '.env.sample', '.env.template'],
  },
];

/**
 * Extensions that cannot execute, so text found inside them is prose, not
 * capability.
 *
 * This is the difference between a file that DOES something and a file that
 * DESCRIBES something. A nightlog quoting `delete from auth.users`, or a
 * runbook showing an `rm -rf`, has no more power than a screenshot of one.
 * Escalating those to T0 is how a gate acquires a continuous false-positive
 * rate — operators then meet false positives daily and true positives never,
 * and the gate gets switched off. Measured on this repository, treating prose
 * as capability put 15 documentation files at T0.
 *
 * Agent policy is the deliberate exception and is handled by BAKED_PATH_FLOORS
 * above: `AGENTS.md`, `CLAUDE.md` and `.claude/**` are instructions a coding
 * agent follows, so they CAN cause action and stay T0 by path.
 */
export const NON_EXECUTABLE_GLOBS = ['**/*.md', '**/*.txt', '**/*.snap'];

/**
 * Paths that are demonstrably inert: they carry no executable capability, so a
 * NEW one must NOT become T0 merely because it is unlisted. This is what keeps
 * capability-based fail-closed from degenerating into path-based fail-closed.
 *
 * Content is still scanned — an "inert" path that actually contains a
 * capability signature is escalated anyway (see `analyzePath`).
 */
export const INERT_PATH_GLOBS = [
  'docs/**',
  '**/*.md',
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/*.txt',
  '**/*.snap',
];

/** Binary/asset extensions we cannot text-scan but which carry no code capability. */
export const INERT_BINARY_GLOBS = [
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.webp',
  '**/*.ico',
  '**/*.woff',
  '**/*.woff2',
  '**/*.ttf',
  '**/*.otf',
  '**/*.mp4',
  '**/*.pdf',
];

/**
 * Content capability signatures.
 *
 * Each entry floors a change at `tier` when its pattern appears in the file.
 * T0 means irreversible destruction, privilege escalation, or credential
 * exposure — the things that end a project. T1 means "must be reviewed" but is
 * recoverable.
 *
 * The T1 entries matter as much as the T0 ones: `fetch(` appears in ordinary UI
 * code, so flooring network egress at T0 would escalate half the repository and
 * produce exactly the alert fatigue this design exists to avoid.
 */
export const CAPABILITY_SIGNATURES = [
  // ---------- T0: irreversible or privilege-granting ----------
  {
    name: 'destructive-sql',
    tier: 'T0',
    pattern:
      /\b(?:drop\s+(?:table|schema|database|policy|function|trigger)|truncate\s+table|delete\s+from|alter\s+table\s+\S+\s+drop)\b/i,
    note: 'destroys or drops persistent data',
  },
  {
    name: 'destructive-data-client',
    tier: 'T0',
    // Raw SQL is not the only way to destroy rows. The Supabase/PostgREST
    // idiom is `.from('bars').delete().eq(...)`, and a route exporting a
    // DELETE handler is a destructive endpoint by definition — neither
    // contains the string "delete from".
    //
    // `.delete()` requires EMPTY parentheses on purpose: `Map.delete(key)` and
    // `set.delete(x)` take an argument, so ordinary collection code does not
    // match. `.remove(` is likewise anchored to the `.from(...).remove(`
    // storage idiom, because a bare `.remove(` would match every
    // `classList.remove('open')` in the UI.
    pattern:
      /(?:\.delete\s*\(\s*\)|\.from\s*\([^)]*\)\s*\.remove\s*\(|\bexport\s+(?:async\s+)?function\s+DELETE\s*\()/,
    note: 'deletes rows or stored objects through a data client, or exposes a DELETE handler',
  },
  {
    name: 'privilege-change',
    tier: 'T0',
    pattern:
      /\b(?:grant\s+(?:all|select|insert|update|delete|usage|execute|references)|revoke\s+|create\s+policy|alter\s+policy|drop\s+policy|enable\s+row\s+level\s+security|disable\s+row\s+level\s+security)\b/i,
    note: 'changes database privileges or row-level security',
  },
  {
    name: 'service-role',
    tier: 'T0',
    pattern:
      /(?:service_role|SERVICE_ROLE_KEY|auth\.admin|\.admin\.(?:deleteUser|createUser|updateUserById|generateLink|listUsers))/,
    note: 'bypasses row-level security or administers accounts',
  },
  {
    name: 'destructive-filesystem',
    tier: 'T0',
    pattern:
      /(?:\bfs\.(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\b|\b(?:unlinkSync|rmSync|rmdirSync)\s*\(|\brimraf\b|\brm\s+-rf\b)/,
    note: 'deletes files with no undo',
  },
  {
    name: 'credential-handling',
    tier: 'T0',
    // NEXT_PUBLIC_* is publishable by definition and is excluded — including it
    // would floor most of the app at T0 and destroy the signal.
    pattern:
      /process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]*(?:SECRET|PRIVATE_KEY|SERVICE_ROLE|PASSWORD|DATABASE_URL|ACCESS_TOKEN|API_KEY)[A-Z0-9_]*/,
    note: 'reads secret credentials from the environment',
  },

  // ---------- T1: must be reviewed, but recoverable ----------
  {
    name: 'network-egress',
    tier: 'T1',
    pattern: /(?:\bfetch\s*\(|\baxios\b|\bhttps?\.request\s*\(|\bXMLHttpRequest\b)/,
    note: 'sends or receives data over the network',
  },
  {
    name: 'database-access',
    tier: 'T1',
    pattern: /(?:\bcreateClient\s*\(|\bsupabase\b|\bnew\s+Pool\s*\(|\bclient\.query\s*\()/,
    note: 'reads or writes the database',
  },
  {
    name: 'auth-session',
    tier: 'T1',
    pattern: /\b(?:signInWith[A-Za-z]*|signOut|getSession|setSession|getUser)\s*\(/,
    note: 'handles authentication sessions',
  },
];

/**
 * Detect the capabilities present in a blob of source text.
 *
 * @param {string} text
 * @returns {Array<{name:string, tier:string, note:string}>}
 */
export function detectCapabilities(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = [];
  for (const sig of CAPABILITY_SIGNATURES) {
    if (sig.pattern.test(text)) {
      found.push({ name: sig.name, tier: sig.tier, note: sig.note });
    }
  }
  return found;
}

/** The highest baked-in PATH floor for a path, or null. */
export function bakedFloorFor(path) {
  const p = normalizePath(path);
  let floor = null;
  for (const rule of BAKED_PATH_FLOORS) {
    if (!matchesAnyGlob([rule.glob], p)) continue;
    if (rule.except && matchesAnyGlob(rule.except, p)) continue;
    if (!floor || TIER_RANK[rule.tier] > TIER_RANK[floor.tier]) floor = rule;
  }
  return floor;
}

/**
 * True when the file cannot execute, so its text is prose rather than
 * capability. Note this is decided by EXTENSION, not by directory: a
 * `docs/purge.mjs` is still scanned, because putting a script under `docs/`
 * must not launder it.
 */
export function isNonExecutable(path) {
  return matchesAnyGlob(NON_EXECUTABLE_GLOBS, path) !== null || isInertBinary(path);
}

/** True when the path is inert by shape (docs, fixtures, plain text). */
export function isInertPath(path) {
  return matchesAnyGlob(INERT_PATH_GLOBS, path) !== null;
}

/** True when the path is a binary asset we cannot text-scan. */
export function isInertBinary(path) {
  return matchesAnyGlob(INERT_BINARY_GLOBS, path) !== null;
}
