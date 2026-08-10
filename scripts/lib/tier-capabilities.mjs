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
  // `**/` on purpose (attended operator decision, 2026-08-08): instruction-bearing
  // AGENTS.md and CLAUDE.md files are capability-bearing policy, and BOTH Codex
  // and Claude Code read NESTED ones — `src/AGENTS.md` governs work under `src/`
  // exactly as the root file governs the repository. Anchoring these at the root
  // only meant an agent instruction that says "skip the e2e gate" classified T2
  // (inert documentation) as soon as it was written one directory down.
  { glob: '**/AGENTS.md', tier: 'T0', capability: 'agent-policy' },
  { glob: '**/CLAUDE.md', tier: 'T0', capability: 'agent-policy' },
  // THE POLICY LIST IS NOT A TWO-NAME LIST, which is the round-10 correction.
  // The architecture lane's point was that a boundary defined by two filenames
  // fails silently as agent tooling diversifies: the instruction file of the
  // NEXT tool a contributor adopts is executable policy that would classify T2
  // as inert documentation. These floors are DORMANT — none of these paths
  // exists here today — and that is the point: they are in place before the
  // file that needs them is written. `validateTierMap` checks the project tier
  // MAP for dead rules, not these baked floors, so a dormant floor costs
  // nothing and cannot fail the gate.
  { glob: '**/AGENT.md', tier: 'T0', capability: 'agent-policy' },
  { glob: '**/GEMINI.md', tier: 'T0', capability: 'agent-policy' },
  { glob: '**/.cursorrules', tier: 'T0', capability: 'agent-policy' },
  { glob: '**/.windsurfrules', tier: 'T0', capability: 'agent-policy' },
  { glob: '**/.clinerules', tier: 'T0', capability: 'agent-policy' },
  { glob: '.cursor/**', tier: 'T0', capability: 'agent-policy' },
  { glob: '.windsurf/**', tier: 'T0', capability: 'agent-policy' },
  { glob: '.github/copilot-instructions.md', tier: 'T0', capability: 'agent-policy' },
  // WHAT THIS STILL DOES NOT CATCH, stated rather than implied: a section of an
  // ordinary README addressed to coding agents. The obvious remedy — floor any
  // markdown whose prose contains an agent-directed imperative — was MEASURED
  // against this repository's 44 tracked markdown files before being rejected:
  // it floors four genuine documents (a blueprint, a continuation note, a night
  // log and a work ledger) that merely DESCRIBE agent work. That is the same
  // failure that once put 15 documentation files at T0. Instructions an agent
  // must follow belong in a file whose role says so.
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
  // The test runner's config decides whether the enforcement suite runs at all.
  // Flooring the enforcement test directory while leaving this at T1 was a gap:
  // deleting the scripts glob from the vitest include list silences the entire
  // tier suite — and every other test — just as effectively as deleting them.
  { glob: 'vitest.config.*', tier: 'T0', capability: 'tier-enforcement-test' },
  { glob: 'playwright.config.ts', tier: 'T0', capability: 'tier-enforcement-test' },
  { glob: 'tsconfig.json', tier: 'T0', capability: 'tier-enforcement-test' },

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
 * INSTRUCTION-BEARING MARKDOWN IS THE DELIBERATE EXCEPTION, and it is a scoping
 * decision the operator resolved on 2026-08-08 after two reviewers disagreed:
 * one argued that in a repository whose main contributor is a document-following
 * agent, prose IS capability and the exemption is unsound; the other judged the
 * carve-out sufficient. The resolution: `AGENTS.md`, `CLAUDE.md` (at any depth)
 * and `.claude/**` are capability-bearing T0 policy because an agent executes
 * them, while ORDINARY non-instruction documentation stays inert. That line is
 * drawn by ROLE — see BAKED_PATH_FLOORS above — and not by scanning prose,
 * because scanning prose is what put 15 real documentation files at T0.
 */
export const NON_EXECUTABLE_GLOBS = ['**/*.md', '**/*.txt'];

