// Confirm Codex round 3's two CRITICALs against the code as it stands. No connection is opened:
// pg.Client's constructor resolves parameters without touching the network.
import { resolveIdentity, resolveTarget, deriveLabel } from 'file:///D:/projects/next-bar/scripts/lib/migration-target-guard.ts';
import pg from 'file:///D:/projects/next-bar/node_modules/pg/lib/index.js';

const PROD = 'nuhqlvneokucxomguxhi';
const STAGING = 'wqxovhiovgcijmfzxgby';

console.log('=== CRITICAL 1: a production ref declared with invalid SYNTAX fails open ===');
const bad = { productionRef: 'not-a-project-ref', stagingRefs: [STAGING, PROD] };
const url = `postgresql://postgres.${PROD}:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;
try {
  const label = deriveLabel(PROD, bad);
  const r = resolveTarget({
    env: label ?? 'unknown',
    shellDatabaseUrl: undefined, shellDeclaredEnv: undefined,
    databaseUrl: url, apiUrl: `https://${PROD}.supabase.co`,
    actualEnv: undefined, classification: bad,
  });
  console.log(`  PRODUCTION ACCEPTED as "${r.actualEnv}"  <-- CONFIRMED`);
} catch (e) {
  console.log(`  refused: ${e.message}`);
}

console.log('\n=== CRITICAL 2: pg.Client fills host from PGHOST; the guard asks parse() only ===');
process.env.PGHOST = `db.${PROD}.supabase.co`;
const noHost = `postgresql://postgres.${STAGING}@/postgres`;
try {
  const id = resolveIdentity(noHost);
  const client = new pg.Client({ connectionString: noHost });
  const actual = client.connectionParameters;
  console.log(`  guard says ref=${id.ref} host=${id.host}`);
  console.log(`  pg.Client will connect to host=${actual.host} user=${actual.user}`);
  console.log(actual.host.includes(PROD) && id.ref === STAGING
    ? '  GUARD SAYS STAGING, CLIENT REACHES PRODUCTION  <-- CONFIRMED'
    : '  no divergence');
} catch (e) {
  console.log(`  refused: ${e.message}`);
}

console.log('\n=== MEDIUM: a ref in BOTH staging and development is not refused ===');
try {
  const l = deriveLabel(STAGING, { productionRef: PROD, stagingRefs: [STAGING], developmentRefs: [STAGING] });
  console.log(`  accepted, derives "${l}"  <-- CONFIRMED`);
} catch (e) {
  console.log(`  refused: ${e.message}`);
}
