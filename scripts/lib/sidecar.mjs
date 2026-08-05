/**
 * Invariants for the generated Places sidecar (src/lib/bars.places.ts).
 *
 * WHY THIS MODULE EXISTS. The sidecar is written by three different paths in
 * refresh-places.mjs (full refresh, --only, --photos-multi). A wrong-venue bbox
 * check used to live at runtime in bars.ts and was moved into the generator when
 * coordinates stopped being persisted — but it was placed at ONE fetch site, so
 * the other two paths silently bypassed it, and under --only it did worse than
 * bypass: a rejected bar's stale entry was carried forward by the merge, so the
 * "guard" perpetuated the very patch it was meant to reject.
 *
 * The invariant belongs to the DATA, not to whichever function happens to fetch
 * it. So it lives here, is enforced at the single point of serialisation, and is
 * unit-testable — refresh-places.mjs cannot be imported by a test because it has
 * top-level side effects (an unattended-loop guard, an API-key check, and
 * process.exit), which is exactly why its previous "tests" were source greps.
 *
 * .mjs deliberately: refresh-places.mjs runs under plain `node`, so it cannot
 * import the .mts modules elsewhere in scripts/lib.
 */

/**
 * The app's service area, mirrored from src/lib/constants.ts SERVICE_AREA_BBOX.
 * A test asserts the two agree, so this copy cannot drift silently.
 */
export const SERVICE_AREA = {
  minLat: 40.64,
  maxLat: 40.885,
  minLng: -74.03,
  maxLng: -73.89,
};

/**
 * Ids that legitimately appear in the sidecar without a row in the catalog
 * files — venues the mass import added to the bars table only.
 *
 * Single source of truth: src/lib/bars.test.ts imports this rather than keeping
 * its own copy. Keeping the list short is the point; 29 orphans accumulated
 * unnoticed because nothing was checking.
 */
export const DB_ONLY_SIDECAR_IDS = new Set(['pencil-factory']);

/** Coordinate fields that must never be persisted (Google allows 30 days; we ship forever). */
const FORBIDDEN_KEYS = ['lat', 'lng'];

export function insideServiceArea(lat, lng) {
  return (
    lat >= SERVICE_AREA.minLat &&
    lat <= SERVICE_AREA.maxLat &&
    lng >= SERVICE_AREA.minLng &&
    lng <= SERVICE_AREA.maxLng
  );
}

/**
 * True when a Details response carries a usable in-area location.
 *
 * FAILS CLOSED on a missing location. Previously an absent `location` skipped the
 * check entirely and the patch was written unvalidated — an unchecked write is
 * indistinguishable from a checked one once it is in the file.
 */
export function locationAcceptable(location) {
  const lat = location?.latitude;
  const lng = location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return insideServiceArea(lat, lng);
}

/**
 * Classify a Place Details response into the three outcomes that matter.
 *
 * WHY THREE AND NOT TWO. The first version of this fix collapsed everything that
 * was not acceptable into "reject", and rejection DELETES the venue's existing
 * sidecar entry. Codex review caught the consequence: `placeDetailsPhotosOnly`
 * had no `res.ok` check, so an HTTP 429/500 returns an error body with no
 * `location`, which looked identical to "resolved outside the service area" — and
 * a transient API blip would delete good data.
 *
 * So the two failure modes are separated, and they fail in OPPOSITE directions:
 *
 *   'accept'        in-area location. Safe to write.
 *   'reject'        a definite, in-hand location that is out of area. This venue's
 *                   place_id points somewhere else, so its stale entry should GO.
 *   'indeterminate' we could not tell — transport error, non-OK status, or a 200
 *                   with no usable location. Never write a new patch (fail closed
 *                   on WRITING), and never delete an existing one (fail safe on
 *                   DELETING). Deleting on ambiguity is destructive; declining to
 *                   write on ambiguity costs nothing.
 */
