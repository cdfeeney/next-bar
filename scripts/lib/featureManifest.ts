import { createHash } from 'node:crypto';

/**
 * Versioned local feature manifest (goal g-d494ba90) — METADATA ONLY this
 * goal: nothing here enforces flags at runtime; it records defaults,
 * kill-switch ownership, and compatibility so releases can be diffed and
 * a future enforcement layer has one authoritative source.
 *
 * Unattended-safety floor, structural: parseManifest REFUSES any manifest
 * whose preview/staging/production default is true — enabling a feature
 * outside development is an ATTENDED operator action by definition here,
 * so an overnight loop cannot even represent "enabled" state.
 */

export const MANIFEST_SCHEMA_VERSION = 1 as const;

export type Environment = 'development' | 'preview' | 'staging' | 'production';

export interface FeatureEntry {
  key: string;
  description: string;
  defaults: Record<Environment, boolean>;
  killSwitch: { owner: string; reason: string; since: string };
  compat: { minDataVersion: string };
}

export interface FeatureManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  dataVersion: string;
  features: FeatureEntry[];
}

const ATTENDED_ONLY_ENVS: Environment[] = ['preview', 'staging', 'production'];

export function parseManifest(jsonText: string): FeatureManifest {
  const parsed = JSON.parse(jsonText) as FeatureManifest;
  if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `unsupported manifest schema version: ${String(parsed.schemaVersion)}`,
    );
  }
  if (!Array.isArray(parsed.features)) throw new Error('features must be an array');
  const seen = new Set<string>();
  for (const f of parsed.features) {
    if (!f.key) throw new Error('feature missing key');
    if (seen.has(f.key)) throw new Error(`duplicate feature key: ${f.key}`);
    seen.add(f.key);
    if (!f.killSwitch?.owner || !f.killSwitch?.reason || !f.killSwitch?.since) {
      throw new Error(`feature ${f.key}: killSwitch metadata (owner/reason/since) is required`);
    }
    if (!f.compat?.minDataVersion) {
      throw new Error(`feature ${f.key}: compat.minDataVersion is required`);
    }
    // BOOLEAN-STRICT (Codex review): JSON can smuggle "true"/1, which
    // === true misses but a downstream truthiness check would honor.
    // Every env default must be literally boolean, and attended-only envs
    // must be literally false.
    for (const env of ['development', ...ATTENDED_ONLY_ENVS] as Environment[]) {
      if (typeof f.defaults?.[env] !== 'boolean') {
        throw new Error(
          `feature ${f.key}: default for ${env} must be a boolean (got ${JSON.stringify(f.defaults?.[env])})`,
        );
      }
    }
    for (const env of ATTENDED_ONLY_ENVS) {
      if (f.defaults[env] !== false) {
        throw new Error(
          `feature ${f.key}: default for ${env} is not false — enabling outside development is an attended action; this manifest cannot represent it`,
        );
      }
    }
  }
  return parsed;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface ReleaseSnapshot {
  schemaVersion: number;
  hash: string;
  entries: Array<{
    key: string;
    defaults: Record<Environment, boolean>;
    killSwitch: FeatureEntry['killSwitch'];
    compat: FeatureEntry['compat'];
  }>;
}

/**
 * Deterministic, diffable identity of the WHOLE feature state — defaults,
 * kill-switch metadata (owner/reason/since), and compat requirements all
 * feed the hash (santa review: hashing defaults alone let an owner handoff
 * or a compat bump slip through hash comparison undetected). Same manifest
 * ⇒ same snapshot; any substantive change ⇒ new hash.
 */
export function releaseSnapshot(manifest: FeatureManifest): ReleaseSnapshot {
  const entries = [...manifest.features]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((f) => ({
      key: f.key,
      defaults: f.defaults,
      killSwitch: f.killSwitch,
      compat: f.compat,
    }));
  const hash = createHash('sha256')
    .update(stableStringify({ schemaVersion: manifest.schemaVersion, entries }))
    .digest('hex');
  return { schemaVersion: manifest.schemaVersion, hash, entries };
}

export function checkCompatibility(
  feature: FeatureEntry,
  runtime: { dataVersion: string },
): { ok: true } | { ok: false; reason: string } {
  // Data versions are opaque labels; compatibility is EQUALITY-OR-LISTED,
  // not semver — a mismatch is a typed refusal, never a guess.
  if (feature.compat.minDataVersion !== runtime.dataVersion) {
    return {
      ok: false,
      reason: `data_version: feature ${feature.key} requires ${feature.compat.minDataVersion}, runtime has ${runtime.dataVersion}`,
    };
  }
  return { ok: true };
}
