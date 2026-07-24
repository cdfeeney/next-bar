/**
 * B5c-3 review-mining, step 1: extract per-bar mining packets from the
 * CACHED review snippets (zero Google cost — reads the sidecar via the
 * merged catalog snapshot, no network).
 *
 * Emits JSON to stdout: [{ id, name, neighborhood, priceTier, tags,
 * blurb, reviews: [{ text, rating }] }] for every bar that is
 *   - not CLOSED_PERMANENTLY (dead bars aren't worth re-tagging), and
 *   - not identity-quarantined (wrong-venue Places match: its fetched
 *     reviews describe a DIFFERENT venue — mining them would poison the
 *     tags; see docs/CATALOG-CLEANUP-2026-07-25.md), and
 *   - carrying at least one cached review snippet.
 *
 * Review authors are deliberately dropped from the packets: the mining
 * agents only need text + star rating, and attribution stays a rendering
 * concern.
 *
 * Run: npx tsx scripts/review-mining-extract.mts [> packets.json]
 * Rerun after each monthly `refresh-places.mjs --reviews` pass.
 */
import { getBarsSnapshot } from '../src/lib/catalog';

/** Wrong-venue Places matches: cached data is another venue's. */
const QUARANTINED_IDS = new Set(['bootleg-bar']);

const packets = getBarsSnapshot()
  .filter(
    (b) =>
      b.businessStatus !== 'CLOSED_PERMANENTLY' &&
      !QUARANTINED_IDS.has(b.id) &&
      (b.reviews?.length ?? 0) > 0,
  )
  .map((b) => ({
    id: b.id,
    name: b.name,
    neighborhood: b.neighborhood,
    priceTier: b.priceTier,
    tags: b.tags,
    blurb: b.blurb,
    reviews: (b.reviews ?? []).map((r) => ({ text: r.text, rating: r.rating })),
  }));

console.log(JSON.stringify(packets, null, 1));
