/**
 * rpc-smoke — behavioral exercise of the night-scoped definer RPCs
 * against the REAL Supabase project (suggest_bar / get_circle_suggestions
 * / rsvp_bar / get_circle_rsvps / unrsvp_bar).
 *
 * WHY THIS EXISTS (2026-07-25): suggest_bar and rsvp_bar shipped with a
 * plpgsql 42702 ambiguity (`night` param vs column in the ON CONFLICT
 * target) that broke EVERY prod suggest/RSVP — and nothing caught it,
 * because the e2e suite stubs these RPCs and the migration "verify" step
 * only checked the functions existed. plpgsql compiles statements
 * lazily, so the bug only fires on first real execution. This script IS
 * that first real execution: run it attended after ANY migration that
 * touches an RPC.
 *
 * Mechanics: signs up a throwaway user (confirmed directly via
 * DATABASE_URL — no email roundtrip), runs the write→read→move→out
 * cycle with assertions, then deletes the user (rows cascade).
 *
 * ATTENDED ONLY: writes to the production DB. Refuses under
 * LOOP_UNATTENDED=1.
 *
 *   npx tsx scripts/rpc-smoke.mts
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

config({ path: '.env.local' });

if (process.env.LOOP_UNATTENDED === '1') {
  console.error('rpc-smoke writes to the prod DB — attended runs only.');
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
const TEST_EMAIL = `nextbar.rpc.smoke.${STAMP}@example.com`;
const TEST_PASSWORD = `rpc-smoke-${STAMP}-Aa1!`;

/** Mirror src/lib/nightKey.ts: NYC date, previous day before 6am. */
function nycNightKey(): string {
  const nyc = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  if (nyc.getHours() < 6) nyc.setDate(nyc.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${nyc.getFullYear()}-${p(nyc.getMonth() + 1)}-${p(nyc.getDate())}`;
}

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
  const supabase = createClient(URL as string, ANON as string, {
    auth: { persistSession: false },
  });
  const pg = new Client({ connectionString: DB });
  await pg.connect();

  const { data: su, error: suErr } = await supabase.auth.signUp({
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
      'update auth.users set email_confirmed_at = now() where id = $1',
      [uid],
    );
    const { error: siErr } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (siErr) {
      console.error('signIn failed:', siErr.message);
      process.exit(1);
    }

    const night = nycNightKey();
    console.log(`rpc-smoke as ${uid}, night ${night}`);

    const suggest = await supabase.rpc('suggest_bar', { bar: 'ace-bar', night });
    check('suggest_bar returns true', suggest.data === true && !suggest.error, suggest.error);

    const sRead = await supabase.rpc('get_circle_suggestions', { night });
    check(
      'own suggestion visible via get_circle_suggestions',
      Array.isArray(sRead.data) && sRead.data.some((r: { bar_id: string }) => r.bar_id === 'ace-bar'),
      sRead.error ?? sRead.data,
    );

    const rsvp1 = await supabase.rpc('rsvp_bar', { bar: 'ace-bar', night });
    check('rsvp_bar returns true', rsvp1.data === true && !rsvp1.error, rsvp1.error);

    const rsvp2 = await supabase.rpc('rsvp_bar', { bar: 'attaboy', night });
    check('rsvp_bar move returns true', rsvp2.data === true && !rsvp2.error, rsvp2.error);

    const rRead = await supabase.rpc('get_circle_rsvps', { night });
    const rows = Array.isArray(rRead.data) ? (rRead.data as Array<{ bar_id: string }>) : [];
    check(
      'move semantics: exactly one RSVP, at the second bar',
      rows.length === 1 && rows[0].bar_id === 'attaboy',
      rRead.error ?? rRead.data,
    );

    const unrsvp = await supabase.rpc('unrsvp_bar', { bar: 'attaboy', night });
    check('unrsvp_bar returns true', unrsvp.data === true && !unrsvp.error, unrsvp.error);

    const rRead2 = await supabase.rpc('get_circle_rsvps', { night });
    check(
      'after unrsvp: zero RSVPs',
      Array.isArray(rRead2.data) && rRead2.data.length === 0,
      rRead2.error ?? rRead2.data,
    );
  } finally {
    await pg.query('delete from auth.users where id = $1', [uid]);
    await pg.end();
    console.log('cleaned up test user (rows cascade)');
  }

  if (failures > 0) {
    console.error(`rpc-smoke: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('rpc-smoke: all green');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
