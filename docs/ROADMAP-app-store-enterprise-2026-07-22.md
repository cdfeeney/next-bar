# Next Bar — Roadmap to POC / App Store / Enterprise-ready (2026-07-22)

Written after the catalog+ranking+places session (catalog 105→269, geocoded, blended
ranking, open-now, CTA nudge; commits `ca6531a`…`4d374a7`, pushed to `main`).

---

## What the three "ready" targets actually mean for Next Bar

### 1. POC-ready — "a friend can open a real URL and use it"
Mostly already true locally. Gaps to make it *shareable*:
- **Deploy to a public URL** (Vercel — env vars already reference `VERCEL_URL`/`NEXT_PUBLIC_SITE_URL`). → **needs you** (Vercel login).
- **Real auth + sync** — Supabase auth scaffolding exists (`useAuth`, migrations) but runs in `unavailable` mode without keys. Wire real `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`. → **needs you** (Supabase project).
- **Social layer demo→real** — friends/follows/rankings are localStorage/demo; needs Supabase tables + RLS to be real. → code, but blocked on keys.

### 2. App-Store-ready — "it's in the iOS App Store"
Two separate things: **Apple's content requirements** (code) and **the build+submit pipeline** (you + tooling).

**Apple content requirements (CODE — loopable):**
- **Privacy policy page** (Apple hard-requires a reachable URL). ❌ missing.
- **Account deletion** in-app (Apple hard-requires it if you have accounts). ❌ missing (deferred in v0.5).
- **Terms of service** page. ❌ missing.
- **17+ age rating / alcohol gate** — a bar app must be rated 17+; add an age acknowledgement. ❌ missing.
- **App icons + App Store screenshots** (multiple sizes), no dead links, no placeholder text.
- **Manifest polish** — `screenshots`, `shortcuts` (has description/categories already).

**Build + submit pipeline (NEEDS YOU + tooling):**
- Wrap PWA → **PWABuilder** (Windows-friendly) or Capacitor. → you.
- **Cloud-Mac build** (PWABuilder cloud, EAS, or Codemagic) since you have no Mac. → you ($).
- **Apple Developer Program** enrollment — $99/yr. → you.
- **App Store Connect** listing + submission + review (~24–72h). → you.

### 3. Enterprise / production-grade — "reliable, secure, observable"
For a consumer app this = production-hardening:
- **CI/CD** — GitHub Actions running typecheck + vitest + build + e2e on every push. ❌ none (`.github/workflows` missing). → **CODE, loopable.**
- **Error monitoring** (Sentry) + **product analytics** (PostHog/Plausible). ❌ none. → mostly code, needs a key.
- **Security**: Supabase RLS review, rate limiting on `/api/*`, secrets hygiene, input validation at boundaries. → code + review.
- **Observability**: health check route, uptime monitor. → code.
- **Data/privacy**: GDPR-ish data export/delete (overlaps account-deletion).

---

## The split that decides the overnight loop

**NEEDS YOU (cannot loop — external accounts / money / decisions):**
Vercel deploy · Supabase keys · Google Places key+billing · Apple Developer $99 · cloud-Mac build
signup · App Store Connect listing/screenshots/copy · Sentry/analytics keys · legal *content* of
privacy/terms.

**CODE-ABLE (loop-safe: objective test/build gate, disjoint files, no external deps):**
1. `/privacy`, `/terms` pages (structure + placeholder legal copy marked TODO).
2. **Account-deletion UI** in Settings (client flow + a `deleteAllLocalData()` that clears
   ratings/profile; server delete stubbed behind the auth path).
3. **17+ age-acknowledgement gate** (one-time, localStorage, dismissible).
4. **CI workflow** `.github/workflows/ci.yml` (typecheck + vitest + build).
5. **Error boundary + loading/empty states** across routes.
6. **Manifest `screenshots` + `shortcuts`**; PWA offline polish.
7. **Accessibility hardening** pass (a11y-mobile e2e already exists — extend).
8. **Health check** route `/api/health`.
9. **Input validation** on `/api/waitlist` + any boundary.
10. Test coverage for each of the above.

