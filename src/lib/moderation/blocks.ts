import type { SupabaseClient } from '@supabase/supabase-js';

import { mediaFailure, mediaUnavailable, type MediaResult } from '@/lib/media/types';

/**
 * Blocking (V8-R-FEED-009).
 *
 * "Blocking PREVENTS VISIBILITY AND INTERACTION BETWEEN THE AFFECTED USERS."
 * Between — not "the blocker stops seeing the blocked user". The requirement's
 * trust boundary line is blunt about what does not count: "SERVER-ENFORCED IN
 * BOTH DIRECTIONS — a client-side hide is not a block."
 *
 * So the enforcement primitive here is {@link isBlockedBetween}, which asks
 * 0066's `is_blocked_between` — a SECURITY DEFINER function that sees a block
 * row whichever side is asking. A query against `profile_blocks` through RLS
 * would answer correctly for the blocker and WRONGLY for the blocked party,
 * because they cannot read the row that blocks them, and that is precisely the
 * direction an attacker is on.
 *
 * Group scope, per the requirement: a block additionally prevents new direct
 * interaction, invitations, or addition to NEW shared groups. It does not
 * retroactively dissolve existing shared groups, and nothing here tries to —
 * the exclusion is explicit in the contract.
 */

/**
 * Is there a block in EITHER direction between these two profiles?
 *
 * Fails CLOSED. When the check cannot be completed, this returns `true`
 * (treat as blocked) rather than false: showing content because a lookup broke
 * is the failure this requirement exists to prevent, and "the network hiccuped"
 * is not a reason to let two blocked users see each other.
 */
export async function isBlockedBetween(
  client: SupabaseClient | null,
  profileA: string,
  profileB: string,
): Promise<boolean> {
  if (client === null) return true;

  try {
    const { data, error } = await client.rpc('is_blocked_between', {
      a: profileA,
      b: profileB,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/**
 * Block someone.
 *
 * The blocking user owns the record, so the row is written through their own
 * client and 0066's insert policy pins `blocker_id` to `auth.uid()`: a caller
 * cannot create a block on somebody else's behalf.
 *
 * "a failed block must not report success; fail closed."
 */
export async function blockProfile(
  client: SupabaseClient | null,
  blockedId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();

  try {
    const { data: auth } = await client.auth.getUser();
    const blockerId = auth?.user?.id;
    if (!blockerId) {
      return mediaFailure('denied', 'Sign in to block someone.');
    }
    if (blockerId === blockedId) {
      return mediaFailure('failed', 'You cannot block yourself.');
    }

    // Idempotent: blocking twice is not an error, and must not surface as one.
    const { error } = await client
      .from('profile_blocks')
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
      );

    if (error) {
      return mediaFailure('failed', 'They could not be blocked. Try again.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Lift a block. "until the block is lifted, or account deletion" is the stated
 * retention, so this is the documented way out rather than an extra.
 */
export async function unblockProfile(
  client: SupabaseClient | null,
  blockedId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();

  try {
    const { data: auth } = await client.auth.getUser();
    const blockerId = auth?.user?.id;
    if (!blockerId) {
      return mediaFailure('denied', 'Sign in to manage blocks.');
    }

    const { error } = await client
      .from('profile_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);

    if (error) {
      return mediaFailure('failed', 'That block could not be lifted.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * The caller's own block list, for Settings · Connections · Blocked & muted.
 *
 * "the blocked state is stated, not implied by absence" — the surface needs a
 * list it can render, not a set of gaps in other lists.
 */
export async function listBlockedProfiles(
  client: SupabaseClient | null,
): Promise<MediaResult<string[]>> {
  if (client === null) return mediaUnavailable();

  try {
    const { data, error } = await client
      .from('profile_blocks')
      .select('blocked_id')
      .order('created_at', { ascending: false });

    if (error) {
      return mediaFailure('failed', 'Your blocked list could not be loaded.');
    }

    const rows = (data ?? []) as { blocked_id: string }[];
    return { ok: true, value: rows.map((r) => r.blocked_id) };
  } catch {
    return mediaUnavailable();
  }
}
