import { notFound } from 'next/navigation';

/**
 * /u/[handle]/night/[shareId] — RETIRED (WP7, EC-04, founder decision).
 *
 * This route served the legacy Shared Night link: an anonymous, token-keyed
 * view of another account's night, carrying their handle, display name and a
 * `loved_bar_id` — the legacy Loved / Liked / Pass tier. The founder-approved
 * V8 contract 3.1.0 contains no `shared_night`, no `share_night`, no
 * `loved_bar_id` and no "share token" as a product concept, and V8-R-RNK-001
 * excludes tiers from the V8 model as legacy implementation concepts. No
 * replacement — tier or numeric — is approved, so the surface is retired
 * rather than migrated.
 *
 * The enforcement is server-side: migration 0068 DROPS
 * `public.get_shared_night(uuid)` along with `share_night` and
 * `unshare_night`. That RPC held a live **anon** EXECUTE grant, which is what
 * made this a security retirement and not only a product one. This file is the
 * client half — the route answers 404 and reads nothing.
 *
 * DO NOT CONFLATE THIS WITH TWO SURFACES THAT STAY:
 *   * Saved Nights Out (V8-R-NO-009, V8-R-ACC-002) — an approved PRIVATE
 *     in-app archive, not a public link, sharing no code path with this route.
 *   * /night-out/[token] (V8-R-INV-001..007) — the approved bearer-token
 *     Night Out invitation preview, which is anon-readable by design.
 *
 * Deleting the file itself is left to the attended integration gate; a route
 * that answers notFound() is already retired for every caller.
 */
export default function RetiredSharedNightPage(): never {
  notFound();
}
