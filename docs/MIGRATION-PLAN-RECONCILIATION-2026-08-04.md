# Migration number reconciliation — 2026-08-04 (overnight, g-31f36bf8)

Three queued workstreams each need "the next migration number after
0037", and two of them informally claimed 0038 in prose before any file
existed. As of tonight **no top-level 0038 file exists**; this document
is the single source of truth for who gets which number, so no
competing files are ever created.

| Number | Workstream | File state tonight | Apply gate |
|---|---|---|---|
| **0038** | Venue pins ("Pin where I am", g-31f36bf8) | **Authored tonight** as `supabase/migrations/drafts/0038_venue_pins.sql` — drafts/ is invisible to the runner (it reads only top-level `*.sql`) | Attended session: promote to top level, then apply |
| **0039** | Social hardening Phase B (g-c8b26779): `list_my_shared_nights` RPC + Close Friends schema | Not yet authored (was "next number after 0037" in prose) | Attended T0 migration session |
| **0040** | Night photos (g-e9d493e9) | Not yet authored (older docs call it "the 0038 night-photos draft" — that prose reference is RENUMBERED to 0040 by this document; no file ever existed under 0038 for photos) | Blocked goal; attended session |

Rules:

1. A number is claimed by an **authored .sql file** plus a row in this
   table — never by prose alone.
2. Drafts live in `supabase/migrations/drafts/` until their attended
   apply session promotes them; the runner (`npm run db:migrate`)
   ignores that directory, and the checksum ledger only ever sees
   promoted files.
3. If an attended session lands Phase B or photos first, it keeps the
   number assigned here even if that leaves a temporary gap in the
   applied sequence (files apply in lexical order; gaps are harmless,
   collisions are not).
4. Nothing in this document authorizes applying anything. Tonight's
   0038 draft is **never-applied**; Production and Staging were not
   touched.