export function classifyDetailsLocation({ ok, json }) {
  if (!ok) return 'indeterminate';
  const lat = json?.location?.latitude;
  const lng = json?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return 'indeterminate';
  return insideServiceArea(lat, lng) ? 'accept' : 'reject';
}

/**
 * Throw unless every entry satisfies the sidecar's invariants.
 *
 * Enforced at serialisation so all three write paths — and any fourth added
 * later — are covered without the caller having to remember.
 *
 * Note what this CANNOT check: the bbox. The sidecar no longer stores
 * coordinates, so there is nothing here to test them against; that check can
 * only happen at fetch time, against the live Details response. This function
 * enforces what is observable in the artifact itself.
 */
export function assertSidecarWritable(patches, knownIds) {
  const withCoords = [];
  const unknown = [];

  for (const [id, patch] of Object.entries(patches)) {
    if (!patch || typeof patch !== 'object') {
      throw new Error(`sidecar: entry '${id}' is not an object`);
    }
    for (const key of FORBIDDEN_KEYS) {
      if (patch[key] !== undefined) withCoords.push(`${id}.${key}`);
    }
    if (!knownIds.has(id) && !DB_ONLY_SIDECAR_IDS.has(id)) unknown.push(id);
  }

  if (withCoords.length > 0) {
    throw new Error(
      `sidecar: refusing to write persisted coordinates (${withCoords.length}): ` +
        `${withCoords.slice(0, 8).join(', ')}. Google permits caching lat/lng for 30 ` +
        `consecutive days; this file ships to every client indefinitely. Coordinates ` +
        `come from OpenStreetMap — see migrations 0029-0032.`,
    );
  }
  if (unknown.length > 0) {
    throw new Error(
      `sidecar: refusing to write ${unknown.length} orphan entry/entries for venues ` +
        `in neither the catalog nor DB_ONLY_SIDECAR_IDS: ${unknown.slice(0, 8).join(', ')}. ` +
        `Add to the allowlist only if the venue really is DB-only.`,
    );
  }
}

/**
 * Preserve a bar's existing entry when this run could not determine its status.
 *
 * WHY THIS IS NEEDED ON THE FULL PATH TOO. The wholesale refresh builds `patches`
 * from scratch and writes it directly — no merge with `existing`, because dropping
 * bars that have left the catalog is the point. But a bar that hit `continue` on a
 * transient 429, a missing place_id, or a caught exception also never reached
 * `patches[bar.id] = patch`, so a single API blip silently stripped that venue's
 * place_id, hours and photo fields from the rewritten sidecar.
 *
 * Both santa-loop reviewers found this independently: the 'indeterminate' verdict
 * existed precisely to avoid destroying data on ambiguity, and it delivered that
 * on --only and --photos-multi while the DEFAULT path still dropped the entry.
 * The guarantee was asserted in a comment before it was true everywhere.
 *
 * Preserving per-bar rather than merging all of `existing` keeps wholesale
 * semantics intact: a venue removed from the catalog is never iterated, so it is
 * still correctly dropped. Only a bar we tried and could not resolve is kept.
 *
 * Returns true if something was preserved (for reporting).
 */
export function carryForwardExisting(patches, existing, id) {
  if (patches[id] !== undefined) return false;
  const prior = existing?.[id];
  if (prior === undefined) return false;
  patches[id] = prior;
  return true;
}

/**
 * Merge for --only, where existing entries must be carried forward so a targeted
 * run cannot wipe every other bar.
 *
 * `rejectedIds` are bars this run REJECTED (out of area, or no usable location).
 * Their existing entries are DELETED rather than carried forward. Without this,
 * `{ ...existing, ...patches }` preserved the stale entry of exactly the bar the
 * check had just rejected — the guard perpetuating instead of rejecting.
 */
export function mergeOnlyPatches(existing, patches, rejectedIds = new Set()) {
  const merged = { ...existing, ...patches };
  for (const id of rejectedIds) delete merged[id];
  return merged;
}
