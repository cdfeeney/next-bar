/**
 * READ-ONLY diagnosis of the storiesRls failures that appeared after 0075+0076 landed on staging.
 *
 * The suite reports: an audience member cannot read a story's OBJECT bytes, anon gets
 * "permission denied for table stories" where an EMPTY RESULT is expected, and is_mutual_friend
 * errors. Those are three different shapes - a policy change, a GRANT change, and a function
 * failure - so this asks the catalog directly instead of inferring from test names.
 *
 *   PGSSLROOTCERT=<ca> npx tsx scripts/dev/diagnose-stories-0076.mts --secrets-file <staging>
 */
import pg from 'pg';

import { certify } from '../lib/whoami';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

const identity = await certify(arg('--secrets-file'));
if (identity.refusals.length > 0) {
  for (const r of identity.refusals) process.stderr.write(`${r}\n`);
  process.exit(2);
}
process.stdout.write(`target : ${identity.ref} (${identity.label})\n\n`);

const client = new pg.Client({ connectionString: identity.certified.connectionString });
await client.connect();
try {
  await client.query('set session characteristics as transaction read only');

  // 1. WHO CAN SELECT public.stories. "permission denied for table stories" is a GRANT failure,
  //    not an RLS one - RLS returns zero rows, it does not raise.
  const grants = await client.query<{ grantee: string; privilege_type: string }>(
    `select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'stories'
      order by grantee, privilege_type`,
  );
  process.stdout.write('GRANTS on public.stories:\n');
  if (grants.rowCount === 0) process.stdout.write('  (none — this alone explains "permission denied")\n');
  for (const g of grants.rows) process.stdout.write(`  ${g.grantee.padEnd(16)}${g.privilege_type}\n`);

  // 2. Same question for the tables the story path joins through.
  for (const t of ['story_audience', 'story_tags', 'media_objects', 'media_destinations']) {
    const g = await client.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee in ('anon','authenticated')
        order by grantee, privilege_type`, [t],
    );
    process.stdout.write(`\nGRANTS on public.${t}: ${g.rowCount === 0 ? '(none to anon/authenticated)' : ''}\n`);
    for (const r of g.rows) process.stdout.write(`  ${r.grantee.padEnd(16)}${r.privilege_type}\n`);
  }

  // 3. RLS state — is_mutual_friend erroring is a different failure from a policy returning false.
  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in
        ('stories','story_audience','story_tags','media_objects','media_destinations')
      order by c.relname`,
  );
  process.stdout.write('\nRLS enabled:\n');
  for (const r of rls.rows) process.stdout.write(`  ${r.relname.padEnd(22)}${r.relrowsecurity}\n`);

  // 4. Does is_mutual_friend still exist, and with what signature? "erroring" often means the
  //    overload the caller uses was dropped and a different arity survived.
  const fns = await client.query<{ proname: string; args: string; prosecdef: boolean }>(
    `select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('is_mutual_friend','media_read_window','object_visible_to','story_visible_to')
      order by p.proname, args`,
  );
  process.stdout.write('\nFUNCTIONS:\n');
  if (fns.rowCount === 0) process.stdout.write('  (none of the four found)\n');
  for (const f of fns.rows) {
    process.stdout.write(`  ${f.proname}(${f.args})${f.prosecdef ? ' SECURITY DEFINER' : ''}\n`);
  }

  // 5. EXECUTE grants on those functions — a revoked EXECUTE raises rather than returning false.
  const ex = await client.query<{ proname: string; grantee: string }>(
    `select p.proname, a.grantee
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
       join lateral (select pg_get_userbyid(x.grantee) grantee) a on true
      where n.nspname = 'public'
        and p.proname in ('is_mutual_friend','media_read_window')
        and x.privilege_type = 'EXECUTE'
      order by p.proname, a.grantee`,
  );
  process.stdout.write('\nEXECUTE grants:\n');
  for (const r of ex.rows) process.stdout.write(`  ${r.proname.padEnd(22)}${r.grantee}\n`);
} finally {
  await client.end();
}
