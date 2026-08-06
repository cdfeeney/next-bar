# Overnight run — 2026-08-05 (local)

- Queue: g-5cb22f54-a76c-4eec-9a81-705351043de4 (Beta 1 Path B all-in-one: Stop-Sharing plus persistence v2.1)
- Stop conditions: goal complete | genuinely blocked | three-round Santa review cap (no fixed clock stop given)
- Item limit: 1 goal (loop-guard max-iters 4: /code + up to 3 Santa rounds)
- Starting SHA: f40783af61399ffc0111728ac12e4d011208a3eb
- Worktree: C:\Users\cdfee\projects\nb-account-sync
- Branch: feat/beta1-account-sync
- Timezone: local (America — Windows host)
- Constraints: no push/deploy/migrations/credentials/Staging/Production/TestFlight contact; no worktree create/remove; no node_modules links; one writer, one lease; gating Claude reviewer = FABLE; missing review lanes fail closed.

## Items

### g-5cb22f54 — COMPLETE (NICE, 3 Santa rounds, quorum met every round)

**Commits** (all local, branch feat/beta1-account-sync; nothing pushed, nothing deployed,
no migration applied, no credentials read, no Staging/Production/TestFlight contact):
- 4c3eccd fix: tokenless Stop-Sharing (RED-proven; exact confirmation sentence)
- f40783a→bec2e3a feat: persistence v2.1 (readiness barrier, quarantine journal,
  read-back confirmation, retry ladder, gate UI, sign-out dialog, migration 0042 amended
  in place — UNAPPLIED by design)
- 48494b3 fix: santa round-1 (12 verified findings, 11 RED-proven tests)
- 114e5bb fix: santa round-2 (supersede-preserving commit, no mid-flight clobber,
  honest write notifications; 7 RED-proven tests + 2 guards)
- 66a9c02 fix: santa round-3 (digest-guarded envelope mutations, raw-invalid supersede
  single-key path, invalid-bytes capture before hydrate x3, rollover archive gate;
  7 RED-proven tests)

**Final verification**: tsc clean; vitest 2121/2121; gate+nights e2e 31/31 on iPhone 13 +
Pixel 7; next build clean; git diff --check clean; secret scan clean. Pre-existing e2e
failures at HEAD (map-lightbox x3, photo-card x1) proven pre-existing via git stash baseline.

**Panel (T0 full, unattended, fail-closed)** — every round quorum met:
- R1 (bec2e3a): FABLE + Codex + GLM + DeepSeek + Kimi — 12 verified findings fixed.
- R2 (48494b3): FABLE (2 Medium) + Codex proof 70befe25 (2 High: quarantine commit
  destroyed superseded divergent copy; release hydrated over newer mid-flight edit).
- R3 (114e5bb / final range for routed lanes): FABLE (2 Medium: invalid-bytes hydrate
  clobber, rollover archive race — fixed), Codex proof 444ea15a (2 High: stale-tab
  release/update unguarded, raw-invalid single-key overwrite — fixed), DeepSeek (no
  blockers), GLM (5 candidates all refuted with repo evidence), Kimi deep (no Critical,
  architecture holds).

**Lane-unique catches**: Codex R2 caught the supersede-destroys-preserved-copy bug that
FABLE R2 explicitly traced and called benign — model diversity earned its cost. FABLE R3
caught the invalid-bytes and rollover gaps no other lane saw.

**Codex timeouts**: R2 first attempt and R3-scoped first attempt hit 540s (bounded-run
terminated the process tree both times); both succeeded on retry with narrowed 3-question
task files and returned valid proofs.

**Residuals (documented, no code change — human decisions for morning)**:
1. Superseded chains uncapped — operator-locked no-eviction/no-cap; drain = one promoted
   conflict per release through the existing dialog. (Codex R3 Medium)
2. Rollover-refusal is silent (visit dropped, history preserved) — Kimi recommends a
   Retry banner; GLM concurred. Beta+1 candidate.
3. Equal-clock divergent live value loses the LWW tie to the server on next sync —
   pre-existing designed rule, only reachable via non-stamping writer anomaly. (DeepSeek)
4. Kimi Beta+1 recommendations: unify cold stores into one preservation log; aggregate
   "preserved copies awaiting review" badge.
5. Migration 0042 remains UNAPPLIED (out of scope per goal); 0043 reserved for Beta+1.
