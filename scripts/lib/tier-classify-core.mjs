/**
 * Repository-owned tier classifier — core logic.
 *
 * Capability-based fail-closed classification (attended operator decision,
 * 2026-08-08). See `tier-capabilities.mjs` for why path enumeration alone was
 * rejected.
 *
 * Resolution order for one path, highest wins and nothing may lower a floor:
 *
 *   1. baseline        — T2 if the path is demonstrably inert, else the map's
 *                        default tier (T1). This is the "unknown path is not
 *                        automatically T0" rule.
 *   2. capability floor— what the CONTENT can actually do, wherever it lives.
 *   3. baked path floor— roles that are high-risk regardless of content, and
 *                        which `.claude/tier-map.json` cannot weaken.
 *   4. tier-map rule   — the project map. It can only ESCALATE, because the
 *                        result is a maximum. It lowers nothing.
 *
 * Consequence (acceptance criterion 6): deleting a T0 glob from the tier map
 * cannot downgrade a capability-floored change, because the capability floor is
 * computed from the file's content and never read from the map.
 *
 * Zero runtime dependencies — Node built-ins only, so this runs in CI before
 * `npm ci` and cannot be disabled by a dependency failure.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchesAnyGlob, normalizePath } from './tier-glob.mjs';
import {
  RANK_TIER,
  TIER_RANK,
  bakedFloorFor,
  detectCapabilities,
  isExecutableExtension,
  isInertBinary,
  isInertPath,
  isNonExecutable,
  maxTier,
} from './tier-capabilities.mjs';

/** Fallback used only when the project map is missing or unreadable. */
export const FALLBACK_TIER_MAP = {
  version: 1,
  default_tier: 'T1',
  escalate_min_t0_files: 1,
  non_runtime_paths: ['docs/**', '**/*.md', '**/fixtures/**', '**/*.txt'],
  rules: [],
};

const isTier = (t) => t === 'T0' || t === 'T1' || t === 'T2';

/**
 * Find the repository root by walking UP from a starting directory until a
 * directory contains `.git` or `package.json`.
 *
 * Acceptance criterion 3 requires the tier map to resolve relative to the REPO
 * ROOT — not `cwd` and not the script directory. Resolving against `cwd` was
 * the real defect: running the gate from `src/` silently found no map and fell
 * back to defaults that declare no T0 rules at all, so the gate passed by
 * being blind. Walking up from this module's own location makes the result
 * identical from any subdirectory.
 *
 * `.git` is checked with `existsSync` rather than `statSync().isDirectory()`
 * because in a git worktree `.git` is a FILE, and this repository is developed
 * in worktrees.
 *
 * @param {string} [startDir] defaults to this module's directory
 * @returns {string} absolute repo root (falls back to the start directory)
 */
export function findRepoRoot(startDir) {
  const start = startDir ? resolve(startDir) : dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start; // reached the filesystem root
    dir = parent;
  }
}

/** The repo root, resolved once from this file's location. */
export const REPO_ROOT = findRepoRoot();

/**
 * Load `<repoRoot>/.claude/tier-map.json`.
 *
 * ABSENT and MALFORMED are deliberately different. Absent means the project has
 * no map and the fallback is honest. Malformed means the project HAS a policy
 * we cannot read — silently using the fallback there would drop every declared
 * T0 glob and under-gate a live change, so it is reported as an error for the
 * caller to surface loudly.
 *
 * @param {string} [repoRoot]
 * @returns {{map: object, source: 'project'|'default'|'error', error?: string}}
 */
export function loadTierMap(repoRoot = REPO_ROOT) {
  const file = join(repoRoot, '.claude', 'tier-map.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { map: FALLBACK_TIER_MAP, source: 'default' };
    return { map: FALLBACK_TIER_MAP, source: 'error', error: `unreadable tier-map: ${err && err.message}` };
  }
  try {
    // Strip a UTF-8 BOM: Windows editors add one and JSON.parse rejects it.
    return { map: JSON.parse(raw.replace(/^﻿/, '')), source: 'project' };
  } catch (err) {
    return { map: FALLBACK_TIER_MAP, source: 'error', error: `malformed tier-map JSON: ${err && err.message}` };
  }
}

