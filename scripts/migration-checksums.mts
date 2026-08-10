/**
 * Print the LEDGER checksum of every local migration, for Check 7 of
 * `docs/SUPABASE-AUTHZ-VERIFICATION-RUNBOOK.md`.
 *
 *   npx tsx scripts/migration-checksums.mts
 *
 * Check 7 asks the operator to compare `public.schema_migrations.checksum`
 * against the local files, and classifies a difference as stop-and-escalate.
 * It has to be THIS hash: `checksum()` normalises CRLF to LF and strips
 * trailing whitespace before hashing, because the repo is developed on Windows
 * with `core.autocrlf` active. A raw `sha256sum` or `Get-FileHash` of the same
 * file therefore disagrees with the ledger for every migration whose working
 * copy has CRLF endings — which would read as the whole schema having been
 * tampered with, on a perfectly healthy database.
 *
 * Read-only, offline: it reads local files and connects to nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checksum } from '../src/lib/migrationPlan';

const dir = path.resolve(process.cwd(), 'supabase', 'migrations');

for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
  console.log(`${name}  ${checksum(readFileSync(path.join(dir, name), 'utf8'))}`);
}
