# Production services and release rehearsal — operator checklists

Written 2026-07-30 for goal `g-90dccd13`. **Every item is an operator action.** Nothing here
was provisioned, deployed or verified by the agent, and no item may be recorded as passing
without attended evidence.

Each row states the **proof**, not just the action. "Configured" is not evidence; the output
of a check is.

## Service setup

### Vercel
| Action | Proof required |
|---|---|
| Production project on `next-bar.app` | domain resolves and serves `/api/health` with the expected sha |
| Production env vars set | `npm run check-env --environment production` exits 0 |
| Preview env vars set **without** service-role/`DATABASE_URL` | `api/account/delete` on a preview URL returns **503**, not 200 |
| Deployment protection on preview (if wanted) | an incognito window cannot open a preview URL |
| Rollback procedure known | a rollback actually performed once in staging |

### Supabase
| Action | Proof required |
|---|---|
| Separate staging project | staging and production report different shas/refs from `/api/health` |
| Migrations `0000`→`0035` applied to staging | runner output, and `schema_migrations` ends at 0035 |
| Paid plan with backups before real user data | plan and retention visible in the dashboard |
| **Restore rehearsed** | a backup restored into a scratch project and the data checked |
| Production RLS reconciled against migrations | the verification SQL in `MIGRATION-0033-0034-RUNBOOK.md` returns the expected rows |

The restore rehearsal is the one people skip and the one that matters. An untested backup is
a belief, not a control.

### GitHub
| Action | Proof required |
|---|---|
| `main` protected, CI required | a PR cannot merge with a red check |
| Secret scan running | the new first CI step visible on a PR |

### DNS / TLS / email
| Action | Proof required |
|---|---|
| `next-bar.app` + TLS | valid certificate, canonical redirects behave |
| Supabase auth redirect allowlist per environment | a staging callback is **rejected** by production |
| Brevo DKIM/SPF on the production sender | a real signup email arrives and passes auth checks |

### Google
| Action | Proof required |
|---|---|
| Production key referrer-restricted | the key fails from an unlisted origin |
| Quota + budget alert | alert configuration visible; ideally one test breach |
| `ALLOW_GOOGLE_*_INGEST` unset in production | `check-env` output |
| Media kill switch works **without redeploy** | flip it, observe the change, flip back |

### Mobile (Connor is on Windows — no local `xcodebuild`)
| Action | Proof required |
|---|---|
| Cloud Mac / Codemagic build | a successful clean build from a fresh checkout |
| Signing material owned and documented | someone other than the build machine can rebuild |
| Staging bundle → staging backend | the app's `/api/health` shows the staging sha |
| TestFlight internal test | install on a real device and complete the core flow |

## Release rehearsal (run in staging, in this order)

1. Record the current SHA and the deployed artifact.
2. Deploy to staging.
3. Smoke: `/api/health` returns the **new** sha and `ok: true`.
4. Exercise the money-adjacent path — sign in, rate a bar, share a night, delete a test account.
5. **Roll back** to the previous deployment.
6. Smoke again: `/api/health` returns the **old** sha.
7. Confirm nothing was lost by the round trip.

Step 5 is the whole point. A release process that has never rolled back is a release process
with an untested half.

## Post-release review

- What did `/api/health` report immediately after deploy?
- Did any alert fire? (Today the honest answer is "no alerts exist" — see goal 11.)
- Anything in the logs that was not there before?
- Is the rollback path still one step?

## Physical iPhone matrix — human only

No agent can produce this evidence. A person holds a phone:

compact and large phones · portrait and landscape · keyboard open · sheets and modals ·
bottom navigation reachable one-handed · permission prompts (location, notifications, photos)
· Safari and installed-PWA modes · TestFlight build.

The three known `mobile-controls` failures on `/` are exactly this class of defect, and they
are still open — see `CATALOG-REFLOW-ANALYSIS-2026-07-30.md`.

## Status

**Every row above is UNVERIFIED.** The repository cannot evidence external state, and this
document existing changes nothing about the world. It becomes useful only when an operator
works through it and records the proofs.
