/**
 * SANITIZING A PRODUCTION DUMP ON ITS WAY INTO STAGING.
 *
 * The rule from A4 is "emails rewritten, everything else verbatim", and the first implementation
 * took that too literally: it rewrote `auth.users.email` and nothing else, while the real addresses
 * sat untouched in `auth.users.raw_user_meta_data` and `auth.identities.identity_data`. Supabase
 * puts the address in all three, so a dump sanitized in one place is not sanitized.
 *
 * EVERY REWRITE FOR ONE ACCOUNT USES THE SAME ADDRESS. `auth.identities.identity_data.email` has to
 * match `auth.users.email` for that user — the address is how the identity is matched at sign-in, so
 * rewriting them to two different strings would produce accounts that exist and cannot log in,
 * which is the failure the "keep encrypted_password" rule exists to avoid, arrived at from the
 * other side.
 *
 * WHAT IS STILL VERBATIM: ids, password hashes, timestamps, and every application column. This
 * module only touches things that look like an email address.
 */

/** Deliberately loose: it must catch an address anywhere inside a JSON blob, not validate one. */
const EMAIL_SHAPED = /[^\s"'<>@,;]+@[^\s"'<>@,;]+\.[^\s"'<>@,;]+/g;

export const SANITIZED_DOMAIN = 'example.invalid';

/** The address a given account gets. Stable and positional, so a rebuild is reproducible. */
export function sanitizedEmail(index: number): string {
  return `user-${index + 1}@${SANITIZED_DOMAIN}`;
}

/**
 * Replaces every email-shaped string ANYWHERE inside a value — object, array, string, or a JSON
 * string holding one of those — with `replacement`. Non-string leaves are returned untouched.
 */
export function rewriteEmails(value: unknown, replacement: string): unknown {
  if (typeof value === 'string') {
    // Supabase hands these back as objects, but a driver or a dump round-trip can leave JSON text.
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(rewriteEmails(JSON.parse(trimmed), replacement));
      } catch {
        // Not JSON after all; fall through and treat it as a plain string.
      }
    }
    return value.replace(EMAIL_SHAPED, replacement);
  }
  if (Array.isArray(value)) return value.map((item) => rewriteEmails(item, replacement));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, rewriteEmails(item, replacement)]),
    );
  }
  return value;
}

export type Row = Record<string, unknown>;

/**
 * The whole dump's user-facing identity, rewritten consistently.
 *
 * Returns the tables it was given, with `auth.users` and `auth.identities` sanitized and everything
 * else passed through. Both are handled here rather than per-table because the identity rows have
 * to be given the SAME address as the user row they belong to, which needs both tables at once.
 */
export function sanitizeUserTables(tables: Record<string, Row[]>): Record<string, Row[]> {
  const users = tables['auth.users'] ?? [];
  const emailByUserId = new Map<string, string>();

  const sanitizedUsers = users.map((row, index) => {
    const email = sanitizedEmail(index);
    const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
    if (id) emailByUserId.set(id, email);
    return {
      ...row,
      email,
      raw_user_meta_data: rewriteEmails(row.raw_user_meta_data, email),
    };
  });

  const identities = tables['auth.identities'] ?? [];
  const sanitizedIdentities = identities.map((row) => {
    const userId = typeof row.user_id === 'string' ? row.user_id : String(row.user_id ?? '');
    const email = emailByUserId.get(userId);
    // An identity with no matching user in this dump is left ALONE rather than given an arbitrary
    // address: silently inventing one would hide a dump that is internally inconsistent.
    if (!email) return row;
    return {
      ...row,
      identity_data: rewriteEmails(row.identity_data, email),
      ...(typeof row.email === 'string' ? { email } : {}),
    };
  });

  const out: Record<string, Row[]> = { ...tables };
  if (tables['auth.users']) out['auth.users'] = sanitizedUsers;
  if (tables['auth.identities']) out['auth.identities'] = sanitizedIdentities;
  return out;
}

/** Any email-shaped value that is NOT already sanitized, for a caller that wants to report leaks. */
export function residualAddresses(rows: Row[]): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
      for (const match of text.match(EMAIL_SHAPED) ?? []) {
        if (!match.endsWith(SANITIZED_DOMAIN)) found.add(key);
      }
    }
  }
  return [...found].sort();
}
