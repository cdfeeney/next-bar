#!/usr/bin/env node
/**
 * G4 — measure the Playwright worker-teardown hang RATE.
 *
 * The hang is intermittent and uncorrelated with project count (see the goal
 * spec: single-project runs hung while the 3-project run stayed clean across
 * repeats, and the same command both hung and passed). A matrix bisection
 * therefore cannot find it. This runs one spec N times and reports how often
 * the run fails to exit promptly, so any candidate fix is measured against a
 * baseline number instead of one lucky green run.
 *
 * Signal: Playwright prints "worker N process did not exit within 300000ms
 * after stop, force-killed it" and the wall time jumps from ~10s to ~300s+.
 * We classify on BOTH: elapsed over the threshold, and the force-kill string.
 *
 * Usage:
 *   node scripts/g4-hang-loop.mjs --spec e2e/app-shell-smoke.spec.ts \
 *        --project "iPhone 13" --runs 10 [--slow-ms 60000]
 *
 * Read-only with respect to the app: it only runs the existing suite.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

/** Playwright's CLI entry, resolved once so each run spawns node directly. */
const PW_CLI = createRequire(import.meta.url).resolve('@playwright/test/cli');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SPEC = arg('spec', 'e2e/app-shell-smoke.spec.ts');
const PROJECT = arg('project', 'iPhone 13');
const RUNS = Number(arg('runs', '10'));
// Validate up front. `--runs 0` produced a vacuous PASS: the loop body never
// executed, `results.length !== RUNS` was `0 !== 0` = false, `.some()` on an
// empty array is false, so `incomplete` stayed false and the guard printed PASS
// having launched nothing. Both review lanes found this independently; it is the
// same "reports green having tested nothing" class as the earlier ranTests hole,
// so it is rejected at the boundary rather than patched downstream.
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error(`--runs must be a positive integer (got: ${arg('runs', '10')})`);
  process.exit(1);
}
// Opt-out for hosts where the deterministic probe cannot run (see countZombies).
const ALLOW_SAMPLED_ONLY = process.argv.includes('--allow-sampled-only');
// A clean run of a small spec is ~10-30s. The hang shows as 300s+ (Playwright's
// own worker-stop timeout). 60s is comfortably above noise and far below the
// hang, so it separates the two populations cleanly.
const SLOW_MS = Number(arg('slow-ms', '60000'));

