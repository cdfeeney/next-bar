/**
 * Print the authorization surface derived from the migrations.
 *
 * The runbook's expected-state tables are generated from THIS output, so the
 * document cannot silently drift from the schema it is meant to verify.
 * Read-only; opens no network connection.
 *   npx tsx scripts/lib/authzSurface.report.mts
 */
import {
  readMigrations,
  tablesCreated,
  tablesWithRlsEnabled,
  functionsDefined,
  tableGrants,
  SERVICE_ROLE_ONLY_TABLES,
} from './authzSurface';

const files = readMigrations();
const tables = [...new Set(tablesCreated(files).map((t) => t.name))].sort();
const rls = tablesWithRlsEnabled(files);
const fns = functionsDefined(files);
const definers = [...new Set(fns.filter((f) => f.isSecurityDefiner).map((f) => f.name))].sort();
const roles = [...new Set(tableGrants(files).flatMap((g) => g.roles))].sort();

console.log(`migrations: ${files.length} (${files[0].prefix}..${files.at(-1)!.prefix})`);
console.log(`tables: ${tables.length}`);
// Coverage, not statement count: `rls` is the set of DISTINCT tables that
// have RLS enabled somewhere. There are more `enable row level security`
// statements than tables because a later migration idempotently re-enables
// one, and reporting the raw statement count would read as "22 of 21".
console.log(`tables with RLS: ${tables.filter((t) => rls.has(t)).length} of ${tables.length}`);
console.log(`tables missing RLS: ${tables.filter((t) => !rls.has(t)).join(', ') || '(none)'}`);
console.log(`functions parsed: ${fns.length}`);
console.log(`SECURITY DEFINER functions: ${definers.length}`);
console.log(`  unpinned search_path: ${fns.filter((f) => f.isSecurityDefiner && !f.pinsSearchPath).map((f) => f.name).join(', ') || '(none)'}`);
console.log(`grant roles seen: ${roles.join(', ')}`);
console.log(`service-role-only tables: ${SERVICE_ROLE_ONLY_TABLES.join(', ')}`);
console.log('\n-- tables --');
for (const t of tables) console.log(`  ${rls.has(t) ? 'RLS ' : 'NO  '} ${t}`);
console.log('\n-- SECURITY DEFINER functions --');
for (const d of definers) console.log(`  ${d}`);
