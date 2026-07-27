/**
 * seed-test-friend — ATTENDED one-off (operator QA note 2026-07-26):
 * creates a persistent test account that follows the operator
 * (cdfeeney2@gmail.com), suggests a bar for tonight, and RSVPs to it —
 * so the Tonight strip, followers list, and People's Choice have real
 * data on the operator's phone. NOT cleaned up (that's the point).
 *
 *   cd C:\Users\cdfee\projects\next-bar
 *   npx tsx <this file>
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

config({ path: '.env.local' });
if (process.env.LOOP_UNATTENDED === '1') {
  console.error('attended only');
  process.exit(2);
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const DB = process.env.DATABASE_URL!;

const EMAIL = 'nextbar.test.sam@example.com';
const PASSWORD = 'nb-test-sam-2026-Aa1!';
const HANDLE = 'sam_tests';
const DISPLAY = 'Sam (test)';
const BAR = 'attaboy';

function nycNightKey(): string {
  const nyc = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  if (nyc.getHours() < 6) nyc.setDate(nyc.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${nyc.getFullYear()}-${p(nyc.getMonth() + 1)}-${p(nyc.getDate())}`;
}

const ok = (label: string, pass: boolean, detail?: unknown) => {
  console.log(`${pass ? '  ok ' : '  FAIL'} ${label}${pass ? '' : ' ' + JSON.stringify(detail ?? '')}`);
  if (!pass) process.exitCode = 1;
};

async function main() {
  const supabase = createClient(URL, ANON, { auth: { persistSession: false } });
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    // Operator identity.
    const { rows: op } = await pg.query(
      `select p.id, p.handle from public.profiles p join auth.users u on u.id = p.id where u.email = $1`,
      ['cdfeeney2@gmail.com'],
    );
    ok('operator profile found', op.length === 1, op);
    if (op.length !== 1) return;
    console.log(`  operator handle: @${op[0].handle}`);

    // Test account: reuse if it exists, else sign up + confirm.
    let signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (signIn.error) {
      const su = await supabase.auth.signUp({ email: EMAIL, password: PASSWORD });
      ok('signUp', su.error === null && !!su.data.user, su.error?.message);
      await pg.query(`update auth.users set email_confirmed_at = now() where email = $1`, [EMAIL]);
      signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    }
    ok('sign-in as test account', signIn.error === null, signIn.error?.message);

    const { error: chErr } = await supabase.rpc('claim_handle', { desired: HANDLE });
    ok('claim_handle (already-claimed is fine)', chErr === null || /taken|exists|claimed/i.test(chErr?.message ?? ''), chErr?.message);
    await supabase.from('profiles').update({ display_name: DISPLAY }).eq('id', signIn.data.user!.id);

    const { data: followRes, error: fErr } = await supabase.rpc('follow_user', { target: op[0].id });
    ok(`follow_user -> ${JSON.stringify(followRes)}`, fErr === null, fErr?.message);

    const night = nycNightKey();
    const { data: sugg, error: sErr } = await supabase.rpc('suggest_bar', { bar: BAR, night });
    ok(`suggest_bar ${BAR} for ${night} -> ${JSON.stringify(sugg)}`, sErr === null, sErr?.message);
    const { data: rsvp, error: rErr } = await supabase.rpc('rsvp_bar', { bar: BAR, night });
    ok(`rsvp_bar ${BAR} -> ${JSON.stringify(rsvp)}`, rErr === null, rErr?.message);

    console.log(`\nDone. Test account: ${EMAIL} / @${HANDLE}. It follows @${op[0].handle}, suggested + is IN at ${BAR} tonight (${night}).`);
    console.log('NOTE: Sam follows YOU — for the full circle experience, follow @sam_tests back from your phone (Followers -> Follow back).');
  } finally {
    await pg.end();
  }
}
void main();
