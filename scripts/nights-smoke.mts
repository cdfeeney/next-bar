/**
 * nights-smoke — behavioral exercise of the shared-nights definer RPCs
 * (share_night / get_shared_night / unshare_night, migration 0016)
 * against the REAL Supabase project. Function existence ≠ function works
 * (the 42702 lesson) — run attended after applying 0016 or touching any
 * of its RPCs.
 *
 * Cycle: throwaway confirmed user → claim handle → share → ANON read by
 * token (route + identity assertions) → re-share keeps the token (sent
 * links stay alive) → validation negatives (loved off-route, >20 bars,
 * anon share) → unshare → anon read empty → delete user → cascade
 * verified.
 *
 * ATTENDED ONLY: writes to the production DB. Refuses under
 * LOOP_UNATTENDED=1.
 *
 *   npx tsx scripts/nights-smoke.mts
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

config({ path: '.env.local' });

if (process.env.LOOP_UNATTENDED === '1') {
  console.error('nights-smoke writes to the prod DB — attended runs only.');
  process.exit(2);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DB = process.env.DATABASE_URL;
if (!URL || !ANON || !DB) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / DATABASE_URL');
  process.exit(2);
}

const STAMP = Date.now().toString(36);
const TEST_EMAIL = `nextbar.nights.smoke.${STAMP}@example.com`;
const TEST_PASSWORD = `nights-smoke-${STAMP}-Aa1!`;
const TEST_HANDLE = `smoke_${STAMP}`;
const NIGHT = '2026-07-25';

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function main() {
  const owner = createClient(URL as string, ANON as string, {
    auth: { persistSession: false },
  });
  const anon = createClient(URL as string, ANON as string, {
    auth: { persistSession: false },
  });
  const pg = new Client({ connectionString: DB });
  await pg.connect();

  const { data: su, error: suErr } = await owner.auth.signUp({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (suErr || !su.user) {
    console.error('signUp failed:', suErr?.message);
    await pg.end();
    process.exit(1);
  }
  const uid = su.user.id;

  try {
    await pg.query(
      `update auth.users set email_confirmed_at = now() where id = $1`,
      [uid],
    );
    const { error: siErr } = await owner.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    check('sign-in', siErr === null, siErr?.message);

    const { error: chErr } = await owner.rpc('claim_handle', {
      desired: TEST_HANDLE,
    });
    check('claim_handle', chErr === null, chErr?.message);

    // share → token
    const { data: token, error: shErr } = await owner.rpc('share_night', {
      p_night: NIGHT,
      p_bar_ids: ['attaboy', 'mister-paradise'],
      p_loved_bar_id: 'attaboy',
    });
    check('share_night returns token', shErr === null && typeof token === 'string', shErr?.message);

    // anon read by token
    const { data: rows, error: getErr } = await anon.rpc('get_shared_night', {
      p_token: token,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    check('anon get_shared_night finds the night', getErr === null && !!row, getErr?.message);
    check('  …route order intact', JSON.stringify(row?.bar_ids) === JSON.stringify(['attaboy', 'mister-paradise']), row?.bar_ids);
    check('  …identity + loved + night', row?.handle === TEST_HANDLE && row?.loved_bar_id === 'attaboy' && row?.night === NIGHT, row);

    // re-share keeps the token (sent links stay alive)
    const { data: token2 } = await owner.rpc('share_night', {
      p_night: NIGHT,
      p_bar_ids: ['attaboy'],
      p_loved_bar_id: null,
    });
    check('re-share keeps the same token', token2 === token, { token, token2 });

    // validation negatives
    const { error: offRoute } = await owner.rpc('share_night', {
      p_night: NIGHT,
      p_bar_ids: ['attaboy'],
      p_loved_bar_id: 'not-on-route',
    });
    check('loved off-route rejected', offRoute !== null);
    const { error: tooMany } = await owner.rpc('share_night', {
      p_night: NIGHT,
      p_bar_ids: Array.from({ length: 21 }, (_, i) => `bar-${i}`),
      p_loved_bar_id: null,
    });
    check('21-bar route rejected', tooMany !== null);
    const { error: anonShare } = await anon.rpc('share_night', {
      p_night: NIGHT,
      p_bar_ids: ['attaboy'],
      p_loved_bar_id: null,
    });
    check('anon share_night rejected', anonShare !== null);

    // unshare → link dies
    const { error: unErr } = await owner.rpc('unshare_night', { p_night: NIGHT });
    check('unshare_night', unErr === null, unErr?.message);
    const { data: goneRows } = await anon.rpc('get_shared_night', { p_token: token });
    check('anon read after unshare is empty', Array.isArray(goneRows) && goneRows.length === 0, goneRows);

    // re-share mints a FRESH token after unshare
    const { data: token3 } = await owner.rpc('share_night', {
      p_night: NIGHT,
      p_bar_ids: ['attaboy'],
      p_loved_bar_id: null,
    });
    check('post-unshare re-share mints a new token', typeof token3 === 'string' && token3 !== token, { token, token3 });
  } finally {
    // Delete the throwaway user; shared_nights rows cascade via the FK.
    await pg.query(`delete from auth.users where id = $1`, [uid]);
    const { rows: leftover } = await pg.query(
      `select count(*)::int as n from public.shared_nights where user_id = $1`,
      [uid],
    );
    check('cascade removed shared_nights rows', leftover[0]?.n === 0, leftover);
    await pg.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nnights-smoke: ALL OK');
}

void main();