/**
 * Extensions that CAN execute. A path under an inert directory keeps the T1
 * baseline if it has one of these.
 *
 * Without this, INERT_PATH_GLOBS handed a T2 (and `skippable`) baseline to
 * anything under a docs or fixtures directory — so `docs/tools/sync.mjs`
 * classified T2/skippable whenever its content matched no signature, while the
 * identical file at `tools/sync.mjs` was T1. That is a path-based downgrade,
 * the precise thing this design forbids: moving a script under a docs
 * directory must not launder it.
 */
export const EXECUTABLE_EXTENSION_GLOBS = [
  '**/*.js',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.jsx',
  '**/*.ts',
  '**/*.mts',
  '**/*.cts',
  '**/*.tsx',
  '**/*.sh',
  '**/*.bash',
  '**/*.ps1',
  '**/*.py',
  '**/*.rb',
  '**/*.sql',
  '**/*.yml',
  '**/*.yaml',
];

/** True when the path can execute, whatever directory it sits in. */
export function isExecutableExtension(path) {
  return matchesAnyGlob(EXECUTABLE_EXTENSION_GLOBS, path) !== null;
}

/**
 * Paths that are demonstrably inert: they carry no executable capability, so a
 * NEW one must NOT become T0 merely because it is unlisted. This is what keeps
 * capability-based fail-closed from degenerating into path-based fail-closed.
 *
 * Content is still scanned — an "inert" path that actually contains a
 * capability signature is escalated anyway (see `classifyOnePath` in
 * `tier-classify-core.mjs`).
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

// ---------------------------------------------------------------------------
// FILESYSTEM DELETION — resolved by binding analysis, not by proximity.
//
// The first version of this detector matched a bare `rm(`/`unlink(` within 200
// CHARACTERS of a `node:fs/promises` specifier. That is a heuristic about
// FORMATTING, not about capability, and it failed on every realistic shape: an
// alias (`import { rm as nuke }`), a namespace (`import * as fsp`), a CJS
// destructure (`const { unlink } = require('fs/promises')`), the unprefixed
// specifier (`'fs/promises'`), and — the common case — a purge loop further
// down a file that imports at the top. Seven realistic deletion scripts were
// measured classifying T1.
//
// Proximity is replaced by resolution: find what the fs module was bound TO,
// then look for a use of that binding anywhere in the file. Distance stops
// mattering because it never should have.
// ---------------------------------------------------------------------------

/** Module specifiers whose deletion functions destroy files with no undo. */
const FS_MODULE_ALTERNATION = '(?:node:)?fs(?:/promises)?|graceful-fs|fs-extra(?:/esm)?';

/** Deletion functions exported by the core fs modules (sync and promise forms). */
const FS_CORE_DELETION_NAMES = ['rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync'];

/** `fs-extra` adds its own irreversible helpers on top of the core names. */
const FS_EXTRA_DELETION_NAMES = [
  ...FS_CORE_DELETION_NAMES,
  'remove',
  'removeSync',
  'emptyDir',
  'emptyDirSync',
];

/** The deletion names a given module specifier can supply. */
function deletionNamesFor(moduleSpecifier) {
  return /^fs-extra/.test(moduleSpecifier) ? FS_EXTRA_DELETION_NAMES : FS_CORE_DELETION_NAMES;
}

/** Escape a captured identifier before it is spliced into a RegExp (`$` is an anchor). */
function escapeForRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const IDENTIFIER = '[A-Za-z_$][A-Za-z0-9_$]*';

