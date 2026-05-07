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

- 10-question vibe quiz with archetype derivation
- 15 hand-curated bars across LES, East Village, and Williamsburg
- Match scoring against the user's vibe profile
- Distance estimation (haversine + human-friendly formatting)
- Tailwind theme with dark surface + warm accent
- Supabase schema for profiles, bars, visits, saves, and waitlist (with RLS)

## What's next

- Bar detail pages with photos and hours
- Real-time hours / busy-ness signals
- Auth + saved bars per user
- Friend match (compare profiles)
- Expand catalog beyond LES / East Village / Williamsburg

## iOS roadmap

The validation phase is intentionally web-only. The iOS app launches in week 8+ via Expo + TestFlight, sharing the same Supabase backend and matching logic. An Apple Developer account is required at TestFlight time.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Local dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | Type-check without emitting |
