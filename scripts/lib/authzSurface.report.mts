/**
 * Print the authorization surface derived from the migrations.
 *
 * The runbook's expected-state tables are generated from THIS output, so the
 * document cannot silently drift from the schema it is meant to verify.
 * Read-only; opens no network connection.
 *   npx tsx scripts/lib/authzSurface.report.mts
 */
import {
  ANON_EXECUTABLE_FUNCTIONS,
  ANON_READABLE_TABLES,
  POLICY_LESS_BY_DESIGN,
  RUNNER_MANAGED_TABLES,
  SERVICE_ROLE_ONLY_TABLES,
  anonTableGrants,
  expectedPublicTables,
  functionGrants,
  functionsDefined,
  netTablePrivileges,
  policiesByTable,
  policyLessTables,
  readMigrations,
  tableGrants,
  tablesCreated,
  tablesRelyingOnDefaultGrants,
  tablesWithRlsEnabled,
} from './authzSurface';

const files = readMigrations();
const created = [...new Set(tablesCreated(files).map((t) => t.name))].sort();
const tables = expectedPublicTables(files);
const rls = tablesWithRlsEnabled(files);
const fns = functionsDefined(files);
const definers = [...new Set(fns.filter((f) => f.isSecurityDefiner).map((f) => f.name))].sort();
const roles = [...new Set(tableGrants(files).flatMap((g) => g.roles))].sort();
const policies = policiesByTable(files);
const policyLess = policyLessTables(files);

console.log(`migrations: ${files.length} (${files[0].prefix}..${files.at(-1)!.prefix})`);
console.log(`tables created by migrations: ${created.length}`);
console.log(`tables created by the runner: ${RUNNER_MANAGED_TABLES.join(', ')}`);
console.log(`tables expected in a healthy public schema: ${tables.length}`);
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

console.log(`\n-- policy-less tables (RLS on, zero policies: default-deny) --`);
console.log(`  derived:  ${policyLess.join(', ') || '(none)'}`);
console.log(`  declared: ${POLICY_LESS_BY_DESIGN.join(', ')}`);
console.log(
  `  agree:    ${JSON.stringify(policyLess) === JSON.stringify([...POLICY_LESS_BY_DESIGN].sort())}`,
);

console.log(`\n-- anon TABLE grants --`);
for (const g of anonTableGrants(files)) console.log(`  ${g.table}: ${g.privileges.join(', ')}`);
console.log(`  declared allowlist: ${ANON_READABLE_TABLES.join(', ')}`);

console.log(`\n-- anon FUNCTION grants (a separate surface) --`);
for (const g of functionGrants(files).filter((g) => g.roles.includes('anon'))) {
  console.log(`  ${g.function} (${g.file})`);
}
console.log(`  declared allowlist: ${ANON_EXECUTABLE_FUNCTIONS.join(', ')}`);

console.log(`\n-- tables relying on Supabase DEFAULT grants (never revoked) --`);
console.log(`  ${tablesRelyingOnDefaultGrants(files).join(', ') || '(none)'}`);

console.log('\n-- tables: RLS / policy count --');
for (const t of tables) {
  const count = policies.get(t)?.length ?? 0;
  console.log(`  ${rls.has(t) ? 'RLS ' : 'NO  '} ${String(count).padStart(2)} policy  ${t}`);
}

console.log('\n-- net table privileges from the migrations --');
for (const [table, byRole] of netTablePrivileges(files)) {
  for (const [role, privs] of byRole) console.log(`  ${table} -> ${role}: ${privs.join(', ')}`);
}

console.log('\n-- policies per table --');
for (const [table, names] of policies) {
  if (!names.length) continue;
  console.log(`  ${table}`);
  for (const n of names) console.log(`      ${n}`);
}

console.log('\n-- SECURITY DEFINER functions --');
for (const d of definers) console.log(`  ${d}`);
