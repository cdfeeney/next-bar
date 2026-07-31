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
  // Private-key blocks: RSA/EC/OpenSSH keys, and the `"private_key"` field of a
  // leaked GCP/Firebase service-account JSON. An entire credential class that
  // had zero coverage — the four patterns above are all token-shaped, and a PEM
  // block looks nothing like a token. This header string is never legitimately
  // committed, so it carries no false-positive risk.
  { name: 'PEM private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
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
      const m = p.re.exec(line);
      if (!m) continue;
      // Scope the placeholder test to the MATCHED VALUE, not the whole line.
      // Line-wide suppression was a live false negative: a real credential
      // sharing a line with an unrelated comment containing "fake", "dummy",
      // "placeholder", "YOUR_" etc. was silently exempted. Reproduced with a
      // real-shaped Postgres connection string trailed by the comment
      // "// not fake": it matched the Postgres pattern, then the whole-line
      // placeholder test saw "fake" and discarded the finding.
      // The reproduction is DESCRIBED, not written out — spelling the URL
      // inline made this very file trip the scanner, which is its own proof.
      if (PLACEHOLDER.test(m[0])) continue;
      // Report the LOCATION, never the matching text.
      hits.push(`${file}:${i + 1}  ${p.name}`);
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
