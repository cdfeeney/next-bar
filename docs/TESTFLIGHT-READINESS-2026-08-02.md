# TestFlight readiness — evidence run 2026-08-02 (goal g-c8da7452)

Unattended evidence pass. Verdicts: **PASS** (verified locally, evidence cited),
**FAIL** (gap requiring code work), **OPERATOR-BLOCKED** (requires accounts,
credentials, uploads, or attended decisions — never attempted unattended).
Windows-first constraint honored throughout: no local `xcodebuild` is assumed
anywhere (PWABuilder/Capacitor + cloud Mac CI per docs/APP-STORE-PLAN.md).

| # | Check | Verdict | Evidence / required operator action |
|---|-------|---------|--------------------------------------|
| 1 | Production build | **PASS** | `npm run build` (check-env + next build) exit 0, 2026-08-02 ~22:55 ET; static+dynamic routes emitted; only perf warnings (webpack big-string serialization, edge-runtime static-gen note). |
| 2 | PWA manifest | **PASS with one FAIL sub-item** | App-router `src/app/manifest.ts`: name/short_name/start_url/scope/display=standalone/orientation/theme+background colors/categories/lang all present; `/apple-icon` (180) served by `apple-icon.tsx`. **FAIL sub-item (Codex review, pre-existing):** the manifest declares BOTH a 192×192 and a 512×512 entry pointing at `/icon`, but `src/app/icon.tsx` generates only a 512×512 PNG — a consumer selecting the 192 entry receives a 512 image. Fix (small, T1 runtime): either drop the 192 entry or serve real multi-size icons via `generateImageMetadata`; left unchanged this run to keep the readiness pass evidence-only. |
| 3 | Service worker | **PASS** | `public/sw.js` present and served from scope root. |
| 4 | Privacy labels prepared | **FAIL** (corrected by review — was overstated) | Draft answers exist in `docs/APP-PRIVACY-LABELS-2026-07-30.md`, but its companion `docs/PRIVACY-DELETION-APPSTORE-2026-07-30.md:153` states plainly: *"Q1 and Q3 remain open and continue to block submission."* Q1 — `public.waitlist` has no deletion path (no FK, no cascade, no code path). Q3 — production analytics enablement is unconfirmed, so the drafted "Usage Data: collected" answer may be wrong. Both must be resolved before the questionnaire can be submitted. |
| 5 | Account deletion in-app (Apple 5.1.1(v)) | **OPERATOR-BLOCKED** (corrected by review — was overstated) | The CODE path is done and hardened (Settings danger zone → service-role route with bearer self-deletion + session revocation, goal-zero commit `9c80a8f`; unit-covered by `route.test.ts`, UI-covered by `e2e/account-delete.spec.ts` — which stubs the route at the browser boundary and therefore proves the flow, not the server logic; staging run recorded in `docs/STAGING-ACCEPTANCE-NOTES-2026-08-01.md`). But `docs/MASTER-TODO-2026-07-30.md:22` still carries **B1 open**: the production `SUPABASE_SERVICE_ROLE_KEY` is invalid, so the route is DARK in production. Apple's requirement is not met until that key is fixed in the deployment environment — an attended operator action. |
| 6 | Build-path decision | **PASS** (documented) | Capacitor wrap + cloud Mac CI (Codemagic or GitHub Actions macOS) is the recorded recommendation in `docs/APP-STORE-PLAN.md`; PWABuilder is the fallback probe. No repo change required until the operator green-lights the wrap. |
| 7 | Native-surface 4.2 mitigation (push/haptics/share) | **FAIL** (known gap, not overnight-fixable) | Apple guideline 4.2 rejects thin wrappers. The mitigation (live APNs via 0009 scaffolding, haptics, native share) requires the native project shell to exist first — deterministic local fix is NOT possible before the Capacitor wrap is created (operator decision). Tracked in APP-STORE-PLAN. |
| 8 | Apple Developer Program enrollment | **OPERATOR-BLOCKED** | Paid enrollment, identity verification — attended only. |
| 9 | Signing certificates / provisioning profiles | **OPERATOR-BLOCKED** | Requires the developer account (8) and key custody decisions; never generated unattended. |
| 10 | App Store Connect app record + TestFlight group | **OPERATOR-BLOCKED** | Console actions on Apple's dashboard. |
| 11 | Binary upload (Transporter/iTMSTransporter or CI) | **OPERATOR-BLOCKED** | Requires 8–10 plus a built .ipa (7 → wrap decision first). |

## Summary

**The web side is NOT yet TestFlight-ready.** (This section originally claimed
it was; the santa fact-check lane caught two overstatements and one icon
inaccuracy, corrected above — the corrections are the useful output of this
run.) What is genuinely green: production build, service worker, the manifest
skeleton, the documented build path, and the account-deletion *code*.

Three real gaps remain before submission is even possible, none of them
fixable unattended:

1. **B1 — invalid production `SUPABASE_SERVICE_ROLE_KEY`** leaves the
   Apple-mandated in-app deletion route dark in production (item 5).
2. **Privacy-label Q1/Q3** still block the questionnaire (item 4): waitlist
   rows have no deletion path, and the analytics answer is unconfirmed.
3. **Guideline 4.2 native surface** (item 7) needs the Capacitor wrap to exist
   before push/haptics/share can be added.

Plus one small code gap worth a follow-up: the manifest's 192×192 icon entry
resolves to a 512×512 image (item 2).

After those, the attended Apple-account chain (8–11) remains. Nothing was
changed in code this run, no accounts were created, nothing was uploaded.
