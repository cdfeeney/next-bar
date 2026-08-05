/**
 * DEPRECATED (2026-08-02, goal g-4531bbf0): superseded by the provider-based
 * census command, which turned OSM/Google candidate ingestion into `osm` and
 * `google` adapters producing a reviewed report instead of writing
 * scripts/data/candidates.json directly.
 *
 * That census tooling is INTENTIONALLY ABSENT from the Beta 1 release
 * candidate — catalog expansion is a separate, attended track and is not part
 * of this release. So there is no local replacement command to point at here;
 * do not try to run one. The successor lives on the overnight development
 * branch, and its full history is available via `git log --follow`.
 */
console.error(
  'ingest-bars.ts is deprecated. Its successor (the census command) is ' +
    'deliberately excluded from the Beta 1 RC — catalog expansion is a ' +
    'separate attended track, so no local replacement exists in this tree.',
);
process.exit(1);
