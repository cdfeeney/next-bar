# Staging Auth email templates — the change that activates `/auth/confirm`

Written 2026-08-06 for the cross-context auth fix on
`fix/auth-cross-context-email`. **Nothing here was applied by the agent.**
Every step is an operator action in the Supabase dashboard.

`<STAGING_REF>` below is the staging project ref. It is deliberately not
written into this file — read it off the dashboard URL you are already on.

## Why this is required

`/auth/callback` completes the **PKCE code exchange**, which needs the code
*verifier* cookie written by the browser that started the flow.
`@supabase/ssr` hardcodes `flowType: 'pkce'` in both `createBrowserClient` and
`createServerClient`, so there is no client-side setting that avoids this.

In the TestFlight wrapper the flow starts inside the Capacitor WKWebView and
the email link opens in **Safari** — a different cookie jar. The verifier is
absent, `exchangeCodeForSession` throws `AuthPKCECodeVerifierMissingError`,
and password reset can never complete. The same boundary breaks any
cross-device use (request on phone, open on laptop).

`verifyOtp({ token_hash })` carries its proof in the link itself and needs no
verifier, so it completes in whatever browser opens it. The route now exists
at `src/app/auth/confirm/route.ts`. **It is inert until the templates below
point at it.**

**Both templates must change together — in one sitting, and verify both before
you walk away.** The boundary breaks password recovery *and* signup
confirmation. Repointing only recovery would leave new users on the TestFlight
build unable to activate an account, and the half-migrated state is
indistinguishable from a regression: recovery links work, signup links fail, and
nothing in the UI says why. If you must stop midway, roll the changed template
back rather than leaving the pair split.

**Leave the password-change notification email ENABLED** (Authentication →
Email Templates). `/auth/confirm` completes in whatever browser opens the link,
by design — that is the whole point of the token-hash flow. The trade is that a
forwarded or scanner-prefetched link is a usable bearer credential, so that
notification is the only out-of-band signal a user gets that their password
changed. Do not disable it to reduce email volume.

## The two template edits

Dashboard → **Authentication → Email Templates**:
`https://supabase.com/dashboard/project/<STAGING_REF>/auth/templates`

### 1. "Reset Password" template

Replace the `{{ .ConfirmationURL }}` anchor with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/settings">
  Reset password
</a>
```

`type=recovery` is required — the route's allowlist rejects anything else.
`next=/settings` lands the user on the account card, where "Set a password"
mints the new one. Omitting `next` is safe; the route defaults to `/settings`.

### 2. "Confirm signup" template

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/settings">
  Confirm email address
</a>
```

`type=email` is correct for signup confirmation — **not** `type=signup`. This
is Supabase's documented value for the server-side token-hash flow, and the
route's allowlist is `['recovery', 'email']` exactly.

## Configuration this depends on

Dashboard → **Authentication → URL Configuration**:
`https://supabase.com/dashboard/project/<STAGING_REF>/auth/url-configuration`

| Setting | Required value | Why |
|---|---|---|
| **Site URL** | `https://next-bar-staging.vercel.app` | `{{ .SiteURL }}` interpolates this literally into both templates. If it still points at localhost or a stale host, every link in both emails is wrong. **Verify before editing the templates.** |
| **Redirect URLs** | `https://next-bar-staging.vercel.app/**` | Governs the **legacy** `/auth/callback` path, whose `redirectTo` / `emailRedirectTo` Supabase validates against this list. It does **not** govern `next` — see below. |

**`next` is not validated by Supabase.** `/auth/confirm` checks it itself: a
single leading slash, no `//`, no backslash, no whitespace — anything else falls
back to `/settings`. The dashboard allowlist is never consulted for it. Do not
troubleshoot a rejected `next` as an allowlist problem, and do not widen the
allowlist hoping to affect it; the two are unrelated. The allowlist still
matters because `/auth/callback` remains live for links already in flight.

Production keeps its **own** Site URL and allowlist — the staging host must
never appear in Production's list, and no Vercel preview wildcard belongs
there (it would make every PR URL a valid auth callback).

## Link tracking must be OFF

Supabase's own template documentation warns that an external email provider
with click/open tracking **rewrites the link**, and that prefetching by
security scanners consumes the one-time token — surfacing as
*"Token has expired or is invalid"* on a link the user never clicked.

That failure is indistinguishable from a genuinely expired link in the UI, so
it would be misread as the bug we just fixed.

- Confirm in the SMTP provider (Brevo, per `ENVIRONMENT-DESIGN-2026-07-30.md`)
  that **click tracking and open tracking are disabled** for the transactional
  stream that sends these two templates.
- If staging is still on Supabase's built-in sender, note that it is rate
  limited (a small number of emails per hour) and is **not** suitable for a
  reset-testing session. Configure the separate non-production SMTP account
  the environment design already calls for before running the attended matrix.

## Reading the server logs when something fails

`/auth/confirm` emits one redacted record per failure, under the stable event
name `auth.confirm.failure`, prefixed `[auth/confirm] rejected`. Alert on the
event name, not on the wording. It deliberately carries **no** token, email,
query string, URL, or raw Supabase message — only categories.

| Field | Meaning |
|---|---|
| `stage` | `validation` (rejected before Supabase was called), `unconfigured` (env vars missing), `verification` (Supabase rejected it) |
| `typeCategory` | `allowed` / `known-supabase-type` / `unrecognized` / `absent` |
| `typeValue` | present only when the type came from the closed set — tells you **which** template sent the link |
| `hasTokenHash`, `tokenHashLength` | whether a token arrived, and how long it was — never the value |
| `sdkCode`, `sdkName`, `sdkStatus` | bounded identifiers from the Supabase error |

What to conclude:

- `stage: validation` + `typeCategory: known-supabase-type` → **the template has the
  wrong `type`.** `typeValue` names it (e.g. `signup`, which should be `email`).
  This is the mistake this runbook warns about, and it is the one to check first.
- `stage: validation` + `hasTokenHash: false` → **the template lost `{{ .TokenHash }}`.**
- `stage: verification` + a short `tokenHashLength` → **the template is mangling or
  truncating the token.** Establish the normal length from healthy traffic first
  (send yourself one working link and read the value off that record) — this repo
  does not hard-code an expected length, and Supabase may change its format.
  Anything materially shorter than that observed baseline is truncation, not expiry.
- `stage: verification` + `sdkCode: otp_expired` at the **normal** length → a
  genuinely expired or already-used link. If you see a wave of these on links
  users say they never clicked, re-read the link-tracking section above.
- `stage: unconfigured` → the deployment is missing its Supabase env vars; this is
  not a template problem.

## Rollback

Single step per template — no deploy, no migration, no code change. Restore
the original anchor:

```html
<a href="{{ .ConfirmationURL }}">Confirm your email</a>
```

`{{ .ConfirmationURL }}` routes back through `/auth/verify` → `/auth/callback`
(the PKCE path), which is exactly the pre-change behaviour. `/auth/callback`
is deliberately **kept and still tested**, so rolling back the templates
restores the old flow with no other action.

Rollback restores the cross-context failure along with it. Prefer fixing
forward unless `/auth/confirm` is provably worse.

## What is NOT in scope here

- **Production templates.** Do not touch them until the staging matrix passes.
- **Universal Links / native shell changes.** Explicitly excluded — they would
  help the in-app case only, and would not fix cross-device at all, so they do
  not replace this change.
