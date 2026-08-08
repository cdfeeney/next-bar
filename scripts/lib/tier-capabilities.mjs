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
 * Blank out JavaScript comments that occupy a whole line, preserving lines.
 *
 * WHY THIS EXISTS. `// import { rm } from 'node:fs/promises'` floored an
 * ordinary module at T0. A commented-out import is not capability, and a gate
 * that fires on dead text acquires exactly the continuous false-positive rate
 * this design exists to avoid.
 *
 * WHY IT IS THIS CONSERVATIVE. This function can only ever REMOVE text before
 * the analyzer sees it, so every mistake it makes is a FAIL-OPEN. The first
 * version tried to lex `/` in general and three independent reviewers broke it
 * the same way: `/` starts a regex literal as well as a comment, so
 * `s.replace(/\/*$/, '')` and `const route = /^\/*api/` were read as an opening
 * block comment. With no closing `*​/` anywhere, blanking ran to the end of the
 * input and erased the real deletion import below it — reproduced, and it
 * defeated the very laundering defence the recovery code exists to provide.
 *
 * So the rule is now the narrowest one that still fixes the false positive:
 *
 *   1. Only a comment marker that is the FIRST non-whitespace on its line is
 *      blanked. A regex literal or a division can never be line-leading `//` or
 *      `/*` in valid JavaScript — `//` and `/*` at the start of an expression
 *      are a comment to the parser too. Commented-out code, the case this
 *      exists for, is essentially always line-leading.
 *   2. A block comment is only entered when a closing `*​/` actually exists
 *      later in the input. An unterminated `/*` blanks NOTHING, so the
 *      catastrophic "erase the rest of the file" mode cannot occur.
 *
 * A trailing comment (`const x = 1; // import { rm } …`) is deliberately NOT
 * blanked. That direction over-escalates, which is the safe one.
 *
 * Scoped to `analyzeFsDeletion`, which is JavaScript-specific by construction.
 * It is NOT applied to the raw signature patterns, because those also scan
 * `.sql`, `.ps1`, `.py` and `.sh`, where a JS-shaped stripper would remove live
 * code.
 */
export function blankComments(text) {
  const lines = String(text).split('\n');
  const out = [];
  let closing = -1; // index of the line that closes the block we are inside

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i <= closing) {
      // Inside a block comment whose terminator is known to exist.
      const end = i === closing ? line.indexOf('*/') : -1;
      out.push(end === -1 ? '' : ' '.repeat(end + 2) + line.slice(end + 2));
      continue;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) {
      out.push('');
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const indent = line.length - trimmed.length;
      const sameLine = line.indexOf('*/', indent + 2);
      if (sameLine !== -1) {
        out.push(' '.repeat(sameLine + 2) + line.slice(sameLine + 2));
        continue;
      }
      // Only enter the block if it is genuinely closed somewhere below.
      const terminator = lines.findIndex((l, j) => j > i && l.includes('*/'));
      if (terminator === -1) {
        out.push(line); // not a comment we can trust — leave it intact
        continue;
      }
      closing = terminator;
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

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
export function analyzeFsDeletion(rawText) {
  const evidence = [];
  if (typeof rawText !== 'string' || rawText.length === 0) return { capable: false, evidence };

  // Commented-out code is not capability. See `blankComments`.
  const text = blankComments(rawText);
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
  const requireRe = new RegExp(
    `\\b(?:const|let|var)\\s+(\\{[^}]*\\}|${IDENTIFIER})\\s*=\\s*(?:await\\s+)?(?:import|require)\\s*\\(\\s*${q}(${mod})${q}\\s*\\)`,
    'g',
  );
  for (const match of text.matchAll(requireRe)) {
    const [, binding, moduleSpecifier] = match;
    if (binding.startsWith('{')) recordClause(binding.slice(1, -1), moduleSpecifier);
    else namespaces.add(binding);
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
      );
      const hit = memberRe.exec(text);
      if (hit) evidence.push(`references ${ns}.${hit[1]}`);
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
    // `git rm` is excluded: it stages a removal from the index and, with
    // `--cached`, does not touch the filesystem at all. Matching it made
    // `git rm -r --cached generated/` a T0 event.
    pattern:
      /(?:\bfs\.(?:promises\.)?(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\b|\b(?:unlinkSync|rmSync|rmdirSync)\s*\(|\b(?:rm|rmdir|unlink)\s*\([^)]*\{[^}]*(?:recursive|force)\s*:\s*true|\brimraf\b|(?<!\bgit )\brm\s+(?:-[a-zA-Z]{1,8}\s+)*-[a-zA-Z]{0,6}[rR][a-zA-Z]{0,6}\b|(?<!\bgit )\brm\s+[^\n]*--(?:recursive|force)\b|\bRemove-Item\b|\bri\s+-(?:Recurse|Force)\b|\[System\.IO\.(?:Directory|File)\]::Delete\b|\b(?:rd|rmdir)\s+\/[sSqQ]\b|\bdel\s+\/[fFsSqQ]\b|\bshutil\.rmtree\s*\(|\bos\.(?:remove|removedirs|unlink|rmdir)\s*\(|\.unlink\s*\(|\brmtree\s*\(|\bFileUtils\.rm_r?f?\b|\b(?:File|Dir)\.(?:delete|unlink|rmdir)\s*\(|\bfind\s+[^\n]*\s-delete\b)/,
    detect: (text) => analyzeFsDeletion(text).capable,
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
