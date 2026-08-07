---
decision: Which TestFlight build is the external beta, and which environment must it use?
status: active
updated: 2026-08-07
revisit_when: Build 6 is replaced, the native shell stops using a remote origin, the internal and public apps receive separate bundle identities, or Build 6 is considered for App Store production submission.
---

# Build 6 is the external TestFlight beta

## Operator decision

As of 2026-08-07, **Build 6 is intentionally external-facing through the
external TestFlight group `Beta Testers`**. Build 5 was removed from that
group. The operator observed Build 6 in status **Testing** with the external
group attached.

“External-facing” in this decision means **external TestFlight beta testing**.
It does not mean App Store production release, App Review submission for public
distribution, or authorization to use the Production database.

## Required environment boundary

Build 6 must continue to use:

- origin: `https://next-bar-staging.vercel.app`
- environment: Staging
- Supabase: the separate `next-bar-staging` project

GitHub Actions workflow run `31142679072` built Build 6 from native-shell SHA
`6ec5e5d` with `CAP_SERVER_URL=https://next-bar-staging.vercel.app`. A tester
who believes they are on Build 6 must confirm the build number in TestFlight
before creating a test account.

Build 5 targeted `https://next-bar-two.vercel.app` and Production. It must not
be offered to the external `Beta Testers` group for staging acceptance work.
Removing it from the group does not change or migrate accounts already created
in Production.

## Superseded distribution statement

This operator decision supersedes earlier blanket statements that Build 6, or
every remote-origin TestFlight build, is internal-only. The exception is
narrow: **Build 6 is authorized for external TestFlight beta testing against
Staging.** Earlier technical warnings about the remote-origin wrapper remain
valid and are not erased by this distribution decision.

## Remaining risk and stop condition

Build 6 still uses the interim Capacitor remote-origin architecture and the
same native bundle identity as Build 5. If a confirmed Build 6 signup appears
in Production, stop external testing and treat it as an environment-routing
incident. Record the tester, TestFlight build number, active WebView origin,
and account email before changing or deleting data.

The preferred durable architecture remains separate internal/public bundle
identities with a visible environment indicator and fail-closed origin checks.

