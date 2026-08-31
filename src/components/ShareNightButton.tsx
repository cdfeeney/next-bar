import type { Recap } from '@/lib/recap';

/**
 * "Share last night" — RETIRED (WP7, EC-04, founder decision).
 *
 * This control published a night to `public.share_night`, minting the bearer
 * token behind /u/[handle]/night/[shareId]. That link was readable by anyone,
 * and its read RPC — `public.get_shared_night(uuid)`, a SECURITY DEFINER
 * function with a live **anon** EXECUTE grant — returned the account's handle,
 * display name and `loved_bar_id`, the legacy Loved / Liked / Pass tier.
 *
 * The founder-approved V8 contract 3.1.0 contains no `shared_night`,
 * `share_night`, `loved_bar_id` or "share token" as a product concept, and
 * V8-R-RNK-001 excludes tiers from the V8 model. No replacement is approved,
 * so the control is retired rather than rebuilt on a numeric score.
 *
 * It renders NOTHING. R5 (no dead controls) is the reason it is not merely
 * disabled: migration 0068 drops all three RPCs, so a visible button could
 * only ever fail. The component and its `recap` prop are kept so RecapCard —
 * which is owned by another packet and must not be edited from this lane —
 * keeps compiling; removing the file itself belongs to the attended
 * integration gate.
 *
 * NOT retired, and not to be confused with this: Saved Nights Out
 * (V8-R-NO-009, V8-R-ACC-002) is an approved PRIVATE in-app archive with no
 * public link and no shared code path.
 */
export default function ShareNightButton(_props: { recap: Recap }): null {
  return null;
}
