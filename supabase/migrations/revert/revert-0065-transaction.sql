-- Runnable, atomic rollback of migration 0065 (Stories). This is THE rollback path.
--
-- HOW TO RUN IT: see README.md in this directory, which is the single source for
-- the command and for what the revert costs. It is deliberately not restated here.
--
-- WHAT THIS COSTS, stated plainly before you run it: dropping public.stories
-- DESTROYS every published story row, its audience rows and its tags. The image
-- BYTES are not touched — they live in the `story-media` bucket, and after this
-- revert nothing in the database references them, so they become orphans that
-- must be swept separately. Decide about the bytes BEFORE reverting; this script
-- deliberately does not delete them, because a rollback that silently destroys
-- user media is worse than one that leaves a sweepable remainder.
--
-- Dropping the schema and unrecording the migration MUST be one transaction. If
-- they come apart, the ledger claims 0065 while the tables are gone, and every
-- ledger-aware tool then acts on a false picture — the same split 0064's header
-- records as the hazard.

-- No `\set ON_ERROR_STOP on` here, deliberately: it is a psql CLIENT metacommand
-- and Postgres rejects it as a syntax error over any other client. The documented
-- psql command already passes `-v ON_ERROR_STOP=1`, and every statement below is
-- inside the one transaction, so any failure aborts the whole thing regardless of
-- client. Keeping this file pure SQL is what lets both clients run it verbatim.

BEGIN READ WRITE;

-- SET LOCAL, inside this transaction, on purpose — same reasoning as 0064's
-- revert: a session-level SET leaks onto the pooler's pinned backend, and an
-- unbounded blocked DROP holds this transaction open while it waits.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Storage policies first: they reference public.stories and public.is_mutual_friend,
-- so they must go before the objects they depend on.
DROP POLICY IF EXISTS "story-media: audience reads referenced" ON storage.objects;
DROP POLICY IF EXISTS "story-media: owner reads own prefix" ON storage.objects;
DROP POLICY IF EXISTS "story-media: owner writes own prefix" ON storage.objects;
DROP POLICY IF EXISTS "story-media: owner deletes own prefix" ON storage.objects;

-- The bucket ROW is left in place on purpose when it still holds objects: see
-- the note above about orphaned bytes. Removing an empty bucket is safe, so this
-- deletes it only in that case and otherwise leaves it for a deliberate sweep.
DELETE FROM storage.buckets b
 WHERE b.id = 'story-media'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);

DROP FUNCTION IF EXISTS public.remove_my_story_tag(uuid);
DROP FUNCTION IF EXISTS public.delete_story(uuid);
DROP FUNCTION IF EXISTS public.publish_story(text, text, text, text, text, text, uuid[], uuid[]);

-- Children before parent; the FKs are ON DELETE CASCADE but the DROPs are
-- explicit so the order is legible rather than implied.
DROP TABLE IF EXISTS public.story_tags;
DROP TABLE IF EXISTS public.story_audience;
DROP TABLE IF EXISTS public.stories;

-- is_mutual_friend was introduced by 0065 and nothing before it used the name.
-- Dropped last, after every policy and function that referenced it.
DROP FUNCTION IF EXISTS public.is_mutual_friend(uuid, uuid);

-- Unrecord the migration IN THE SAME TRANSACTION as the drops above.
DELETE FROM public.schema_migrations WHERE name = '0065_stories.sql';

COMMIT;
