# Next Bar — Client Demo Guide

A 5-minute, zero-setup walkthrough you can run on a laptop or a phone to show a
client exactly how Next Bar works — including the social "where should we go?"
layer that is the heart of the pitch.

> **One-line pitch:** Beli for bars. Take a 10-second vibe quiz, get bars
> matched to your taste, rate the ones you go to (scored 0–10 like Beli), and
> find the spot your whole group actually agrees on.

Everything below works **without any backend, account, or API key.** The app
runs fully on the device; the social layer is seeded with realistic curator
profiles so the demo is never an empty screen.

---

## Run it

### Local (fastest)

```powershell
npm install
npm run build
npm run start      # http://localhost:3000
```

Open `http://localhost:3000` in a browser. Use the browser's device toolbar
(Chrome DevTools → toggle device → iPhone) to show it at phone size — the app
is designed mobile-first.

### Dev mode (for editing live)

```powershell
npm run dev        # http://localhost:3000, hot reload
```

---

## The demo script (≈5 minutes)

Run these in order. Each step has a "say this" line and the tap to make.

### 1. The hook — the marketing page

- Go to **`/install`**.
- *"Next Bar is the anti-'same three bars' app. You tell it the vibe, it picks
  the next place."* Scroll the page — it doubles as the App Store landing.

### 2. The vibe quiz → a matched list

- Tap **Take the vibe quiz** (or go to **`/quiz`**).
- Answer the 6 quick questions. *"Ten seconds, no signup."*
- You land on a ranked list of Manhattan bars matched to those answers, each
  with a distance and a "why it matched" line.

### 3. "Where next?" — the core loop

- Go to **`/`** (the **Next Bar?** tab).
- Pick the bar you're standing at → confirm location → choose how far you'll
  travel → **Show me bars**.
- *"This is the in-the-moment use case: you're already out, you want the next
  spot within walking distance."*

### 4. Rankings — your personal 0–10 list

- Go to the **Rankings** tab. It's empty on a fresh device — that's honest.
- Tap **"Or load a sample night to see it in action."**
  (Or do it from **Settings → Demo → Load sample night**.)
- *"After a few nights out, this is your personal leaderboard — every bar scored
  0–10 by your own taste, not a crowd average."*

### 5. Friends — the social layer (the real pitch)

- Go to the **Friends** tab.
- *"This is where it becomes Beli. You follow people whose taste you trust — not
  influencers."* Point out the curator cards (Maya, Jordan) with their top picks
  and scores. Tap **Follow** on Sasha to show the feed grow.
- Tap a friend → their full profile and ranked list at **`/u/maya`**.

### 6. "Where should we go?" — the money moment

- On Friends, tap the big **Where should we go? →** card.
- *"Group-chat paralysis, solved."* The chips at the top are everyone who's out.
  The list below is the bars **the whole group rated highly** — and it quietly
  drops anything anyone passed on.
- Toggle a person off and on to show the list recompute live. Each pick shows
  who voted and their score.

### 7. Install as an app (the App Store story)

- On phone Safari/Chrome: **Share → Add to Home Screen.** It installs as a
  full-screen app with its own icon (PWA).
- *"This is the same UI that ships to the App Store via the native wrapper —
  same matching engine, same screens."*

---

## What's real vs. seeded (be honest with the client)

| Area | In the demo | In production |
| --- | --- | --- |
| Bar catalog | 40 hand-curated Manhattan bars | Same, expanding by neighborhood |
| Vibe quiz + matching | **Real** — live algorithm | Same |
| Where-next + map | **Real** — live, uses GPS | Same |
| Your rankings + 0–10 scoring | **Real** logic; "sample night" pre-fills data | Same, persisted to your account |
| Friends / profiles | **Seeded curators** (Maya, Dev, Sasha, Jordan) | Real users you follow |
| Consensus "where should we go?" | **Real** algorithm over seeded + your data | Same over real friends |
| Accounts / cross-device sync | Optional (Supabase) — off in the demo | Email magic-link, then Sign in with Apple |

The matching, scoring, and consensus **engines are production code** — only the
*friend population* is seeded so the demo isn't empty. The same screens light up
with real data the moment accounts are switched on.

---

## Growing the bar catalog

The catalog lives in `src/lib/bars.ts` (core) + `src/lib/bars.extra.ts` (the
Manhattan-depth + Brooklyn expansion). There are two ways to add more:

**By hand:** add a `Bar` object (id, name, neighborhood, address, lat/lng,
priceTier, tags, blurb, lastVerified). The `tags` drive matching.

**Via the ingestion pipeline** (`scripts/ingest-bars.ts`) — pulls real bars per
neighborhood, dedupes against the existing catalog, seeds heuristic vibe tags,
and writes `scripts/data/candidates.json` for a curation pass:

```powershell
# Free, no key — OpenStreetMap (what shipped the Brooklyn batch):
npx tsx scripts/ingest-bars.ts
npx tsx scripts/ingest-bars.ts --area=Williamsburg   # single area

# Richer data (price, ratings) — Google Places:
$env:GOOGLE_MAPS_API_KEY = "your-key"
npx tsx scripts/ingest-bars.ts --source=google
```

To get a Google Maps key: console.cloud.google.com → create a project →
enable **Places API** → Credentials → create an API key (a billing account
with a card is required; Maps Platform includes a recurring free credit).

After ingesting, curate the strong candidates into `bars.extra.ts` with
accurate tags + blurbs (real businesses → review the details before launch).

## Deploying a shareable web demo

To hand the client a link (and to capture App Store screenshots):

1. Push the repo to GitHub.
2. Import it into **Vercel** (framework auto-detected: Next.js).
3. No env vars are required — the app runs in local/seeded mode without
   Supabase. (Add `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` later to enable
   real accounts.)
4. Vercel gives you `https://next-bar-<hash>.vercel.app`. Open it on a phone and
   **Add to Home Screen** for the installed-app demo.

For the iOS App Store submission path itself (PWABuilder + iTMSTransporter on
Windows, or cloud Mac CI), see `README.md` → *iOS roadmap*. Connor is on
Windows; no local `xcodebuild` is assumed.
