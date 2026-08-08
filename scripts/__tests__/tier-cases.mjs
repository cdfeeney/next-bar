/**
 * Adversarial case table for the repository-owned tier classifier.
 *
 * ONE table, used by two consumers:
 *   - `tier-classify.test.mjs` — asserts the repo classifier gets every case
 *     right (GREEN).
 *   - `red-proof.mjs`          — runs the SAME cases through the pre-change
 *     home-dir classifier and reports which ones it gets wrong (RED).
 *
 * Sharing the table is the point. If the two drifted, "it fails before and
 * passes after" would stop being a claim about the same assertions, and
 * acceptance criterion 12 (no coverage theater) would be unverifiable.
 *
 * `contents: null` means the file does not exist on disk — that is the
 * "cannot establish absence of a capability" case, which must fail closed.
 * A case with no `contents` key is a REAL file and is read from the worktree,
 * so these assertions break if the actual repository regresses.
 */

/** A plain UI component: no destructive, privileged, or network capability. */
const ORDINARY_UI = `'use client';
import { useState } from 'react';

export function BarCard({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(!open)} aria-expanded={open}>
      {name}
    </button>
  );
}
`;

/** The exact evasion the old path-enumeration policy could not catch. */
const PURGE_SCRIPT = `import { readdirSync, unlinkSync } from 'node:fs';

for (const file of readdirSync('public/photos')) {
  unlinkSync('public/photos/' + file);
}
`;

const CLEANUP_ACCOUNTS = `import pg from 'pg';
const client = new pg.Client(process.env.DATABASE_URL);
await client.query('delete from auth.users where last_seen < now() - interval \\'1 year\\'');
`;

const ADMIN_PURGE_ROUTE = `export async function DELETE(request: Request) {
  const { id } = await request.json();
  await adminClient.from('bars').delete().eq('id', id);
  return new Response(null, { status: 204 });
}
`;

const NEW_MIGRATION = `alter table public.bars add column noise_level int;
`;

const DEPLOY_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
scp -r .next/ droplet:/srv/next-bar/
ssh droplet systemctl restart next-bar
`;

const INERT_FIXTURE = `{ "bars": [{ "id": "1", "name": "The Anchor" }] }
`;

const INERT_DOC = `# Release notes

Nothing here executes. Adding this file must not page anyone.
`;

const WORKFLOW = `name: Nightly
on: { schedule: [{ cron: '0 3 * * *' }] }
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

/**
 * @typedef {object} TierCase
 * @property {string} name       human label, used in test output
 * @property {string} path       repo-relative path to classify
 * @property {string} [contents] hypothetical file content; omit for a real file
 * @property {string} expect     required tier
 * @property {boolean} [escalated] required `escalated` flag when asserted
 * @property {boolean} [emptyMap] classify with a tier map that has NO rules
 * @property {string} why        what regression this case catches
 */

