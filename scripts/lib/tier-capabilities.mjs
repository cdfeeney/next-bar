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
/**
 * Extract the balanced brace group that starts at `open` in `text`.
 *
 * WHY A SCANNER AND NOT A REGEX. Every binding rule used to capture its clause
 * with `\{[^}]*\}`, which stops at the FIRST closing brace. Four lanes reported
 * the same consequence from four different shapes — a nested destructure, an
 * object-literal default before the name that matters, a computed key, a braced
 * default initializer — and in each the clause was truncated mid-pattern, so it
 * never parsed and the deletion name was lost.
 *
 * That is not four defects. Braces nest, and a pattern that cannot count them
 * mis-reads every nested case, so adding one alternative per syntax would be the
 * enumeration treadmill this module has already been burned by. Counting depth
 * ends the class instead. String and template literals are skipped so a brace
 * inside `'{'` cannot unbalance the scan.
 *
 * @returns {{text: string, end: number} | null} null when nothing balances it
 */
function readBraceGroup(text, open) {
  if (text[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { text: text.slice(open, i + 1), end: i + 1 };
    }
  }
  return null;
}

/** Split a clause interior on top-level commas only, respecting nesting. */
function splitTopLevel(interior) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < interior.length; i++) {
    const ch = interior[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < interior.length && interior[i] !== quote) {
        if (interior[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(interior.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(interior.slice(start));
  return parts;
}

function parseBindingClause(clause) {
  const pairs = [];
  for (const part of splitTopLevel(stripOuterBraces(String(clause)))) {
    // A DEFAULT INITIALIZER is not part of the binding. `{ rm: nuke = fallback }`
    // binds `rm` exactly as `{ rm: nuke }` does, but the trailing `= fallback`
    // made the whole token fail to parse, so the deletion name was never seen.
    // Everything from the first `=` that is not `==`/`=>` is dropped.
    const token = part.split(/=(?![=>])/)[0].trim();
    if (token.length === 0) continue;
    // `{ type rm }` is an inline type-only specifier: erased at compile time, so
    // it holds no runtime capability.
    if (/^type\s+/.test(token)) continue;
    // `...rest` collects every remaining member, so it is a NAMESPACE of the
    // module it came from, not a named binding.
    const rest = new RegExp(`^\\.\\.\\.\\s*(${IDENTIFIER})$`).exec(token);
    if (rest) {
      pairs.push({ imported: '*rest', local: rest[1] });
      continue;
    }
    // A computed key is still a static name when it is a string literal:
    // `{ ['rm']: nuke }` imports `rm` exactly as `{ rm: nuke }` does.
    const computed = /^\[\s*(['"])([^'"]+)\1\s*\]\s*:\s*([\s\S]+)$/.exec(token);
    const [key, valuePart] = computed
      ? [computed[2], computed[3]]
      : (() => {
          const split = new RegExp(`^(${IDENTIFIER})\\s*(?::|\\bas\\b)\\s*([\\s\\S]+)$`).exec(token);
          return split ? [split[1], split[2]] : [null, null];
        })();
    if (key !== null) {
      const value = valuePart.trim();
      // A NESTED pattern renames nothing at this level but binds inside it:
      // `{ promises: { rm } }` imports `rm` through the `promises` namespace.
      if (value.startsWith('{')) {
        for (const inner of parseBindingClause(value)) pairs.push(inner);
        pairs.push({ imported: key, local: `${key}$nested` });
        continue;
      }
      const localName = new RegExp(`^(${IDENTIFIER})$`).exec(value);
      if (localName) pairs.push({ imported: key, local: localName[1] });
      continue;
    }
    if (new RegExp(`^${IDENTIFIER}$`).test(token)) {
      pairs.push({ imported: token, local: token });
    }
  }
  return pairs;
}

/** Drop one balanced pair of outer braces, if present. */
function stripOuterBraces(clause) {
  const trimmed = clause.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;
}

/**
 * The binding that an assignment at `eqIndex` writes to, read BACKWARDS.
 *
 * The forward direction cannot work: a destructuring pattern is brace-balanced
 * and may nest, so no regex can capture it before knowing where it ends. Reading
 * back from the `=` is unambiguous — skip whitespace and an optional closing
 * paren, and either a `}` closes a pattern whose opening brace is found by
 * counting depth, or an identifier ends there.
 *
 * @returns {string|null} the brace group (with braces) or the identifier
 */
function bindingBefore(text, eqIndex) {
  let i = eqIndex - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  if (i >= 0 && text[i] === ')') {
    i -= 1;
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
  }
  if (i < 0) return null;
  if (text[i] === '}') {
    // COUNTING BACKWARDS IS NOT SAFE and a reviewer proved it: a brace inside a
    // string default (`{ rm: nuke = "}" }`) unbalances a naive reverse count,
    // which returned null and lost a real deletion binding. Scanning backwards
    // cannot tell an opening quote from a closing one, so the candidate opening
    // braces are tried against the FORWARD scanner instead — the one that does
    // skip string and template literals — and the group is accepted only when it
    // closes exactly here. Nearest opener first, so a nested pattern resolves to
    // its own outermost brace.
    for (let j = i; j >= 0; j--) {
      if (text[j] !== '{') continue;
      const group = readBraceGroup(text, j);
      if (group && group.end === i + 1) return group.text;
    }
    return null;
  }
  let end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(text[i])) i -= 1;
  const name = text.slice(i + 1, end);
  return new RegExp(`^${IDENTIFIER}$`).test(name) ? name : null;
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
      // A nested pattern's own members were already recorded by the recursion;
      // this marker only records that `promises` was traversed.
      if (local.endsWith('$nested')) continue;
      // `const { promises: fsp } = require('fs')` binds a namespace, not a
      // function. `const { rm, ...rest } = require('fs')` binds one too: `rest`
      // holds every member that was not named, deletion functions included.
      if (imported === 'promises' || imported === '*rest') {
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
    if (namespaced) {
      // `export * as fsp from 'node:fs/promises'` re-exports everything under a
      // name and binds NOTHING locally, so the member reference a namespace
      // requires can never appear in this file — the rule was structurally
      // unable to fire, while its siblings `export *`, `module.exports =
      // require(…)` and `Object.assign(module.exports, …)` all floor T0. As an
      // EXPORT it is a barrel; as an IMPORT it really is a local namespace.
      if (/^\s*export\b/.test(match[0])) {
        evidence.push(`re-exports all of '${moduleSpecifier}' as ${namespaced[1]}`);
        continue;
      }
      namespaces.add(namespaced[1]);
    }
    // `export * from 'node:fs/promises'` binds NO name here and forwards every
    // deletion function to whoever imports this module. Two lanes reported it:
    // the barrel graded T1, and so did its importer, because the importer's
    // specifier is a local path rather than an fs module. A bare star is
    // therefore capability on its own — there is nothing else it could be.
    if (/^\s*\*\s*$/.test(clause)) {
      evidence.push(`re-exports all of '${moduleSpecifier}', including its deletion functions`);
      continue;
    }
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
  // The BINDING half is read backwards from the `=` by `bindingBefore`, because
  // a destructuring pattern nests and no forward regex can capture it before
  // knowing where it ends. Only the right-hand side is matched here.
  const requireRe = new RegExp(
    `=\\s*[^\\n=]{0,80}?(?:await\\s+)?(?:import|require)\\s*\\(\\s*${q}(${mod})${q}\\s*\\)`,
    'g',
  );
  for (const match of text.matchAll(requireRe)) {
    const binding = bindingBefore(text, match.index);
    if (binding === null) continue;
    if (binding.startsWith('{')) recordClause(binding, match[1]);
    else namespaces.add(binding);
  }

  // THE CJS RE-EXPORT BARREL, which is the counterpart of the bare `export *`
  // above and was missed because `module.exports` is not an identifier the
  // binding group can capture. `module.exports = require('fs-extra')` forwards
  // every deletion function to whoever imports this module, and the importer's
  // own specifier is a local path, so neither file held capability.
  // `exports` must be the MODULE's exports object, not any property that happens
  // to be spelled that way: `loader.exports = require('node:fs')` is an ordinary
  // object assignment and was reported as a barrel. The lookbehind rejects a
  // dotted owner while still admitting bare `exports` and `module.exports`.
  //
  // `Object.assign(module.exports, require('fs-extra'))` copies the same
  // functions onto the same object and is the other idiom in real use, so it is
  // matched as a second alternative rather than left to a later round.
  // `(?<!\b(?:const|let|var)\s{1,8})` because `const exports = require('node:fs')`
  // inside a function is an ordinary local binding, not the module's export
  // object, and was reported as a barrel. The optional trailing `.prop` covers
  // the single-statement property barrel `exports.fse = require('fs-extra')`,
  // which re-exports the module just as completely under one key.
  const exportsTarget =
    `(?<![.\\w$])(?<!\\b(?:const|let|var)\\s{1,8})(?:module\\s*\\.\\s*)?exports(?:\\s*\\.\\s*${IDENTIFIER})?`;
  const cjsReexportRe = new RegExp(
    `(?:${exportsTarget}\\s*=\\s*[^\\n=]{0,80}?|Object\\s*\\.\\s*assign\\s*\\(\\s*${exportsTarget}\\s*,[^)\\n]{0,120}?)` +
      `(?:await\\s+)?(?:import|require)\\s*\\(\\s*${q}(${mod})${q}\\s*\\)`,
    'g',
  );
  for (const match of text.matchAll(cjsReexportRe)) {
    evidence.push(`re-exports all of '${match[1]}', including its deletion functions`);
    break;
  }

  // A CONTINUATION receives the module without ever binding a name in this
  // scope: `import('fs/promises').then(({ rm }) => rm(p))` and
  // `import('fs').then(fs => fs.unlink(p))`. Neither shape has a declaration to
  // anchor on, and both really delete. Rather than parse the callback, the
  // parameter list is read as a binding clause when it destructures, and as a
  // namespace when it is a bare identifier — the same two rules used everywhere
  // else in this function.
  // `function` and `async function` continuations count too. Matching only the
  // arrow form captured the literal word `function` as the namespace name, so
  // `.then(function ({ unlink }) { … })` bound nothing at all.
  // The PARAMETER is taken with the depth scanner, not a first-closing-brace
  // capture. This site kept the old pattern when the others were converted, so
  // `import('node:fs').then(({ promises: { rm } }) => rm(f))` truncated to
  // `{ promises: { rm }`, parsed as nothing, and graded T1 — while the flat
  // `({ rm })` form was a proven T0 case. The regex now matches only up to the
  // start of the parameter; the parameter itself is scanned.
  const thenRe = new RegExp(
    `import\\s*\\(\\s*${q}(${mod})${q}\\s*\\)\\s*\\.\\s*then\\s*\\(\\s*(?:async\\s+)?` +
      `(?:function\\s*(?:${IDENTIFIER})?\\s*)?(?:\\(\\s*)?`,
    'g',
  );
  for (const match of text.matchAll(thenRe)) {
    const moduleSpecifier = match[1];
    const at = match.index + match[0].length;
    if (text[at] === '{') {
      const group = readBraceGroup(text, at);
      if (group) recordClause(group.text, moduleSpecifier);
      continue;
    }
    const ident = new RegExp(`^(${IDENTIFIER})`).exec(text.slice(at));
    if (ident) namespaces.add(ident[1]);
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
  //
  // The deletion name must appear in a CALL or MEMBER position, not merely
  // anywhere in the file. `remove` is an ordinary English word and an ordinary
  // method name, and the unrestricted form graded
  // `await import(mod); export const label = 'remove';` at T0 — a false-positive
  // channel a reviewer correctly predicted would get this rule deleted rather
  // than narrowed. Requiring a call site costs only the case where a computed
  // specifier binds a deletion function that is never called anywhere in the
  // file, which cannot delete anything from this module.
  const dynamicSpec = `(?:\\bimport|\\brequire)\\s*\\(\\s*(?!\\s*${q})[^)\\n]{1,120}\\)`;
  const dynamicSpecRe = new RegExp(dynamicSpec, 'g');
  if (dynamicSpecRe.test(text)) {
    const names = FS_EXTRA_DELETION_NAMES.map(escapeForRegExp).join('|');
    const calledDeletionName = new RegExp(`(?:\\.\\s*)?\\b(?:${names})\\s*\\(`);
    if (calledDeletionName.test(text)) {
      evidence.push('resolves a module specifier dynamically and calls a deletion name — unanalyzable, failing closed');
    }
  }
  // AN ALIAS DEFEATED THE CALL-SITE REQUIREMENT ABOVE. In
  // `const { rm: nuke } = await import(spec); await nuke(dir)` the call site is
  // `nuke(`, which is no deletion name at all, so nothing fired. The clause is
  // read here instead: what is DESTRUCTURED from a dynamic specifier names the
  // imported function regardless of what it is renamed to.
  // `[^\n=]` and NOT `[^=]`: allowing newlines let the gap run past the end of
  // its own statement, so `({ rm: safe } = metadata); await import(spec);`
  // reported `rm` as coming from a dynamic import two statements later. The
  // clause itself may still span lines — that is read backwards by
  // `bindingBefore` — but the gap between `=` and the call may not.
  const dynamicClauseRe = new RegExp(`=\\s*[^\\n=]{0,80}?${dynamicSpec}`, 'g');
  for (const match of text.matchAll(dynamicClauseRe)) {
    const binding = bindingBefore(text, match.index);
    if (binding === null || !binding.startsWith('{')) continue;
    const imported = parseBindingClause(binding).map((b) => b.imported);
    const hit = imported.find((name) => FS_EXTRA_DELETION_NAMES.includes(name));
    if (hit) {
      evidence.push(`destructures ${hit} from a dynamically resolved module — unanalyzable, failing closed`);
      break;
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
      // A namespace can also be DESTRUCTURED rather than dotted:
      // `const fsp = require('node:fs/promises'); const { unlink: nuke } = fsp;`
      // reaches exactly the same function, and only the dotted form was read.
      // The clause names the imported member whatever it is renamed to.
      // NO STATEMENT TERMINATOR, which is the correction three lanes reported.
      // Requiring `;` or end-of-line meant an ordinary `({ unlink } = fsp);`, a
      // trailing comment, and a second declarator (`const { rm } = fsp, other
      // = 1`) all evaded it. What actually matters is that the namespace is the
      // WHOLE right-hand side rather than the head of a longer member chain,
      // and a negative lookahead states exactly that. `.promises` is admitted
      // between the two because `const { rm } = fs.promises` reaches the same
      // function as the dotted `fs.promises.rm` that was already recognised.
      // THE RIGHT-HAND SIDE MUST BE THE NAMESPACE AND NOTHING ELSE. The previous
      // lookahead only checked that the namespace was not the head of a member
      // chain, so `const { rm: safe } = fsp && safeApi` matched although the
      // destructured value is `safeApi`. It also rejected an ordinary
      // `= (fsp)`. Optional wrapping parens are allowed, and the expression must
      // then END — at a `;`, `,`, `)`, a line break, or a `//` comment. A lone
      // `/` is division and continues the expression, so it is not an ending;
      // `//` is, which is the one place that distinction matters here.
      const destructureRe = new RegExp(
        `=\\s*\\(*\\s*${escapeForRegExp(ns)}\\s*(?:\\.\\s*promises\\s*)?\\)*\\s*(?=$|[;,)]|\\/\\/)`,
        'gm',
      );
      for (const hit of text.matchAll(destructureRe)) {
        const bound = bindingBefore(text, hit.index);
        if (bound === null || !bound.startsWith('{')) continue;
        const imported = parseBindingClause(bound).map((b) => b.imported);
        const found = imported.find((name) => FS_EXTRA_DELETION_NAMES.includes(name));
        if (found) {
          evidence.push(`destructures ${found} from the ${ns} namespace`);
          break;
        }
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
    // ARGV-FORM SPAWN. `spawn('rm', ['-rf', dir])` deletes exactly as much as
    // `rm -rf dir`, and every shell pattern missed it: they require whitespace
    // after the command word, and here the next character is the closing quote.
    // The spawn wrapper may also take the command as the FIRST ARRAY ELEMENT
    // (`Bun.spawn(['rm', '-rf', dir])`), so both call shapes are matched and the
    // wrapper name is not required to be one this list knows — an unrecognised
    // wrapper still matches on the quoted command word in argument position.
    pattern:
      /(?:\bfs\.(?:promises\.)?(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\b|\b(?:unlinkSync|rmSync|rmdirSync)\s*\(|\b(?:rm|rmdir|unlink)\s*\([^)]*\{[^}]*(?:recursive|force)\s*:\s*true|\brimraf\b|\[System\.IO\.(?:Directory|File)\]::Delete\b|\bshutil\.rmtree\s*\(|\bos\.(?:remove|removedirs|unlink|rmdir)\s*\(|\.unlink\s*\(\s*(?:\)|missing_ok)|\brmtree\s*\(|\bFileUtils\.rm_r?f?\b|\b(?:File|Dir)\.(?:delete|unlink|rmdir)\s*\(|\(\s*\[?\s*['"](?:rm|rmdir|rd|del|erase|Remove-Item)['"]\s*,)/,
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
    // NO CONTEXT GATE. A previous round added one — shell signatures were
    // withheld from `.ts`/`.tsx`-family files that named no process-execution
    // API — to stop `<code>rm cache.db</code>` flooring ordinary React files at
    // T0. THREE INDEPENDENT LANES BROKE IT IN THE NEXT ROUND, all the same way:
    //
    //   import { run } from './runner';
    //   run('rm -rf /srv/data');            // `run` delegates to execSync
    //
    // names no execution token, so the gate declared the file inert and a real
    // destructive command graded T1 — a shape that had been T0 before the gate
    // existed. `execa` and `Bun.spawn` did the same, and every repair is
    // another name on a list that the next popular library falls off.
    //
    // That is the FIFTH exclusion in this module whose safety rested on a
    // negative text check, and the fifth to be broken by a reviewer. The
    // precedent set when comment suppression was deleted applies exactly: an
    // exclusion here is not narrowed, it is removed. A component that renders a
    // destructive command as text floors T0, and that over-escalation is
    // recorded in `docs/ENGINEERING-HARNESS.md` alongside the others. It cost
    // zero files when measured across all 3,866 tracked files, because no file
    // in this repository renders one.
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
 * Detect the capabilities present in a blob of source text.
 *
 * A signature may carry a `pattern`, a `detect(text)` analyzer, or both; either
 * firing is enough. The analyzer form exists because some capabilities are not
 * decidable by one regex over raw text — filesystem deletion depends on what a
 * module binding RESOLVES to, which needs a second pass.
 *
 * Every signature applies to every file. There is deliberately no per-file
 * exclusion: five have been tried in this module and reviewers broke all five,
 * always by making the exclusion believe something was inert when it was not.
 *
 * @param {string} text
 * @returns {Array<{name:string, tier:string, note:string}>}
 */
export function detectCapabilities(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = [];
  for (const sig of CAPABILITY_SIGNATURES) {
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
