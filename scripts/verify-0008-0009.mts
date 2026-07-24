/** One-off post-apply verification for migrations 0008 + 0009 (read-only). */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync('.env.local', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) throw new Error('DATABASE_URL not in .env.local');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = await client.query(
  `select table_name from information_schema.tables where table_schema='public' and table_name in ('follow_requests','push_subscriptions') order by 1`,
);
console.log('tables:', tables.rows.map((r) => r.table_name).join(', '));

const fns = await client.query(
  `select p.proname, pg_get_function_result(p.oid) as returns
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in
      ('follow_user','accept_follow_request','decline_follow_request','cancel_follow_request',
       'get_follow_requests','get_outgoing_requests','save_push_subscription','delete_push_subscription',
       'get_followers','get_follower_count')
    order by 1`,
);
for (const r of fns.rows) console.log(`fn ${r.proname} -> ${r.returns}`);

const idx = await client.query(
  `select indexname from pg_indexes where schemaname='public' and indexname in ('follow_requests_target_idx','push_subscriptions_endpoint_key') order by 1`,
);
console.log('indexes:', idx.rows.map((r) => r.indexname).join(', '));

const grants = await client.query(
  `select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='follow_requests' and grantee in ('anon','authenticated') order by 1,2`,
);
console.log('follow_requests grants:', JSON.stringify(grants.rows));
await client.end();