/**
 * COMMENT SUPPRESSION HAS BEEN REMOVED. This note is the reason, kept because
 * the obvious next change is to add it back.
 *
 * A commented-out import (`// import { rm } from 'node:fs/promises'`) is not
 * capability, and flooring it at T0 is a false positive. FOUR separate
 * mechanisms were built to suppress it, and independent reviewers broke every
 * one of them the same way — by making the suppressor believe a comment was
 * there when it was not, which SKIPS a real deletion import:
 *
 *   1. blank comment text            — `s.replace(/\/*$/, '')` opened a block
 *                                      comment and erased the rest of the file
 *   2. blank only line-leading ones  — an unterminated `/*` did the same
 *   3. inspect the line prefix       — a URL in a block comment, an escaped
 *                                      quote, and an unterminated quote each
 *                                      manufactured a false `//`
 *   4. fail-closed prefix analysis   — a regex literal (`/[//]/`,
 *                                      `/https:\/\//`) still manufactures one
 *
 * Each fix closed exactly the input the previous reviewer supplied and left the
 * same class open, because `/` is irreducibly ambiguous in JavaScript without a
 * real parser: it begins a regex literal, a division, and two kinds of comment.
 * The architecture lane's verdict on round 2 was that this is divergence, not
 * convergence, and that the cost asymmetry is decisive: the mechanism exists to
 * prevent an over-escalation, and every version of it has instead hidden real
 * destructive code.
 *
 * So there is no suppression. A commented-out deletion import floors T0. That
 * is a false positive we accept, measured at zero occurrences across this
 * repository's 3,866 tracked files, and it is recorded in
 * `docs/ENGINEERING-HARNESS.md`. Nothing in this module removes, rewrites, or
 * ignores any part of the text it scans, so no misparse can hide capability.
 *
 * If you are about to reintroduce suppression: it needs a real tokenizer, not a
 * regex, and a tokenizer belongs in the toolchain rather than in a
 * zero-dependency gate that must run before `npm ci`.
 */

/**
 * Parse one binding clause — `{ rm as nuke, readFile }` (ESM) or
 * `{ rm: nuke }` (CJS destructuring) — into imported/local pairs.
 */
function parseBindingClause(clause) {
  const pairs = [];
  for (const part of String(clause).split(',')) {
    const token = part.trim();
    if (token.length === 0) continue;
    // `{ type rm }` is an inline type-only specifier: erased at compile time, so
    // it holds no runtime capability.
    if (/^type\s+/.test(token)) continue;
    const aliased = new RegExp(`^(${IDENTIFIER})\\s*(?::|\\bas\\b)\\s*(${IDENTIFIER})$`).exec(token);
    if (aliased) {
      pairs.push({ imported: aliased[1], local: aliased[2] });
    } else if (new RegExp(`^${IDENTIFIER}$`).test(token)) {
      pairs.push({ imported: token, local: token });
    }
  }
  return pairs;
}

/**
 * Resolve filesystem-deletion capability by following module bindings.
 *
 * Two rules, and the difference between them is deliberate:
 *
 *   - A NAMED deletion binding (`import { rm }`, `const { unlink } = require`,
 *     `export { rm } from`) counts on IMPORT, with no call site required. A
 *     module that names `unlink` in its import list holds deletion capability
 *     however it later spends it — including forms no call-shaped regex can
 *     see, such as `files.forEach(unlink)` or a re-export. Requiring a matching
 *     call is what reintroduces a distance heuristic through the back door.
 *   - A NAMESPACE or default binding (`import * as fsp`, `const fs =
 *     require('fs')`) requires an actual member call, because importing all of
 *     `fs` is the ordinary way to call `readFile` and flooring that would
 *     escalate a large share of the repository.
 *
 * @param {string} text
 * @returns {{capable: boolean, evidence: string[]}}
 */
