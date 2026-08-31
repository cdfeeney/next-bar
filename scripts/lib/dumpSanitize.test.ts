import { describe, expect, it } from 'vitest';

import {
  residualAddresses, rewriteEmails, sanitizedEmail, sanitizeUserTables,
} from './dumpSanitize';

/**
 * THE FIRST SANITIZER REWROTE `auth.users.email` AND NOTHING ELSE.
 *
 * The dry run of the staging rebuild caught it: the tool's own leak check reported that
 * `raw_user_meta_data` still carried a real address, on a dump that had just been declared
 * sanitized. Supabase stores the address in `auth.users.email`, in
 * `auth.users.raw_user_meta_data`, and again in `auth.identities.identity_data`, so rewriting one
 * of the three produces a dump that reads as clean and is not.
 *
 * These are the shapes that mattered, pinned so the next edit cannot quietly drop one.
 */
const USER_ID = '11111111-2222-3333-4444-555555555555';

describe('every place Supabase keeps an address gets rewritten', () => {
  const tables = {
    'auth.users': [{
      id: USER_ID,
      email: 'real.person@gmail.com',
      encrypted_password: '$2a$10$notarealhash',
      raw_user_meta_data: {
        email: 'real.person@gmail.com',
        email_verified: true,
        full_name: 'A Real Person',
        sub: USER_ID,
      },
    }],
    'auth.identities': [{
      user_id: USER_ID,
      provider: 'email',
      identity_data: { email: 'real.person@gmail.com', sub: USER_ID },
    }],
    'public.bars': [{ id: 'bar-1', name: 'Somewhere' }],
  };

  const out = sanitizeUserTables(tables);
  const user = out['auth.users'][0];
  const identity = out['auth.identities'][0];

  it('rewrites the user column', () => {
    expect(user.email).toBe(sanitizedEmail(0));
    expect(user.email).toBe('user-1@example.invalid');
  });

  it('rewrites the address INSIDE raw_user_meta_data — the one the first version missed', () => {
    const meta = user.raw_user_meta_data as Record<string, unknown>;
    expect(meta.email).toBe('user-1@example.invalid');
    expect(JSON.stringify(meta)).not.toContain('real.person@gmail.com');
  });

  it('rewrites identity_data to the SAME address, or the account cannot sign in', () => {
    const data = identity.identity_data as Record<string, unknown>;
    expect(data.email).toBe(user.email);
    expect(JSON.stringify(identity)).not.toContain('real.person@gmail.com');
  });

  it('keeps everything that is not an address verbatim', () => {
    expect(user.id).toBe(USER_ID);
    expect(user.encrypted_password).toBe('$2a$10$notarealhash');
    const meta = user.raw_user_meta_data as Record<string, unknown>;
    expect(meta.full_name).toBe('A Real Person');
    expect(meta.email_verified).toBe(true);
    expect(meta.sub).toBe(USER_ID);
    expect(out['public.bars']).toEqual(tables['public.bars']);
  });

  it('leaves no residual address anywhere in the sanitized user tables', () => {
    expect(residualAddresses(out['auth.users'])).toEqual([]);
    expect(residualAddresses(out['auth.identities'])).toEqual([]);
  });
});

describe('rewriteEmails handles the shapes a dump actually contains', () => {
  it('rewrites a bare string', () => {
    expect(rewriteEmails('a@b.com', 'x@example.invalid')).toBe('x@example.invalid');
  });

  it('rewrites inside nested objects and arrays', () => {
    const value = { a: [{ b: 'deep@nested.org' }], c: 'other@place.net' };
    expect(JSON.stringify(rewriteEmails(value, 'x@example.invalid')))
      .toBe('{"a":[{"b":"x@example.invalid"}],"c":"x@example.invalid"}');
  });

  it('rewrites inside a column that arrived as JSON TEXT rather than an object', () => {
    // A driver or a dump round-trip can hand back the json column as a string; treating it as
    // opaque would have left the address in place.
    const asText = JSON.stringify({ email: 'real@person.com', sub: 'abc' });
    const out = rewriteEmails(asText, 'x@example.invalid') as string;
    expect(out).not.toContain('real@person.com');
    expect(JSON.parse(out).email).toBe('x@example.invalid');
    expect(JSON.parse(out).sub).toBe('abc');
  });

  it('leaves non-addresses alone, including things with an @ that are not addresses', () => {
    expect(rewriteEmails('@handle', 'x@example.invalid')).toBe('@handle');
    expect(rewriteEmails(null, 'x@example.invalid')).toBeNull();
    expect(rewriteEmails(42, 'x@example.invalid')).toBe(42);
    expect(rewriteEmails(true, 'x@example.invalid')).toBe(true);
  });

  it('gives each account its own stable address', () => {
    expect(sanitizedEmail(0)).toBe('user-1@example.invalid');
    expect(sanitizedEmail(7)).toBe('user-8@example.invalid');
  });

  it('an identity whose user is absent from the dump is left ALONE, not given a wrong address', () => {
    const out = sanitizeUserTables({
      'auth.users': [],
      'auth.identities': [{ user_id: 'orphan', identity_data: { email: 'real@person.com' } }],
    });
    // Inventing an address here would hide an internally inconsistent dump.
    expect(residualAddresses(out['auth.identities'])).toEqual(['identity_data']);
  });
});
