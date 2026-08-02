/**
 * DEPRECATED (2026-08-02, goal g-4531bbf0): replaced by the provider-based
 * census command. OSM/Google candidate ingestion is now the `osm` and
 * `google` adapters of:
 *
 *   npx tsx scripts/census/run-census.mts --borough <name> --sources osm,google
 *
 * Candidates land as a reviewed report under scripts/census/out/<runId>/
 * instead of scripts/data/candidates.json. Full history: git log --follow.
 */
console.error(
  'ingest-bars.ts is deprecated — use: npx tsx scripts/census/run-census.mts --borough <name> --sources osm,google',
);
process.exit(1);
