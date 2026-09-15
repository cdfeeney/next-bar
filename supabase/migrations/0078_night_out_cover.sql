-- 0078 — a cover on a night out (social redesign 2026-09-13, S-06b).
--
-- ONE additive, nullable column and ONE new writer. Nothing existing is
-- changed: no backfill, no default, no drop, no function is replaced. Applied
-- to STAGING on the owner's word (2026-09-14); production gets the same file as
-- its own explicitly authorised step BEFORE any production deploy that carries
-- the cover feature — a build that reads `cover` against a database without the
-- column breaks every plan surface (HANDOFF-20260915.md, promotion path §5).
--
-- VALUE SHAPE. `template:<key>` names one of the bundled covers under
-- `public/covers/`. That is the only shape this migration accepts on purpose:
-- a library upload has to be readable through `media_read_window` and kept out
-- of `claim_orphan_paths`, and both of those live in the media boundary
-- (0066/0077), which this goal is not allowed to touch. When the library path
-- is authorised, a later migration widens the check to `media:<uuid>` and
-- teaches those two functions about covers; readers already treat any
-- unrecognised value as "no cover".
--
-- READ PATH. Members read the column through the existing
-- `night_outs_select_member` policy (0044) — `select cover from night_outs
-- where id = ...` — so no reader function is added and `get_night_out`'s return
-- shape is untouched.

alter table public.night_outs
  add column if not exists cover text;

comment on column public.night_outs.cover is
  'S-06b. NULL = no cover. `template:<key>` = a bundled cover under public/covers/. Reserved for a later, separately authorised migration: `media:<uuid>` (a library upload, once the media boundary knows about covers).';

-- 0047 revoked the table-level SELECT on night_outs and re-granted an explicit
-- column list, precisely so that a new column stays unreadable until someone
-- grants it on purpose. This is that on-purpose grant (round-1 panel, Fable
-- HIGH): without it every client read of `cover` is refused with 42501 before
-- RLS is even consulted, and the write side — a SECURITY DEFINER function —
-- would keep succeeding, so a chosen cover would be stored and never shown.
-- RLS (night_outs_select_member) still scopes the read to owner and members.
grant select (cover) on table public.night_outs to authenticated;

-- set_night_out_cover — the owner picks (or clears) the cover.
--
-- Same contract as set_night_out_area (0068): owner only, while the plan is
-- draft/open, NULL clears, anything the column does not accept is refused with
-- false rather than stored. The key alphabet is the file-name alphabet of
-- public/covers/, so a value that passes here always names a real asset path.
create or replace function public.set_night_out_cover(
  p_night_out uuid,
  p_cover     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null then
    return false;
  end if;
  if p_cover is not null and char_length(btrim(p_cover)) = 0 then
    p_cover := null;
  end if;
  if p_cover is not null and p_cover !~ '^template:[a-z0-9-]{1,40}$' then
    return false;
  end if;

  update public.night_outs
     set cover = p_cover
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open');
  return found;
end;
$$;

revoke all on function public.set_night_out_cover(uuid, text) from public, anon;
grant execute on function public.set_night_out_cover(uuid, text) to authenticated;

comment on function public.set_night_out_cover(uuid, text) is
  'S-06b. The owner sets or clears the plan cover while the plan is draft/open. Accepts NULL or `template:<key>`; any other shape returns false. Mirrors set_night_out_area.';
