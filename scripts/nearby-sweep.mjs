/**
 * DEPRECATED (2026-08-02, goal g-4531bbf0): replaced by the provider-based
 * census command. The Google tile sweep this script performed is now the
 * `google` adapter of:
 *
 *   npx tsx scripts/census/run-census.mts --borough <name> --sources google
 *
 * The primary-type bar filter and tile grain were ported there verbatim.
 * This stub exists so stale invocations fail LOUDLY instead of spending
 * Places quota through an unmaintained path. Full history: git log --follow.
 */
console.error(
  'nearby-sweep.mjs is deprecated — use: npx tsx scripts/census/run-census.mts --borough <name> --sources google',
);
process.exit(1);