export function analyzeFsDeletion(text) {
  const evidence = [];
  if (typeof text !== 'string' || text.length === 0) return { capable: false, evidence };

  // The text is NEVER rewritten and nothing is excluded. See the note above
  // `FS_MODULE_ALTERNATION` on why comment suppression was removed.
  const namespaces = new Set();
  const mod = FS_MODULE_ALTERNATION;
  const q = `['"]`;

  /** Record a binding clause against the module it came from. */
  const recordClause = (clause, moduleSpecifier) => {
    const deletionNames = deletionNamesFor(moduleSpecifier);
    for (const { imported, local } of parseBindingClause(clause)) {
      // `const { promises: fsp } = require('fs')` binds a namespace, not a function.
      if (imported === 'promises') {
        namespaces.add(local);
      } else if (deletionNames.includes(imported)) {
        evidence.push(`imports ${imported} from '${moduleSpecifier}'`);
      }
    }
  };

  // `import <clause> from 'fs…'` / `export <clause> from 'fs…'`.
  // The clause deliberately excludes quotes so it can never swallow the module
  // string, and covers `* as fsp`, `fsp`, `{ rm as nuke }` and `fs, { rm }`.
  const importRe = new RegExp(`\\b(?:import|export)\\s*([^;'"]*?)\\s*from\\s*${q}(${mod})${q}`, 'g');
  for (const match of text.matchAll(importRe)) {
    const [, clause, moduleSpecifier] = match;
    // `import type { rm } from …` is erased at compile time — no runtime binding
    // exists, so it cannot delete anything.
    if (/^\s*type\b/.test(clause)) continue;
    const namespaced = new RegExp(`\\*\\s*as\\s+(${IDENTIFIER})`).exec(clause);
    if (namespaced) namespaces.add(namespaced[1]);
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) recordClause(named[1], moduleSpecifier);
    // A bare leading identifier is a default import — namespace-like in practice.
    const defaulted = new RegExp(`^\\s*(${IDENTIFIER})\\s*(?:,|$)`).exec(clause);
    if (defaulted) namespaces.add(defaulted[1]);
  }

  // `const { unlink } = require('fs/promises')` / `= await import('node:fs/promises')`
  // and `const fse = require('fs-extra')` / `const fsp = require('fs').promises`.
  //
  // THE DECLARATION KEYWORD IS OPTIONAL, which is the round-10 correction. Four
  // lanes independently drove the previous `\b(?:const|let|var)\s+` anchor into
  // missing a real binding, and every one of them is ordinary JavaScript rather
  // than an evasion:
  //
  //   let fsp; fsp = require('fs/promises');          — hoisted declaration
  //   let fse; try { fse = require('fs-extra') } …    — optional dependency
  //   ({ unlink } = require('fs'));                   — destructuring assignment
  //   const fsp = (await import('fs/promises'));      — parenthesized
  //   const fse = flag ? require('fs-extra') : shim;  — conditional
  //
  // So the binding is matched by its ASSIGNMENT rather than by its declaration:
  // an optional keyword, an optional `(`, and an optional non-newline run
  // between `=` and the call, which is what admits the ternary and any other
  // expression prefix. The run cannot cross a line, so it can never reach past
  // the statement it belongs to.
  const requireRe = new RegExp(
    `(?:\\b(?:const|let|var)\\s+)?\\(?\\s*(\\{[^}\\n]*\\}|${IDENTIFIER})\\s*\\)?\\s*=\\s*` +
      `[^\\n=]{0,80}?(?:await\\s+)?(?:import|require)\\s*\\(\\s*${q}(${mod})${q}\\s*\\)`,
    'g',
  );
  for (const match of text.matchAll(requireRe)) {
    const [, binding, moduleSpecifier] = match;
    if (binding.startsWith('{')) recordClause(binding.slice(1, -1), moduleSpecifier);
    else namespaces.add(binding);
  }

  // A CONTINUATION receives the module without ever binding a name in this
  // scope: `import('fs/promises').then(({ rm }) => rm(p))` and
  // `import('fs').then(fs => fs.unlink(p))`. Neither shape has a declaration to
  // anchor on, and both really delete. Rather than parse the callback, the
  // parameter list is read as a binding clause when it destructures, and as a
  // namespace when it is a bare identifier — the same two rules used everywhere
  // else in this function.
  const thenRe = new RegExp(
    `import\\s*\\(\\s*${q}(${mod})${q}\\s*\\)\\s*\\.\\s*then\\s*\\(\\s*(?:async\\s*)?` +
      `(?:\\(\\s*)?(\\{[^}\\n]*\\}|${IDENTIFIER})`,
    'g',
  );
  for (const match of text.matchAll(thenRe)) {
    const [, moduleSpecifier, param] = match;
    if (param.startsWith('{')) recordClause(param.slice(1, -1), moduleSpecifier);
    else namespaces.add(param);
  }

  // A NON-LITERAL module specifier cannot be resolved by a text scan:
  // `const mod = 'node:fs/promises'; const { rm } = require(mod)` binds real
  // deletion capability that every pattern above misses, because each of them
  // requires a quoted specifier. Chasing the variable is value-flow analysis,
  // which this module deliberately does not do — so the answer is to FAIL
  // CLOSED instead. A dynamic specifier alongside any deletion name in the same
  // file is reported as capability; the cost is over-escalating a file that
  // computes a module path and separately mentions `remove`, which is the
  // direction this gate is allowed to be wrong in.
  const dynamicSpecRe = new RegExp(`(?:\\bimport|\\brequire)\\s*\\(\\s*(?!\\s*${q})[^)\\n]{1,120}\\)`, 'g');
  if (dynamicSpecRe.test(text)) {
    const anyDeletionName = new RegExp(`\\b(?:${FS_EXTRA_DELETION_NAMES.map(escapeForRegExp).join('|')})\\b`);
    if (anyDeletionName.test(text)) {
      evidence.push('resolves a module specifier dynamically alongside a deletion name — unanalyzable, failing closed');
    }
  }

  // Inline, with no binding at all: `(await import('node:fs/promises')).rm(dir)`
  // or `require('fs').promises.unlink(f)`.
  const inlineRe = new RegExp(
    `(?:await\\s+import|require)\\s*\\(\\s*${q}(${mod})${q}\\s*\\)\\s*\\)?\\s*(?:\\.\\s*promises\\s*)?\\.\\s*(${IDENTIFIER})\\s*\\(`,
    'g',
  );
  for (const match of text.matchAll(inlineRe)) {
    const [, moduleSpecifier, member] = match;
    if (deletionNamesFor(moduleSpecifier).includes(member)) {
      evidence.push(`calls ${member} on an inline require/import of '${moduleSpecifier}'`);
    }
  }

  // A namespace binding counts when a deletion member is REFERENCED anywhere in
  // the file — not only called. Requiring a call site missed
  // `const nuke = fsp.rm; await nuke(target)`, where the destructive function is
  // extracted to a variable first; chasing that through the variable would be
  // value-flow analysis, but reading the member at all is already the capability.
  // `.promises` is tolerated between the two (`fs.promises.rm`).
  if (namespaces.size > 0) {
    const members = FS_EXTRA_DELETION_NAMES.map(escapeForRegExp).join('|');
    for (const ns of namespaces) {
      const memberRe = new RegExp(
        `\\b${escapeForRegExp(ns)}\\s*(?:\\.\\s*promises\\s*)?\\.\\s*(${members})\\b`,
        'g',
      );
      for (const hit of text.matchAll(memberRe)) {
        evidence.push(`references ${ns}.${hit[1]}`);
        break;
      }
    }
  }

  return { capable: evidence.length > 0, evidence };
}

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
    // `TABLE` is OPTIONAL after TRUNCATE in PostgreSQL: `TRUNCATE users CASCADE`
    // is valid and was missed while `TRUNCATE TABLE users` was caught.
    //
    // The bare form MUST be anchored to real SQL context — a terminating `;`,
    // CASCADE, or RESTART. `truncate` is also a Tailwind utility class, and the
    // unanchored version matched `className="truncate text-sm"`, which put five
    // ordinary React components at T0 in a full-repository sweep. That is the
    // alert-fatigue failure mode this design exists to avoid.
    pattern:
      /(?:\bdrop\s+(?:table|schema|database|policy|function|trigger)\b|\btruncate\s+table\b|\btruncate\s+(?:only\s+)?[a-z_][\w.]*(?:\s*;|\s+cascade\b|\s+restart\b)|\bdelete\s+from\b|\balter\s+table\s+\S+\s+drop\b)/i,
    note: 'destroys or drops persistent data',
  },
  {
    name: 'remote-deploy',
    tier: 'T0',
    // Release-path control was previously matched ONLY by filename convention
    // (**/deploy*.sh, **/release*.mjs), so renaming deploy.sh to ship.sh
    // dropped it to T1 — the exact rename evasion this design claims to close.
    // Detect the mechanism instead of the name.
    pattern:
      /(?:\bscp\s+|\brsync\s+|\bssh\s+\S+\s+(?:sudo\s+)?(?:systemctl|service|docker|pm2)\b|\bdocker\s+push\b|\bnpm\s+publish\b|\bpm2\s+(?:restart|reload)\b)/,
    note: 'moves code onto, or restarts, a deployed environment',
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
    // Three shapes, because ORMs disagree:
    //   `.delete()`                    Supabase/PostgREST — empty parens
    //   `.delete(users).where(...)`    Drizzle — table passed as an arg
    //   `.deleteFrom('person')`        Kysely — no `.delete(` at all
    //   `export const DELETE = ...`    Next.js route handler, both spellings
    // The empty-paren form stays anchored so ordinary `Map.delete(key)` and
    // `set.delete(x)` do not match; the arg form requires a following
    // `.where(`/`.returning(`, which collections never have.
    pattern:
      /(?:\.delete\s*\(\s*\)|\.delete\s*\([^)]*\)\s*\.\s*(?:where|returning)\s*\(|\.deleteFrom\s*\(|\.from\s*\([^)]*\)\s*\.remove\s*\(|\bexport\s+(?:(?:async\s+)?function\s+DELETE\s*\(|const\s+DELETE\s*=))/,
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
    // The pattern covers the shapes that need no import resolution: qualified
    // `fs.` access, an unmistakably destructive call name, a recursive/force
    // options object, and the shell forms. `analyzeFsDeletion` covers everything
    // that depends on WHAT A BINDING RESOLVES TO — aliases, namespaces, CJS
    // destructuring, and calls arbitrarily far from their import.
    //
    // NON-JAVASCRIPT IDIOMS ARE FIRST-CLASS HERE, not an afterthought. Three
    // independent reviewers converged on the same gap: `EXECUTABLE_EXTENSION_GLOBS`
    // declares `.ps1`, `.py`, `.rb` and `.sh` in scope, the operator's primary
    // shell is PowerShell, and yet the only shell form matched was `rm -rf`. A new
    // `scripts/purge-cache.ps1` holding `Remove-Item -Recurse -Force $dir`
    // classified T1 — a destructive change graded low by a first-class idiom, not
    // by the obscure indirection the design openly disclaims.
    //
    // The POSIX branch requires the recursive flag to be a real short-option
    // cluster or `--recursive`, so `npm rm --registry=… pkg` does not match.
    // JavaScript and language-agnostic forms. Case-SENSITIVE on purpose: these
    // are API names, and `.unlink(` is anchored to the argument shapes that
    // actually mean filesystem deletion (`Path(x).unlink()`,
    // `.unlink(missing_ok=True)`) because a bare `.unlink(` matched
    // `graph.unlink(nodeA, nodeB)` in ordinary graph code.
    // ARGV-FORM SPAWN is here rather than in the shell entry below, because it
    // is a JavaScript call and must not be subject to that entry's
    // shell-context gate. `spawn('rm', ['-rf', dir])` deletes exactly as much as
    // `rm -rf dir`, and every shell pattern missed it: they require whitespace
    // after the command word, and here the next character is the closing quote.
    // Found while verifying the shell-context gate, not reported by a lane.
    pattern:
      /(?:\bfs\.(?:promises\.)?(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\b|\b(?:unlinkSync|rmSync|rmdirSync)\s*\(|\b(?:rm|rmdir|unlink)\s*\([^)]*\{[^}]*(?:recursive|force)\s*:\s*true|\brimraf\b|\[System\.IO\.(?:Directory|File)\]::Delete\b|\bshutil\.rmtree\s*\(|\bos\.(?:remove|removedirs|unlink|rmdir)\s*\(|\.unlink\s*\(\s*(?:\)|missing_ok)|\brmtree\s*\(|\bFileUtils\.rm_r?f?\b|\b(?:File|Dir)\.(?:delete|unlink|rmdir)\s*\(|(?:spawn|spawnSync|execFile|execFileSync|Start-Process)\s*\(?\s*['"](?:rm|rmdir|rd|del|erase|Remove-Item)['"])/,
    detect: (text) => analyzeFsDeletion(text).capable,
    note: 'deletes files with no undo',
  },
  {
    // SHELL AND POWERSHELL FORMS, MATCHED CASE-INSENSITIVELY. PowerShell is a
    // case-insensitive language: `remove-item`, `Remove-Item` and `REMOVE-ITEM`
    // are the same cmdlet, and a case-sensitive pattern graded the lowercase
    // spelling T1. `Git rm` likewise had to be excluded case-insensitively.
    //
    // Same capability name as the entry above, so the two are one finding.
    name: 'destructive-filesystem',
    tier: 'T0',
    // THIS ENTRY MATCHES SHELL COMMAND TEXT, so it only applies where shell
    // command text can RUN — see `shellTextIsInert`. Two lanes reproduced the
    // false positive independently: `export const Help = () => <code>rm
    // cache.db</code>` and `export const tip = "Run del /f cache.db"` floored
    // ordinary React components at T0.
    //
    // There is no content-only fix for that, and it is important to say why
    // rather than to try a fifth clever pattern. Inside `<code>` the bytes are
    // IDENTICAL to a real command line, so no rule reading the match or its
    // surroundings can separate them; a line-position rule would have missed
    // `execSync('rm -rf ' + dir)` and `then rm -rf "$dir"`, which is the
    // fail-open treadmill that removed comment suppression from this module.
    // What DOES separate them is the file: a `.tsx` cannot execute a string it
    // merely renders. So the question asked is "can this file run a shell
    // command at all", and it fails closed on every file type that can.
    shellContext: true,
    // EXCLUSIONS USE HORIZONTAL WHITESPACE ONLY. `\s` matches a NEWLINE, so
    // `(?<!\bgit\s{1,8})` suppressed any `rm -rf` whose PREVIOUS line merely
    // ended in the word "git" — and a newline ends a shell command, so that `rm`
    // is an entirely independent destructive statement. `cd /srv/app.git` above
    // `rm -rf objects/old`, or a `# staged via git` comment, graded T1. Three
    // reviewers found it independently; it is also a one-line deliberate
    // evasion. `[ \t]` cannot cross a statement boundary.
    //
    // `git rm` is still excluded (it stages an index removal and with `--cached`
    // never touches the working tree), as are the package managers, whose `rm`
    // subcommand uninstalls a dependency rather than deleting a path.
    //
    // `remove-item` requires a command position: the previous character must not
    // be a word character, quote, hyphen or dot, because
    // `<button data-testid="remove-item">` and `querySelector(".remove-item")`
    // put ordinary React components at T0.
    //
    // THE `get-command` EXCLUSION WAS REMOVED rather than narrowed. It existed so
    // `Get-Command Remove-Item` (naming a cmdlet) would not floor, but
    // `& (Get-Command Remove-Item) $path` INVOKES the cmdlet and deletes, and the
    // exclusion suppressed it. Every exclusion added here has produced a
    // fail-open; naming a cmdlet now over-escalates instead, which is the
    // direction this gate is allowed to be wrong in.
    //
    // A BARE `rm` with no flags still deletes, and so do the PowerShell aliases
    // `ri`, `del` and `erase` with no switches. `rm` is matched on any first
    // argument, with the package managers excluded, because `rm cache.db` and
    // `rm -- "$target"` were both missed by requiring a path-shaped argument.
    pattern:
      /(?:(?<!\b(?:git|npm|pnpm|yarn|bun)[ \t]{1,8})\brm[ \t]+(?:-[a-z]{1,8}[ \t]+)*-[a-z]{0,6}[rf][a-z]{0,6}\b|(?<!\b(?:git|npm|pnpm|yarn|bun)[ \t]{1,8})\brm[ \t]+[^\n]*--(?:recursive|force)\b|(?<!\b(?:git|npm|pnpm|yarn|bun)[ \t]{1,8})\brm[ \t]+(?:--[ \t]+)?(?:["'$~.\/]|[\w.-]+)|(?<!["'\w.-])remove-item\b|\b(?:ri|del|erase)[ \t]+(?:-(?:recurse|force)\b|["'$~.\/])|\b(?:rd|rmdir)[ \t]+\/[sq]\b|\bdel[ \t]+\/[fsq]\b|\bfind[ \t]+[^\n]*[ \t]-delete\b)/i,
    note: 'deletes files with no undo',
  },
  {
    name: 'credential-handling',
    tier: 'T0',
    // NEXT_PUBLIC_* is publishable by definition and is excluded — including it
    // would floor most of the app at T0 and destroy the signal.
    //
    // Three access shapes, because only dot-access was covered before:
    //   process.env.DATABASE_URL
    //   process.env['DATABASE_URL']
    //   const { DATABASE_URL } = process.env
    // Also catches a literal connection URI with embedded credentials, which
    // can appear in a committed snapshot or fixture with no `process.env` in
    // sight.
    pattern:
      // The destructured branch reuses the SAME keyword group as dot/bracket
      // access. It previously named only three keywords, so
      // `const { PASSWORD, ACCESS_TOKEN } = process.env` evaded a pattern that
      // caught `process.env.PASSWORD`.
      /(?:process\.env\s*(?:\.\s*|\[\s*['"])(?!NEXT_PUBLIC_)[A-Z0-9_]*(?:SECRET|PRIVATE_KEY|SERVICE_ROLE|PASSWORD|DATABASE_URL|ACCESS_TOKEN|API_KEY)[A-Z0-9_]*|(?:const|let|var)\s*\{[^}]*\b(?!NEXT_PUBLIC_)[A-Z0-9_]*(?:SECRET|PRIVATE_KEY|SERVICE_ROLE|PASSWORD|DATABASE_URL|ACCESS_TOKEN|API_KEY)[A-Z0-9_]*\b[^}]*\}\s*=\s*process\.env|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/'"]+:[^\s:@/'"]+@)/,
    note: 'reads secret credentials from the environment, or embeds a credentialed connection URI',
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
 * File extensions where a shell command written in the source is INERT TEXT
 * unless the file also spawns a process. Deliberately a short, closed list of
 * JavaScript/TypeScript module types: every other extension — `.sh`, `.ps1`,
 * `.py`, `.rb`, `.yml`, a Dockerfile, a Makefile, an unknown one — is treated
 * as able to run the command, so the exclusion below fails closed.
 */
const SHELL_INERT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Evidence that a file can hand text to a shell. If ANY of this appears, the
 * file is not inert and the shell signatures apply in full.
 */
const PROCESS_EXECUTION_TOKENS =
  /(?:child_process|execSync|execFileSync|spawnSync|\bexecFile\s*\(|\bspawn\s*\(|\bexec\s*\(|\bshelljs\b|\bzx\b|Bun\.\$|Deno\.Command|Start-Process|\bsubprocess\b|os\.system|Process\.Start)/;

/**
 * True when shell command TEXT in this file cannot reach a shell.
 *
 * Fails closed twice over: an unknown or absent path is never inert, and any
 * extension outside the closed list above is never inert. The only way to hide
 * a real command here is to run it from a `.ts`/`.js` family file with no
 * execution token anywhere in it, which requires an indirection through another
 * module — the limit `AGENTS.md` already discloses.
 */
export function shellTextIsInert(path, text) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const p = normalizePath(path).toLowerCase();
  if (!SHELL_INERT_EXTENSIONS.some((ext) => p.endsWith(ext))) return false;
  return !PROCESS_EXECUTION_TOKENS.test(text);
}

/**
 * Detect the capabilities present in a blob of source text.
 *
 * A signature may carry a `pattern`, a `detect(text)` analyzer, or both; either
 * firing is enough. The analyzer form exists because some capabilities are not
 * decidable by one regex over raw text — filesystem deletion depends on what a
 * module binding RESOLVES to, which needs a second pass.
 *
 * `path` is OPTIONAL and only ever used to WITHHOLD a signature that matches
 * shell command text in a file that cannot run one. Omitting it applies every
 * signature, so a caller that has no path loses no coverage.
 *
 * @param {string} text
 * @param {string} [path]
 * @returns {Array<{name:string, tier:string, note:string}>}
 */
export function detectCapabilities(text, path) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const inertShell = shellTextIsInert(path, text);
  const found = [];
  for (const sig of CAPABILITY_SIGNATURES) {
    if (sig.shellContext && inertShell) continue;
    const matched = (sig.pattern && sig.pattern.test(text)) || (sig.detect && sig.detect(text));
    if (matched) {
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
