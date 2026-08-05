/**
 * DEPRECATED (2026-08-02, goal g-4531bbf0): superseded by the provider-based
 * census command, which absorbed this script's Google tile sweep (primary-type
 * bar filter and tile grain ported verbatim) as its `google` adapter.
 *
 * That census tooling is INTENTIONALLY ABSENT from the Beta 1 release
 * candidate — catalog expansion is a separate, attended track and is not part
 * of this release. There is therefore no local replacement command to point
 * at here; do not try to run one. The successor lives on the overnight
 * development branch, and its full history is available via
 * `git log --follow`.
 *
 * This stub remains so stale invocations fail LOUDLY instead of spending
 * Places quota through an unmaintained path.
 */
console.error(
  'nearby-sweep.mjs is deprecated. Its successor (the census google adapter) ' +
    'is deliberately excluded from the Beta 1 RC — catalog expansion is a ' +
    'separate attended track, so no local replacement exists in this tree.',
);
process.exit(1);
