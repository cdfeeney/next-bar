import { redirect } from 'next/navigation';

/**
 * /discover — ARCHIVED for the current product (goal g-12d33864).
 *
 * This route used to be a Tinder-style swipe stack over the catalog (QA5-S3).
 * The operator archived it: every user-facing entry point is gone (the
 * "Discover →" link on /map and the Want-to-go empty state now point at /map),
 * and the route itself redirects rather than 404s so any bookmark, share, or
 * indexed link still lands somewhere sensible.
 *
 * The implementation is NOT kept behind a flag and there is no archive/ copy:
 * dead code that still compiles is code that still has to be reviewed, kept
 * type-correct, and reasoned about. **Git history is the archive** —
 * `git log --follow -- src/app/discover/page.tsx` restores it in one command,
 * along with its e2e spec.
 *
 * TEMPORARY (307), not permanent (308), deliberately. The operator said
 * "archive for the current product", not "delete forever"; a 308 is cached hard
 * by browsers and would make reviving /discover a support problem long after the
 * server stopped redirecting. `redirect()` defaults to 307 for exactly this kind
 * of reversible move.
 */
export default function DiscoverPage(): never {
  redirect('/map');
}
