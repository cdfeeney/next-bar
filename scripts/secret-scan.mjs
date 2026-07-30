#!/usr/bin/env node
/**
 * Secret scan over TRACKED files (production-readiness goal 10).
 *
 * Deliberately narrow. A scanner that cries wolf gets disabled, and a disabled
 * scanner is worse than none — so this looks only for shapes that are almost
 * never legitimate in source: real-looking JWTs, Postgres URLs carrying
 * credentials, Google API keys, and any NEXT_PUBLIC_ variable whose NAME
 * claims to hold a service-role or database secret.
 *
 * Test fixtures and docs deliberately contain placeholder-shaped strings
 * (`example.supabase.co`, `postgres://u:p@h/db`), so obvious placeholders are
 * excluded by value, not by skipping whole directories — skipping directories
 * is how a real secret in a test file gets missed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'JWT-shaped token', re: /eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\./ },
  { name: 'Postgres URL with credentials', re: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@[^\s/'"]+/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // ASSIGNED, not merely mentioned. The docs and envCheck tests both name this
  // variable on purpose — it is the hazard they exist to describe — so matching
  // the bare name produced four false positives on the first run. What is
  // dangerous is a real VALUE bound to it, hence the assignment plus a
  // 12-character minimum, which placeholders like 'leaked' do not reach.
  {
    name: 'service-role/database secret ASSIGNED under a NEXT_PUBLIC_ name',
    re: /NEXT_PUBLIC_[A-Z_]*(?:SERVICE_ROLE|DATABASE_URL)[A-Z_]*\s*[=:]\s*['"`]?[A-Za-z0-9_\-./]{12,}/,
  },
];

/** Obvious placeholders — matched on the VALUE, never by skipping a path. */
const PLACEHOLDER = /example\.com|example\.supabase\.co|:\/\/u:p@|placeholder|YOUR_|xxxx|dummy|fake|test-key|<[A-Z_]+>/i;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !/\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|pdf|zip)$/i.test(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line) && !PLACEHOLDER.test(line)) {
        // Report the LOCATION, never the matching text.
        hits.push(`${file}:${i + 1}  ${p.name}`);
      }
    }
  });
}

if (hits.length === 0) {
  console.log(`secret scan: clean (${files.length} tracked files)`);
  process.exit(0);
}
console.log('secret scan FAILED — potential credentials in tracked files:');
for (const h of hits) console.log(`  ${h}`);
console.log('\n(locations only; the matching text is never printed)');
process.exit(1);
