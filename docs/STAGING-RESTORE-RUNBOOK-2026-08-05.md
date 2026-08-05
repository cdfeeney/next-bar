# Staging restore — exact steps (prepared, NOT executed)

Fixes blocker **S1** (`docs/RELEASE-RECONCILIATION-2026-08-05.md`): the
`next-bar-staging` project has no serving deployment, so acceptance testing and
the rollback rehearsal cannot run.

**Nothing here has been executed.** Both actions are writes to Vercel and need
explicit approval.

## 0. The rule this runbook must not break

`next-bar` (Production) and `next-bar-staging` are **different projects backed
by different Supabase databases**:

| Project | Supabase ref | bars |
|---|---|---|
| `next-bar` (Production) | `nuhqlvneokucxomguxhi` | 1,256 |
| `next-bar-staging` | `wqxovhiovgcijmfzxgby` | 412 (incl. the census row; has 0037 + 0041) |

**No variable is ever copied from one project to the other, in either
direction.** Copying Staging's Supabase URL/anon key/`DATABASE_URL` into
`next-bar` would repoint live Production at the Staging database — a live
incident, and the exact thing `docs/MORNING-HANDOFF-2026-08-05.md` forbids.
Everything below happens **inside `next-bar-staging` only**.

## 1. Why Staging is down — two independent causes

**Cause A (found in the deploy logs).** The failed Production-target deployment
`next-bar-staging-n3penyjfd` uploaded a **9-file fragment**:

```
Extracted 9 deployment files...
Error: No Next.js version detected. Make sure your package.json has "next" in
either "dependencies" or "devDependencies". Also check your Root Directory
setting matches the directory of your package.json file.
```

A healthy preview deploy on the same project downloaded **4,009** files and
logged `Detected Next.js version: 14.2.35`. So this is a partial/wrong-root
CLI upload, not a code or dependency defect.

**Cause B (predicted, not yet hit).** Even with a full upload, the next attempt
would fail at the env gate. `next-bar-staging` has 11 variables and **ten are
Preview-scoped**; its Production target holds only `NEXT_PUBLIC_BUILD_SHA`.
`npm run build` runs `scripts/check-env.mjs` first, which exits 1 on an
`unknown` environment and on a deployment missing required Supabase config.
Fixing only Cause A therefore buys one more failure, not a working Staging.

## 2. Action 1 — scope the variables to that project's Production target

Add these, **in `next-bar-staging` only**, to its **Production** target, using
the values that already exist on its Preview entries (never retyped, never
printed):

| Variable | Note |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging ref `wqxovhiovgcijmfzxgby` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only |
| `DATABASE_URL` | server-only |
| `VERCEL_TARGET_ENV` | **must be `staging`**, see below |
| `NEXT_PUBLIC_ANALYTICS` | keep dark |
| `ANALYTICS_ENABLED` | keep dark; must agree with the line above |
| `NEXT_PUBLIC_PUSH_ENABLED` | keep disabled |
| `NEXT_PUBLIC_LEGACY_PHOTOS` | match Preview |

**`VERCEL_TARGET_ENV` must remain `staging`.** Vercel calls the deployment
*target* "production"; the app's *environment identity* must still be staging,
or `check-env` and the environment guards will evaluate this deployment as
Production and apply Production rules to a Staging database.

**Side effect to accept deliberately:** this restores a public web surface in
front of protected Staging (`wqxovhiovgcijmfzxgby`) — the same database holding
the census work and migrations 0037/0041. That is required for acceptance
testing, but it is a genuine change in exposure and should be part of the
approval, not a surprise.

**Note on the preview-credential finding (E2).** `DATABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` currently sit on that project's **Preview** scope,
which is the shape `envCheck` flags as a violation. The correct end state is
those two on the **Production target of the Staging project**, and removed from
Preview — but removing them is a separate decision, since preview deploys may
currently depend on them. Recommend: add to Production target now, review the
Preview entries afterward.

## 3. Action 2 — deploy full source at `6ec5e5d`

Deploy the **complete** repository at `origin/main@6ec5e5d` — the same commit
Production serves — to `next-bar-staging`'s Production target. The point of
using `6ec5e5d` is that Staging then differs from Production only in *data and
environment*, never in code, which is what makes it a valid rehearsal surface.

The upload must contain the whole project (~4,000 files), not a fragment; that
is what Cause A got wrong. If deploying from a local checkout, do it from a
clean full checkout of `6ec5e5d`, with the correct Root Directory, and confirm
the build log reports `Detected Next.js version` before trusting the result.

## 4. Verify after deploying

1. `/api/health` returns JSON with `ok: true`, `supabase: "ok"`, and
   `sha: 6ec5e5d…` — **not** a 404 and not an SSO HTML page.
2. `/` renders the app shell.
3. The catalog shows **412** bars, and Lucinda's is present — this is how you
   confirm it is talking to the Staging database and not Production's 1,256.
4. The environment reports itself as **staging**.
5. Reachable on mobile (not gated behind Vercel Authentication). Preview URLs
   on this project are SSO-protected; acceptance must use the Production-target
   URL.

## 5. What this unblocks — and what it does not

Unblocks: real-account Staging acceptance, the mobile-shell checks, and the
rollback rehearsal, and therefore the "verify behavior on Staging" condition
attached to packet `702e3ac` / branch `6e553fa`.

Does **not** authorize: any Production migration, any Production deployment,
any change to `next-bar`, or a GO on `g-87cf2100`. Those remain separate,
later, explicit approvals.
