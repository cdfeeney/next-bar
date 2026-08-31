-- Next Bar — 0023: purge stored Google review text (Phase 1, criterion 16)
--
-- Audit at time of writing (read-only, 2026-07-28):
--   1,265 bars total
--     220 rows with a non-null `reviews` array
--     660 stored review items, each carrying {author, rating, text}
--
-- That is third-party review prose and reviewer names, about venues we do not
-- own, persisted in our own table. Google's Places terms do not permit storing
-- review content, and unlike opening hours it cannot be re-derived from a
-- first-party source — there is no compliant version of "someone else's review
-- text", only "don't keep it".
--
-- Operator decision 2026-07-28: the product does not need review snippets, so
-- the fix is deletion rather than a compliant replacement. The ingestion paths
-- that produced this data are frozen in the same commit:
--   * scripts/refresh-places.mjs   -- `--reviews` now exits 2
--   * scripts/seed-bars-table.mts  -- `reviews` is a hard null, so a re-seed
--                                     cannot re-introduce it from the sidecar
--
-- NOT ACTUALLY IRREVERSIBLE, which is why it is safe to run: the same review
-- data still exists in the sidecar source file src/lib/bars.places.ts and in
-- git history. Purging the sidecar and rewriting history is a separate, larger
-- job and is deliberately NOT attempted here. So this migration closes the
-- table-level violation only; the repo-level residue is tracked separately.
--
-- Product consequence: BarLightbox will show no review snippets. Accepted.
--
-- Idempotent: the WHERE clause makes a re-run a no-op.

update public.bars
   set reviews = null
 where reviews is not null;

-- The COLUMN is deliberately left in place. src/types/index.ts still declares
-- `reviews?: BarReview[]` and catalogServer.ts maps it, so dropping the column
-- would be a breaking schema change for a type-level cleanup that belongs with
-- the decision about whether first-party reviews ever ship. Nulled is the
-- compliance boundary; dropped is a product decision.

------------------------------------------------------------------------------
-- Rollback: none. The data is intentionally gone from this table. If reviews
-- are ever wanted again they must come from a permitted source, not from here.
------------------------------------------------------------------------------
