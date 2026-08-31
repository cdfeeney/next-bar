import { spawnSync } from 'node:child_process';
const REPO = 'D:/projects/next-bar';
const run = (label, args, env) => {
  const r = spawnSync('npx', ['tsx', 'scripts/db-whoami.mts', ...args],
    { cwd: REPO, encoding: 'utf8', shell: true, env: { ...process.env, ...env } });
  const body = `${r.stdout}${r.stderr}`.split('\n')
    .filter((l) => !l.startsWith('◇') && l.trim()).join('\n');
  console.log(`--- ${label} ---\n${body}\nexit=${r.status}\n`);
};
run('1 staging (--secrets-file)', ['--secrets-file', '.env.staging.local'], {});
run('2 production (default .env.local)', [], {});
run('3 forced contradiction', ['--secrets-file', '.env.staging.local'],
    { NEXT_BAR_DATABASE_ENVIRONMENT: 'production' });
