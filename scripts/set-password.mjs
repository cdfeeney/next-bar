/**
 * set-password.mjs — operator admin tool: set a user's password directly
 * via the Supabase admin API, bypassing email entirely.
 *
 * Exists because the built-in email sender is rate-limited (~2-4/hour): a
 * magic-link account that hits the cap has no way to mint a password. This
 * is the no-email escape hatch. Local use only — the service-role key must
 * NEVER ship to a client or be committed.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role key from dashboard>"
 *   node scripts/set-password.mjs you@example.com "new-password-here"
 *
 * Key location: Supabase dashboard → Project Settings → API keys →
 * service_role (secret). Unset the env var afterwards.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/set-password.mjs <email> <password>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password needs at least 6 characters.');
  process.exit(1);
}

// Reuse the project URL from .env.local so the script can't target the
// wrong project by accident. The service-role key may live there too
// (SUPABASE_SERVICE_ROLE_KEY=...) — .env.local is gitignored, which beats
// pasting the secret into a shell command or chat.
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
const envText = readFileSync(envPath, 'utf8');
const urlMatch = envText.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
if (!urlMatch) {
  console.error('NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
  process.exit(1);
}
const supabaseUrl = urlMatch[1].trim();

const keyMatch = envText.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? keyMatch?.[1].trim();
if (!serviceRoleKey) {
  console.error(
    'No service-role key. Add SUPABASE_SERVICE_ROLE_KEY=<key> to .env.local ' +
      '(dashboard → Project Settings → API keys → service_role) or set the env var.',
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Admin API has no lookup-by-email, so page through users to find the id.
async function findUserByEmail(target) {
  const normalized = target.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (hit) return hit;
    if (data.users.length < 100) return null;
  }
  return null;
}

const user = await findUserByEmail(email);
if (!user) {
  console.error(`No user found with email ${email}`);
  process.exit(1);
}

const { error } = await admin.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
});
if (error) {
  console.error(`updateUserById failed: ${error.message}`);
  process.exit(1);
}

console.log(
  `Password set for ${email} (user ${user.id}). Sign in at /auth with it now.`,
);