These are **disjoint** (mostly new files) → good for either a supervised `/orchestrate` fan-out OR a
single **loop-guarded** overnight worker.

---

## Tonight's overnight loop — HONEST scope + guardrails

The overnight-loop pattern is proven **when scope is tight and the gate is objective** (the harness's
own experiments were test-only, on frozen code, gated on `npm test`). Apply the same discipline:

- **Loop ONLY the 10 CODE-ABLE items above.** They build/test-gate objectively and need no keys.
- **loop-guard, not raw `/loop`** — `loop-guard start --max-iters N --weekly-util <from /usage>`, each
  iteration = implement one item → `npm test && npx tsc --noEmit && npm run build` → `checkpoint`
  (revertible commit). Stop on cap or when the list is done.
- **Escalate, don't fake.** If an item needs a key/account/decision, the loop must **STOP that item and
  record it** for the morning — never stub in fake keys or weaken a test to go green. (This is the exact
  behavior the blind trust-test verified loops actually follow.)
- **Do NOT** run the full multi-worktree `/orchestrate` unattended — that runbook needs supervision.
  Overnight = one loop-guarded worker on the bounded list.
- Morning review: which items landed green + mergeable, which escalated, cost vs attended.

---

## Recommended sequence

1. **Now / supervised:** `/blueprint` this doc's objective → get the step DAG + per-step context briefs.
2. **Tonight / unattended:** loop-guard a worker over the 10 code-able items (Phase 2 + CI/hardening).
3. **Tomorrow / you:** the account/money/build steps (Vercel, Supabase keys, Apple, cloud-Mac) — these
   unblock the "real" versions of the looped scaffolding.

---

## CONTINUATION PROMPT (paste into a fresh session tonight)

```
Resume Next Bar — drive App-Store + production readiness. Repo: C:\Users\cdfee\projects\next-bar
(Next.js 14 + TS + Tailwind + Supabase PWA). Current: catalog 269 bars (geocoded via Nominatim),
blended vibe+proximity+loved ranking, open-now badge (client-side from hours), subtle install nudge.
212 vitest + e2e green; tsc + build 18/18 clean. All work committed & PUSHED to origin/main
(HEAD 4d374a7). Read docs/ROADMAP-app-store-enterprise-2026-07-22.md FIRST — it has the full plan.

GOAL: get Next Bar App-Store-ready and production-hardened. Do the CODE-ABLE work; ESCALATE (don't
fake) anything needing an external account/key/decision (Apple $99, Vercel/Supabase/Google/Sentry
keys, cloud-Mac build, product/legal copy).

STEP 1 — plan: run /blueprint "make Next Bar App-Store-ready + production-hardened" — decompose into
disjoint, test-gated steps (privacy/terms pages, account-deletion UI, 17+ age gate, CI workflow,
error boundaries, manifest screenshots/shortcuts, a11y pass, /api/health, input validation, tests).

STEP 2 — TONIGHT, UNATTENDED: loop-guard ONE worker over those code-able steps. Launch:
loop-guard start --max-iters 12 --weekly-util <from /usage>, then a self-paced /loop where each tick =
implement one step → `npm test && npx tsc --noEmit && npm run build` (+ e2e for interactive steps) →
loop-guard checkpoint (revertible commit). Rules: escalate-don't-fake (no stub keys, never weaken a
test to pass); keep the build green every tick; one worktree; NEVER push without an explicit ask.
Do NOT run the full multi-worktree /orchestrate unattended (needs supervision). Stop at the cap.

STEP 3 — morning: report per-step (landed green & mergeable? escalated & why?), cost vs attended,
and the list of account/key/build steps left for the operator.

CONSTRAINTS: Windows/git-bash (harmless CRLF warnings). Tier T1 (no project tier-map). Every
interactive feature gets an e2e + per-route smoke test (repo CLAUDE.md). Routed GLM/DeepSeek only via
~/.claude/bin/harness-consult.mjs. Note: src/lib/bars.places.ts may hold uncommitted DEMO hours from
the last session — `git checkout src/lib/bars.places.ts` to reset to the empty committed sidecar
before starting.
```