/** @type {TierCase[]} */
export const TIER_CASES = [
  // ---------------------------------------------------------------- AC11 (a)
  // Every current T0 surface must still be T0. These are REAL repository files,
  // so the assertions fail if the repo itself regresses.
  {
    name: 'real migration file stays T0',
    path: 'supabase/migrations/0000_reconcile_v01_schema.sql',
    expect: 'T0',
    why: 'schema changes against live user data are irreversible',
  },
  {
    name: 'real account-delete route stays T0',
    path: 'src/app/api/account/delete/route.ts',
    expect: 'T0',
    why: 'deletes an auth user and cascades through every table they own',
  },
  {
    name: 'real service-role event route stays T0',
    path: 'src/app/api/event/route.ts',
    expect: 'T0',
    why: 'second service-role holder; bypasses row-level security',
  },
  {
    name: 'real middleware stays T0',
    path: 'src/middleware.ts',
    expect: 'T0',
    why: 'runs before every matched route, so no per-route control can gate it',
  },
  {
    name: 'real password-setting script stays T0',
    path: 'scripts/set-password.mjs',
    expect: 'T0',
    why: 'account takeover as a supported operator tool',
  },
  {
    name: 'real auth.users-deleting smoke script stays T0',
    path: 'scripts/rpc-smoke.mts',
    expect: 'T0',
    why: 'executes delete from auth.users against DATABASE_URL',
  },
  {
    name: 'real photo-converting script stays T0',
    path: 'scripts/photos-to-webp.mjs',
    expect: 'T0',
    why: 'unlinkSync deletes the original source media with no undo',
  },

  // ---------------------------------------------------------------- AC11 (b)
  // New files at unlisted paths — the evasions path enumeration could not catch.
  {
    name: 'NEW unlisted migration is T0',
    path: 'supabase/migrations/9999_add_noise_level.sql',
    contents: NEW_MIGRATION,
    expect: 'T0',
    why: 'a migration added tomorrow is as irreversible as one added last year',
  },
  {
    name: 'destructive script in an unfamiliar namespace is T0',
    path: 'tools/maintenance/purge-photos.mjs',
    contents: PURGE_SCRIPT,
    expect: 'T0',
    why: 'the classic evasion: unlinkSync in a directory nobody globbed',
  },
  {
    name: 'auth.users delete in a brand-new script is T0',
    path: 'tools/cleanup-accounts.mts',
    contents: CLEANUP_ACCOUNTS,
    expect: 'T0',
    why: 'renaming or relocating the file must not lower the tier',
  },
  {
    name: 'new admin purge route is T0',
    path: 'src/app/api/admin/purge/route.ts',
    contents: ADMIN_PURGE_ROUTE,
    expect: 'T0',
    why: 'a DELETE handler at an unlisted route path',
  },

  // ---------------------------------------------------------------- AC11 (c)
  // Role-based floors the tier map may not weaken.
  {
    name: 'new CI workflow is T0',
    path: '.github/workflows/nightly.yml',
    contents: WORKFLOW,
    expect: 'T0',
    why: 'a workflow edit can delete the gate protecting everything else',
  },
  {
    name: 'release/deploy script is T0',
    path: 'scripts/deploy-droplet.sh',
    contents: DEPLOY_SCRIPT,
    expect: 'T0',
    why: 'deploy scripts move code onto the live revenue surface',
  },
  {
    name: 'dependency manifest is T0',
    path: 'package.json',
    expect: 'T0',
    why: 'a dependency addition runs arbitrary install scripts (supply chain)',
  },
  {
    name: 'lockfile is T0',
    path: 'package-lock.json',
    expect: 'T0',
    why: 'same supply-chain reach as the manifest',
  },
  {
    name: 'AGENTS.md is T0 despite the .md extension',
    path: 'AGENTS.md',
    expect: 'T0',
    why: 'agent policy is not documentation; it can tell an agent to skip a gate',
  },
  {
    name: 'the tier map itself is T0',
    path: '.claude/tier-map.json',
    expect: 'T0',
    why: 'policy must never be graded by a weakened version of itself',
  },
  {
    name: 'the classifier itself is T0',
    path: 'scripts/tier-classify.mjs',
    expect: 'T0',
    why: 'the gate must not be able to quietly downgrade its own enforcement',
  },
  {
    name: 'the enforcement tests are T0',
    path: 'scripts/__tests__/tier-classify.test.mjs',
    expect: 'T0',
    why: 'deleting the adversarial suite must be as visible as deleting the gate',
  },
  {
    name: 'the RED proof is T0',
    path: 'scripts/__tests__/red-proof.mjs',
    expect: 'T0',
    why: 'without it the adversarial suite cannot be distinguished from coverage theater',
  },
  {
    name: 'the changed-paths feeder is T0',
    path: 'scripts/changed-paths.mjs',
    expect: 'T0',
    why: 'making this print nothing yields a green gate that inspected no files',
  },

  // ---------------------------------------------------------------- AC11 (d)
  // The map can escalate but never de-escalate below a capability floor.
  {
    name: 'capability floor survives a tier map with NO rules at all',
    path: 'scripts/rpc-smoke.mts',
    emptyMap: true,
    expect: 'T0',
    why: 'removing a T0 glob must not downgrade a capability-floored change',
  },
  {
    name: 'new destructive script is T0 even with an empty tier map',
    path: 'tools/maintenance/purge-photos.mjs',
    contents: PURGE_SCRIPT,
    emptyMap: true,
    expect: 'T0',
    why: 'the floor is computed from content, never read from the map',
  },

  // ---------------------------------------------------------------- AC11 (e)
  // Fail closed on ambiguity, but NOT on mere novelty.
  {
    name: 'unanalyzable runtime file is T0 and escalated',
    path: 'src/lib/mysteryModule.ts',
    contents: null,
    expect: 'T0',
    escalated: true,
    why: 'cannot establish absence of a high-risk capability => fail closed',
  },
  {
    name: 'demonstrably inert NEW fixture stays low tier',
    path: 'src/__fixtures__/bars.json',
    contents: INERT_FIXTURE,
    expect: 'T2',
    why: 'a codegen storm of fixtures must not page anyone (this is the whole point)',
  },
  {
    name: 'demonstrably inert NEW doc stays low tier',
    path: 'docs/RELEASE-NOTES-2026-08.md',
    contents: INERT_DOC,
    expect: 'T2',
    why: 'unknown path alone must never mean T0',
  },
  {
    name: 'ordinary UI file is T1 and NOT escalated',
    path: 'src/components/BarCard.tsx',
    contents: ORDINARY_UI,
    expect: 'T1',
    escalated: false,
    why: 'the false-positive rate is what kills a gate; ordinary code must stay cheap',
  },
];

/**
 * Cases asserting that separator style and case do not change the answer.
 * Windows and macOS filesystems are case-insensitive, so a case-sensitive gate
 * could be evaded — or silently disagree between a laptop and CI.
 */
export const EQUIVALENCE_CASES = [
  {
    name: 'backslashes match the same rule as forward slashes',
    a: 'src/app/api/account/delete/route.ts',
    b: 'src\\app\\api\\account\\delete\\route.ts',
  },
  {
    name: 'a leading ./ is irrelevant',
    a: 'src/middleware.ts',
    b: './src/middleware.ts',
  },
  {
    name: 'mixed case matches the same rule',
    a: 'supabase/migrations/0000_reconcile_v01_schema.sql',
    b: 'Supabase/Migrations/0000_Reconcile_V01_Schema.SQL',
  },
];