/** One Playwright run. Resolves with timing + the force-kill signal. */
function runOnce(i) {
  return new Promise((resolve) => {
    const started = Date.now();
    let sawForceKill = false;
    let lastTestDoneAt = null;

    // NO shell. `shell: true` concatenates argv into one command string, which
    // caused two separate defects here:
    //   1. a project name containing a space ("iPhone 13") split into two
    //      tokens, so Playwright exited 1 in ~1.6s having run nothing — which
    //      read as a clean, fast run;
    //   2. any argument could inject shell syntax and fabricate output matching
    //      the ranTests regex, faking a completed run.
    // Passing an argv ARRAY with no shell removes both: no concatenation, no
    // quoting rules, no injection.
    //
    // Invoke Playwright's CLI entry point with node directly rather than via
    // npx: on Windows npx is a .cmd, and Node 24 refuses to spawn .cmd without
    // a shell (spawn EINVAL — the CVE-2024-27980 mitigation), which would force
    // the shell straight back in.
    const child = spawn(
      process.execPath,
      [PW_CLI, 'test', SPEC, `--project=${PROJECT}`, '--reporter=line'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let tail = '';
    const scan = (buf) => {
      const s = buf.toString();
      // Keep a generous tail: with DEBUG=pw:* enabled the last lines before the
      // stall are the discriminating observable (what teardown was awaiting).
      tail = (tail + s).slice(-6000);
      child.__tail = tail;
      if (s.includes('did not exit within')) sawForceKill = true;
      // The moment the run finished, before teardown. Match FAILED as well as
      // passed: a run where every test fails prints no "N passed (" line, and
      // treating that as "Playwright never launched" would conflate a genuine
      // test failure with a harness fault.
      if (/\d+ (passed|failed) \(|\d+ failed$/m.test(s) && lastTestDoneAt === null) {
        lastTestDoneAt = Date.now();
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);

    // Without this the promise never settles on an OS-level spawn failure and
    // the whole guard hangs instead of reporting — failing by hanging rather
    // than by lying, but still a hole.
    child.on('error', (err) => {
      resolve({
        run: i,
        code: null,
        elapsedMs: Date.now() - started,
        teardownMs: null,
        sawForceKill: false,
        ranTests: false,
        tail: `spawn error: ${err?.message ?? String(err)}`,
        hung: false,
      });
    });

    child.on('close', (code) => {
      const elapsed = Date.now() - started;
      // The interesting number: how long teardown took AFTER tests finished.
      const teardownMs = lastTestDoneAt ? Date.now() - lastTestDoneAt : null;
      // A run that exits non-zero without ever reporting a test result did not
      // actually run — that is a harness bug, not a clean pass. Surface it
      // loudly rather than counting it as "ok".
      const ranTests = lastTestDoneAt !== null;
      resolve({
        run: i,
        code,
        elapsedMs: elapsed,
        teardownMs,
        sawForceKill,
        ranTests,
        tail: child.__tail ?? '',
        hung: sawForceKill || elapsed > SLOW_MS,
      });
    });
  });
}

/**
 * Count exited-but-unreaped Playwright/WebKit OS processes.
 *
 * This is the DETERMINISTIC signature of the bug, and it is why this script is
 * a guard rather than a smoke test. The hang itself is probabilistic (~17% per
 * run before the fix), so sampling it is weak: two independent reviewers
 * computed that a 5-run sample catches a reintroduced regression only ~61% of
 * the time, and that ~17 runs would be needed for 95%. The zombie, by contrast,
 * is observable on a SINGLE run — a WebKitNetworkProcess that has exited but was
 * never reaped is exactly the state that makes Playwright miss the exit and wait
 * out its 300s worker-stop timeout.
 *
 * Measured as a DELTA, not an absolute: zombies stranded by earlier runs are
 * held by handles this process cannot release, so the absolute count never
 * returns to zero. What must stay zero is the number of NEW ones.
 *
 * Returns null on a non-Windows host or if PowerShell is unavailable, in which
 * case the caller falls back to the sampled signal alone and says so.
 */
function countZombies() {
  if (process.platform !== 'win32') return null;
  const res = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "(Get-Process -Name '*Playwright*','*WebKit*' -ErrorAction SilentlyContinue | Where-Object { $_.HasExited } | Measure-Object).Count",
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (res.error || res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  // Strict: parseInt would accept "0garbage" or "0\nwarning: ..." as 0, which is
  // exactly how a contaminated probe would masquerade as a clean reading.
  if (!/^\d+$/.test(out)) return null;
  return Number.parseInt(out, 10);
}

const zombiesBefore = countZombies();

const results = [];
for (let i = 1; i <= RUNS; i += 1) {
  const r = await runOnce(i);
  results.push(r);
  const td = r.teardownMs === null ? 'n/a' : `${(r.teardownMs / 1000).toFixed(1)}s`;
  const state = !r.ranTests ? 'NORUN' : r.hung ? 'HUNG ' : 'ok   ';
  console.log(
    `run ${String(i).padStart(2)}/${RUNS}  ${state}  ` +
      `exit=${r.code}  total=${(r.elapsedMs / 1000).toFixed(1)}s  teardown=${td}` +
      (r.sawForceKill ? '  [force-kill]' : ''),
  );
  if (!r.ranTests) {
    console.log(`   !! no tests ran. tail:\n${r.tail.trim().slice(-300)}`);
    break;
  }
  if (r.hung && process.env.G4_DUMP === '1') {
    console.log(`\n===== TAIL OF HUNG RUN ${i} (last output before/around the stall) =====`);
    console.log(r.tail.trim());
    console.log('===== END TAIL =====\n');
  }
}

const zombiesAfter = countZombies();
const zombieDelta =
  zombiesBefore === null || zombiesAfter === null ? null : zombiesAfter - zombiesBefore;

const hangs = results.filter((r) => r.hung).length;
const forceKills = results.filter((r) => r.sawForceKill).length;
console.log('\n--- G4 SUMMARY ---');
console.log(`spec:         ${SPEC}`);
console.log(`project:      ${PROJECT}`);
console.log(`runs:         ${RUNS}`);
console.log(`hangs:        ${hangs}  (${((hangs / RUNS) * 100).toFixed(0)}%)`);
console.log(`force-kills:  ${forceKills}`);
console.log(
  `teardown ms:  ${results.map((r) => (r.teardownMs === null ? '-' : Math.round(r.teardownMs))).join(', ')}`,
);
if (zombieDelta === null) {
  console.log('zombie probe: UNAVAILABLE (non-Windows, PowerShell unreachable,');
  console.log('              timed out, or unparseable output)');
  console.log(`              The sampled signal alone catches a ~17%-rate`);
  console.log(`              regression only ${((1 - 0.83 ** RUNS) * 100).toFixed(0)}% of the time at ${RUNS} runs, so it is`);
  console.log('              NOT a sufficient gate on its own.');
  if (!ALLOW_SAMPLED_ONLY) {
    console.log('              -> failing CLOSED. Re-run with --allow-sampled-only to');
    console.log('                 accept the weaker check deliberately.');
  }
} else {
  // Print the ABSOLUTE counts, not just the delta. A delta of +0 looks identical
  // whether the query read 44->44 or was silently broken and read 0->0 — and a
  // detector that always returns 0 would make this guard vacuous, which is the
  // precise failure mode this repo has already been bitten by once.
  console.log(
    `zombie count: ${zombiesBefore} before -> ${zombiesAfter} after ` +
      `(delta ${zombieDelta >= 0 ? '+' : ''}${zombieDelta})`,
  );
  if (zombiesBefore === 0 && zombiesAfter === 0) {
    console.log(
      '              NOTE: both readings are 0. That is expected on a clean\n' +
        '              machine, but if stranded zombies are known to exist this\n' +
        '              detector is misreading and the guard is vacuous — verify\n' +
        "              with: Get-Process -Name '*Playwright*','*WebKit*' |\n" +
        '                    Where-Object { $_.HasExited } | Measure-Object',
    );
  }
}

// THREE failure signals, and the third is the one that nearly got away.
//
// A run where Playwright never launched (`ranTests === false`) is neither
// "hung" nor a pass — it is the guard failing to guard. An earlier version
// printed a warning and broke out of the loop while still exiting 0, so a
// harness fault such as the shell:true argv-splitting bug this file already
// documents would have reported GREEN having tested nothing. That is the same
// vacuous-guard failure this whole item exists to eliminate, so it gates too.
const incomplete = results.length !== RUNS || results.some((r) => !r.ranTests);
// An unavailable deterministic probe is NOT a pass. Without it only the weak
// sampled signal remains, so the guard fails closed unless the caller opts in.
const probeMissing = zombieDelta === null && !ALLOW_SAMPLED_ONLY;
// The zombie delta is the DETERMINISTIC signal — it is the bug's mechanism and
// shows up on a single run — so it gates even when no hang happened to be
// sampled.
const failed =
  incomplete || probeMissing || hangs > 0 || (zombieDelta !== null && zombieDelta > 0);
if (failed) {
  console.log(`\nRESULT: ${probeMissing && !incomplete && hangs === 0 ? 'INCONCLUSIVE' : 'FAIL'}`);
  if (probeMissing) {
    console.log(
      '  - the deterministic zombie probe could not run, so the only signal left\n' +
        '    is the weak sampled one. Reporting inconclusive rather than green.',
    );
  }
  if (incomplete) {
    console.log(
      `  - only ${results.length}/${RUNS} run(s) completed, or a run never launched\n` +
        '    Playwright at all. The guard did not actually exercise the teardown\n' +
        '    path, so this is a FAILURE, not a pass.',
    );
  }
  if (hangs > 0) console.log(`  - ${hangs} run(s) hung or were force-killed`);
  if (zombieDelta !== null && zombieDelta > 0) {
    console.log(
      `  - ${zombieDelta} new exited-but-unreaped browser process(es): the exact\n` +
        '    state that makes Playwright miss the browser exit and stall its worker',
    );
  }
} else {
  console.log('\nRESULT: PASS');
}
process.exit(failed ? 1 : 0);
