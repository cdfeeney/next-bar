import { describe, expect, it } from 'vitest';
import {
  parseManifest,
  releaseSnapshot,
  checkCompatibility,
  type FeatureManifest,
} from './featureManifest';

/**
 * Feature safety manifest (goal g-d494ba90). Metadata only this goal: env
 * defaults never enable anything unattended, kill-switch fields are data,
 * and the snapshot is the deterministic diffable identity of flag state.
 */

const VALID: FeatureManifest = {
  schemaVersion: 1,
  dataVersion: 'bars-table-v1',
  features: [
    {
      key: 'posthog-adapter',
      description: 'PostHog analytics adapter (dark foundation)',
      defaults: { development: false, preview: false, staging: false, production: false },
      killSwitch: { owner: 'operator', reason: 'attended enablement only', since: '2026-08-02' },
      compat: { minDataVersion: 'bars-table-v1' },
    },
    {
      key: 'census-live-calls',
      description: 'Live provider spend for the census command',
      defaults: { development: false, preview: false, staging: false, production: false },
      killSwitch: { owner: 'operator', reason: 'LOOP_UNATTENDED gate + budget', since: '2026-08-02' },
      compat: { minDataVersion: 'bars-table-v1' },
    },
  ],
};

describe('feature manifest', () => {
  it('parses a valid manifest and rejects unknown schema versions', () => {
    expect(parseManifest(JSON.stringify(VALID))).toEqual(VALID);
    expect(() =>
      parseManifest(JSON.stringify({ ...VALID, schemaVersion: 99 })),
    ).toThrow(/schema/);
  });

  it('rejects duplicate feature keys and missing kill-switch metadata', () => {
    const dup = { ...VALID, features: [VALID.features[0], VALID.features[0]] };
    expect(() => parseManifest(JSON.stringify(dup))).toThrow(/duplicate/);
    const noKill = {
      ...VALID,
      features: [{ ...VALID.features[0], killSwitch: undefined }],
    };
    expect(() => parseManifest(JSON.stringify(noKill))).toThrow(/killSwitch/);
  });

  it('rejects a manifest where any default enables a feature outside development', () => {
    // Unattended-safety floor: this repo's manifest may not ship a
    // preview/staging/production default of TRUE — enabling is attended.
    const enabled = {
      ...VALID,
      features: [
        {
          ...VALID.features[0],
          defaults: { development: false, preview: false, staging: false, production: true },
        },
      ],
    };
    expect(() => parseManifest(JSON.stringify(enabled))).toThrow(/attended/);
  });

  it('release snapshot is deterministic and changes exactly when flag state changes', () => {
    const a = releaseSnapshot(VALID);
    const b = releaseSnapshot(JSON.parse(JSON.stringify(VALID)) as FeatureManifest);
    expect(a).toEqual(b); // stable across runs and object identity
    const changed: FeatureManifest = {
      ...VALID,
      features: [
        { ...VALID.features[0], defaults: { ...VALID.features[0].defaults, development: true } },
        VALID.features[1],
      ],
    };
    expect(releaseSnapshot(changed).hash).not.toBe(a.hash);
    // The snapshot names what changed at the feature grain.
    expect(a.entries.map((e) => e.key).sort()).toEqual(['census-live-calls', 'posthog-adapter']);
  });

  it('snapshot hash also moves on kill-switch and compat changes (santa review)', () => {
    const a = releaseSnapshot(VALID);
    const ownerHandoff: FeatureManifest = {
      ...VALID,
      features: [
        { ...VALID.features[0], killSwitch: { ...VALID.features[0].killSwitch, owner: 'someone-else' } },
        VALID.features[1],
      ],
    };
    expect(releaseSnapshot(ownerHandoff).hash).not.toBe(a.hash);
    const compatBump: FeatureManifest = {
      ...VALID,
      features: [
        { ...VALID.features[0], compat: { minDataVersion: 'bars-table-v2' } },
        VALID.features[1],
      ],
    };
    expect(releaseSnapshot(compatBump).hash).not.toBe(a.hash);
  });

  it('compatibility check refuses a manifest demanding a newer data version', () => {
    expect(
      checkCompatibility(VALID.features[0], { dataVersion: 'bars-table-v1' }),
    ).toEqual({ ok: true });
    const demanding = {
      ...VALID.features[0],
      compat: { minDataVersion: 'bars-table-v2' },
    };
    const v = checkCompatibility(demanding, { dataVersion: 'bars-table-v1' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('data_version');
  });
});