/** Fill defaults and drop malformed entries; never throws. */
export function normalizeMap(tierMap, warnings = []) {
  if (!tierMap || typeof tierMap !== 'object') {
    warnings.push('tier-map missing or not an object; using fallback');
    return FALLBACK_TIER_MAP;
  }
  return {
    version: 1,
    default_tier: isTier(tierMap.default_tier) ? tierMap.default_tier : FALLBACK_TIER_MAP.default_tier,
    escalate_min_t0_files:
      Number.isInteger(tierMap.escalate_min_t0_files) && tierMap.escalate_min_t0_files >= 1
        ? tierMap.escalate_min_t0_files
        : 1,
    non_runtime_paths: Array.isArray(tierMap.non_runtime_paths)
      ? tierMap.non_runtime_paths.filter((s) => typeof s === 'string')
      : FALLBACK_TIER_MAP.non_runtime_paths,
    rules: Array.isArray(tierMap.rules)
      ? tierMap.rules.filter((r) => r && typeof r.glob === 'string' && isTier(r.tier))
      : [],
  };
}

/**
 * Read a file for capability analysis.
 *
 * @returns {{status:'ok'|'absent'|'binary', text:string}}
 */
export function readForAnalysis(path, repoRoot = REPO_ROOT, overrides) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, path)) {
    const v = overrides[path];
    return v === null || v === undefined ? { status: 'absent', text: '' } : { status: 'ok', text: String(v) };
  }
  const abs = join(repoRoot, normalizePath(path));
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    return { status: 'absent', text: '' };
  }
  // A NUL byte in the first 8 KB means binary — text signatures are meaningless.
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return { status: 'binary', text: '' };
  // CRLF is normalized so a Windows checkout and a Linux CI agent agree.
  return { status: 'ok', text: buf.toString('utf8').replace(/\r\n/g, '\n') };
}

/** Highest tier-map rule matching a path (case-insensitively). */
function mapTierFor(path, compiledRules) {
  let tier = null;
  let matchedGlob = null;
  for (const rule of compiledRules) {
    if (!matchesAnyGlob([rule.glob], path)) continue;
    if (!tier || TIER_RANK[rule.tier] > TIER_RANK[tier]) {
      tier = rule.tier;
      matchedGlob = rule.glob;
    }
  }
  return { tier, matchedGlob };
}

/**
 * Classify one path. Exported for focused testing.
 *
 * @param {string} rawPath
 * @param {object} map normalized tier map
 * @param {object} [opts] `{repoRoot, contents}` — `contents` maps path→source
 *   text (or null for "absent"), letting tests classify hypothetical files that
 *   are not on disk.
 */
export function classifyOnePath(rawPath, map, opts = {}) {
  const { repoRoot = REPO_ROOT, contents } = opts;
  const path = normalizePath(rawPath);
  const reasons = [];

  const inert = isInertPath(path);
  const binaryAsset = isInertBinary(path);
  const nonExecutable = isNonExecutable(path);
  // An inert DIRECTORY does not make an executable file inert. `docs/sync.mjs`
  // keeps the T1 baseline; only genuinely inert content drops to T2.
  const executable = isExecutableExtension(path);
  const baseline = (inert || binaryAsset) && !executable ? 'T2' : map.default_tier;
  let tier = baseline;

  // 1. Capability analysis of the actual content.
  const read = readForAnalysis(path, repoRoot, contents);
  let capabilities = [];
  let ambiguous = false;
  if (nonExecutable) {
    // Prose, not capability. A runbook that QUOTES `delete from auth.users`
    // cannot run it. Agent policy is the exception and is floored by path in
    // step 2 below, because instructions an agent follows really can act.
    reasons.push('non-executable file type — content is prose, not capability');
  } else if (read.status === 'ok') {
    capabilities = detectCapabilities(read.text);
    for (const cap of capabilities) {
      tier = maxTier(tier, cap.tier);
      reasons.push(`capability ${cap.name} (${cap.tier}) — ${cap.note}`);
    }
  } else if (inert || binaryAsset) {
    // An inert doc/fixture/asset stays cheap even when we cannot read it. This
    // is what stops a bulk rename or a deleted doc from paging anyone.
    reasons.push(`unreadable but demonstrably inert (${read.status}) — no capability possible`);
  } else {
    // Fail closed: we could NOT establish that this change lacks a high-risk
    // capability, so it is T0 and explicitly escalated for a human to look at.
    ambiguous = true;
    tier = 'T0';
    reasons.push(
      `AMBIGUOUS: content ${read.status} and path is not demonstrably inert — cannot establish absence of a high-risk capability`,
    );
  }

  // 2. Baked-in path floor — roles the tier map may not weaken.
  const baked = bakedFloorFor(path);
  if (baked) {
    tier = maxTier(tier, baked.tier);
    reasons.push(`baked-in floor ${baked.capability} (${baked.tier}) — not lowerable by the tier map`);
  }

  // 3. The project tier map may only escalate (the result is a maximum).
  const { tier: mapped, matchedGlob } = mapTierFor(path, map.rules);
  if (mapped) {
    if (TIER_RANK[mapped] > TIER_RANK[tier]) {
      reasons.push(`tier-map rule "${matchedGlob}" escalates to ${mapped}`);
      tier = mapped;
    } else if (TIER_RANK[mapped] < TIER_RANK[tier]) {
      reasons.push(`tier-map rule "${matchedGlob}" (${mapped}) does NOT lower the ${tier} floor`);
    }
  }

  // `nonRuntime` drives `skippable`, which lets a change skip behavioral
  // verification entirely — so an executable never qualifies, even under an
  // inert directory. `src/fixtures/factory.ts` was previously skippable.
  const nonRuntime =
    (inert || binaryAsset) &&
    !executable &&
    matchesAnyGlob(map.non_runtime_paths, path) !== null &&
    tier !== 'T0';

  return {
    path,
    tier,
    baseline,
    matchedGlob,
    nonRuntime,
    ambiguous,
    capabilities: capabilities.map((c) => c.name),
    reasons,
  };
}

