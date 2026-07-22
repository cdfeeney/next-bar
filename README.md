# Next Bar

A vibe-quiz-based bar discovery app for young people in NYC. Take a 10-question quiz, get a vibe profile, and find bars that match — starting with hand-curated picks across LES, East Village, and Williamsburg.

## Quick start (Windows PowerShell)

```powershell
npm install
npm run dev
```

Then open http://localhost:3000.

## Optional: Supabase setup

The app works fully without Supabase (waitlist signups will no-op gracefully). To enable persistence:

1. Create a project at https://supabase.com
2. Run `supabase/schema.sql` in the SQL editor
3. Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

4. Restart `npm run dev`.

## What's built

- Vibe quiz with archetype derivation
- 40 hand-curated bars across 8 Manhattan neighborhoods
- "Where next?" in-the-moment flow (seed bar → GPS → radius → matches → map)
- Match scoring against the user's vibe profile
- Personal **Rankings** with 0–10 pairwise scoring (Beli-style)
- **Friends** social layer — follow curators, see their ranked lists, profiles
- **"Where should we go?"** group consensus — bars the whole group rated highly
- Distance estimation (haversine + human-friendly formatting)
- PWA install (manifest + icons + service worker) for Add-to-Home-Screen
- Tailwind theme with dark surface + warm accent
- Supabase schema for profiles, bars, visits, saves, and waitlist (with RLS)

### Demo mode (no backend required)

The Friends, profiles, and consensus features are seeded with realistic curator
data so the full product is demonstrable with **zero setup** — no Supabase, no
account. Load a "sample night" of your own ratings from **Settings → Demo** (or
the Rankings empty state) to light up Rankings and add yourself to the group
consensus. See **[docs/DEMO-GUIDE.md](docs/DEMO-GUIDE.md)** for a 5-minute
client walkthrough.

## What's next

- Bar detail pages with photos and hours
- Real-time hours / busy-ness signals
- Real accounts + cross-device sync (Supabase wired; magic-link ready)
- Phone-contact friend discovery (native app)
- Expand catalog to the outer boroughs

## iOS roadmap

The validation phase is intentionally web-only. The iOS app launches in week 8+ via Expo + TestFlight, sharing the same Supabase backend and matching logic. An Apple Developer account is required at TestFlight time.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Local dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | Type-check without emitting |
