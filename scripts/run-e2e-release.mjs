// This IS `npm run test:e2e` — the standard gate's browser leg, which must run
// against a production build (PLAYWRIGHT_RELEASE=1).
//
// The variable is set here rather than in the command because `VAR=1 cmd` is a
// parse error in PowerShell, this repo's primary shell (CLAUDE.md: "Connor is
// on Windows"). A gate command half the project's shells cannot run is how a
// gate goes unrun, which is the exact failure this goal exists to fix. Use
// `npm run test:e2e:dev` for the dev-server run.
//
// Spawn the CLI through `process.execPath` rather than `npx`/`.bin/playwright`:
// no shell, so no quoting or `.cmd`-spawn platform difference, and extra argv
// (a spec path, `--grep`) passes straight through.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_RELEASE: '1' },
});

if (result.error) throw result.error;
// A wrapper that swallowed the exit code would turn a red suite into a green
// gate. `status` is null when the run died on a signal — that is a failure too.
process.exit(result.status ?? 1);
