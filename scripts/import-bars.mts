/**
 * DEPRECATED (2026-08-02, goal g-4531bbf0): replaced by the census apply
 * path, which binds writes to a reviewed dry-run report (sidecar hash +
 * provenance check) on top of the same boundary validation, dedup, and
 * chunked-insert logic this script pioneered (ported to
 * scripts/census/apply.ts):
 *
 *   npx tsx scripts/census/run-census.mts --apply <curated.json> --run <runId>
 *
 * Still attended-only and dry-run-first. Full history: git log --follow.
 */
console.error(
  'import-bars.mts is deprecated — use: npx tsx scripts/census/run-census.mts --apply <curated.json> --run <runId>',
);
process.exit(1);