/**
 * Classify a set of changed paths into an overall tier.
 *
 * @param {string[]} changedPaths repo-relative changed paths
 * @param {object} [tierMap] a tier-map object (defaults to the loaded project map)
 * @param {object} [opts] `{repoRoot, contents}`
 * @returns {{tier:string, perPath:object[], t0FileCount:number, escalated:boolean,
 *            skippable:boolean, ambiguousCount:number, warnings:string[]}}
 */
export function classifyPaths(changedPaths, tierMap, opts = {}) {
  const warnings = [];
  const map = normalizeMap(tierMap, warnings);
  const paths = Array.isArray(changedPaths)
    ? [...new Set(changedPaths.filter((p) => typeof p === 'string' && p.length > 0).map(normalizePath))]
    : [];

  if (paths.length === 0) {
    warnings.push('no changed paths given');
    return {
      tier: map.default_tier,
      perPath: [],
      t0FileCount: 0,
      escalated: false,
      skippable: false,
      ambiguousCount: 0,
      warnings,
    };
  }

  const perPath = paths.map((p) => classifyOnePath(p, map, opts));
  const t0FileCount = perPath.filter((r) => r.tier === 'T0').length;
  const ambiguousCount = perPath.filter((r) => r.ambiguous).length;
  const tier = perPath.reduce((acc, r) => maxTier(acc, r.tier), 'T2');

  return {
    tier,
    perPath,
    t0FileCount,
    // Ambiguity always escalates: an unanalyzable change is exactly the case a
    // human must look at, regardless of how many files are involved.
    escalated: t0FileCount >= map.escalate_min_t0_files || ambiguousCount > 0,
    skippable: perPath.every((r) => r.nonRuntime) && tier !== 'T0',
    ambiguousCount,
    warnings,
  };
}

/**
 * Validate a tier map against the repo's real file list.
 *
 * A rule matching ZERO files is almost certainly a typo, and a dead T0 rule is
 * worst: a protection is misspelled and silently inactive. This checks the one
 * thing glob matching cannot infer on its own — authorial intent.
 */
export function validateTierMap(tierMap, repoFiles) {
  const warnings = [];
  const map = normalizeMap(tierMap, warnings);
  const files = (Array.isArray(repoFiles) ? repoFiles : [])
    .filter((f) => typeof f === 'string' && f.length > 0)
    .map(normalizePath);
  const deadRules = [];
  for (const rule of map.rules) {
    if (files.some((f) => matchesAnyGlob([rule.glob], f))) continue;
    deadRules.push({ glob: rule.glob, tier: rule.tier });
    warnings.push(
      rule.tier === 'T0'
        ? `T0 rule "${rule.glob}" matches NO files — a protection is likely misspelled and INACTIVE`
        : `${rule.tier} rule "${rule.glob}" matches no files (likely a typo)`,
    );
  }
  return { ok: deadRules.length === 0, deadRules, warnings };
}

export { RANK_TIER, TIER_RANK };
