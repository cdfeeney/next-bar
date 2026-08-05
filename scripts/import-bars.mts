/**
 * DEPRECATED (2026-08-02, goal g-4531bbf0): superseded by the census apply
 * path, which bound catalog writes to a reviewed dry-run report (sidecar hash
 * + provenance check) on top of the same boundary validation, dedup, and
 * chunked-insert logic this script pioneered.
 *
 * That census tooling is INTENTIONALLY ABSENT from the Beta 1 release
 * candidate — catalog expansion is a separate, attended track and is not part
 * of this release. There is therefore no local replacement command to point
 * at here; do not try to run one. The successor lives on the overnight
 * development branch, and its full history is available via
 * `git log --follow`.
 */
console.error(
  'import-bars.mts is deprecated. Its successor (the census apply path) is ' +
    'deliberately excluded from the Beta 1 RC — catalog expansion is a ' +
    'separate attended track, so no local replacement exists in this tree.',
);
process.exit(1);
