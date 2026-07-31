import { describe, expect, it } from 'vitest';
import { checkEnv, isEnvSafe } from './envCheck.mjs';

/** A minimally valid environment, so each test varies exactly one thing. */
const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
};

describe('checkEnv — the leak that looks like nothing', () => {
  it('flags a server secret exposed under a NEXT_PUBLIC_ name as CRITICAL', () => {
    // The app works perfectly while doing this, which is exactly why it needs
    // a check rather than a code review.
    const found = checkEnv({ ...BASE, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'leaked' });
    const f = found.find((x) => x.name === 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
    expect(f?.severity).toBe('critical');
    expect(f?.message).toMatch(/ROTATE/);
  });

  it('does NOT flag the correctly-named server secret', () => {
    const found = checkEnv({ ...BASE, SUPABASE_SERVICE_ROLE_KEY: 'fine-here' });
    expect(found.filter((f) => f.severity === 'critical')).toEqual([]);
  });

  it('does NOT flag NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, which is public by design', () => {
    // Regression: GOOGLE_MAPS_API_KEY used to sit in SERVER_ONLY_SECRETS, so the
    // NEXT_PUBLIC_${secret} construction manufactured a CRITICAL on the browser
    // key — a DIFFERENT, legitimately public credential that the Places UI Kit
    // path requires. Every correct production config failed the check and was
    // told to rotate the wrong key. A checker that cries wolf gets switched off.
    const found = checkEnv(
      { ...BASE, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'browser-key', GOOGLE_MAPS_API_KEY: 'server-key' },
      { environment: 'production' },
    );
    expect(found.filter((f) => f.severity === 'critical')).toEqual([]);
    expect(isEnvSafe(found)).toBe(true);
  });

  it('flags a public var holding the SAME VALUE as a server secret', () => {
    // The PUBLIC_BY_DESIGN exemption is by name, so a name-only rule went blind
    // to the realistic mistake: pasting the SERVER Google key into the browser
    // variable. Both are "GOOGLE_MAPS_API_KEY"-ish names, and the exemption
    // waves the public one through. Compare values, not just names.
    const found = checkEnv(
      {
        ...BASE,
        GOOGLE_MAPS_API_KEY: 'the-server-key',
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'the-server-key',
      },
      { environment: 'production' },
    );
    const f = found.find((x) => x.severity === 'critical');
    expect(f).toBeDefined();
    expect(f?.message).toMatch(/ROTATE/);
    // Still names-only: the value must never appear in the output.
    expect(JSON.stringify(found)).not.toContain('the-server-key');
  });

  it('does not flag the pair when they are genuinely different keys', () => {
    const found = checkEnv(
      {
        ...BASE,
        GOOGLE_MAPS_API_KEY: 'server-key',
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'browser-key',
      },
      { environment: 'production' },
    );
    expect(found.filter((f) => f.severity === 'critical')).toEqual([]);
  });

  it('catches a server secret EMBEDDED in a longer public value', () => {
    // Exact equality missed this: the key still ships in the bundle, it is just
    // wrapped in query-string noise.
    const found = checkEnv(
      {
        ...BASE,
        GOOGLE_MAPS_API_KEY: 'srv-secret',
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '?key=srv-secret&restrict=none',
      },
      { environment: 'production' },
    );
    expect(found.some((f) => f.severity === 'critical')).toBe(true);
    expect(JSON.stringify(found)).not.toContain('srv-secret');
  });

  it('leaves the other server-secret names flagging normally', () => {
    const leaked = checkEnv({ ...BASE, NEXT_PUBLIC_DATABASE_URL: 'x' });
    expect(leaked.some((f) => f.severity === 'critical')).toBe(true);
  });

  it('never echoes a value, only names', () => {
    const found = checkEnv({ ...BASE, NEXT_PUBLIC_DATABASE_URL: 'postgres://u:p@h/db' });
    for (const f of found) {
      expect(f.message).not.toContain('postgres://u:p@h/db');
      expect(JSON.stringify(f)).not.toContain('u:p@h');
    }
  });
});

describe('checkEnv — harness flags respect the value the runtime actually reads', () => {
  it('does NOT flag a harness flag explicitly disabled with 0', () => {
    // The runtime branches on the exact string '1'. Failing a deploy because
    // LOOP_UNATTENDED=0 is present is a false positive on a config that is
    // explicitly OFF.
    const found = checkEnv(
      { ...BASE, LOOP_UNATTENDED: '0', G4_DUMP: '0' },
      { environment: 'production' },
    );
    expect(found.filter((f) => f.severity === 'critical')).toEqual([]);
  });
});

describe('checkEnv — local mode tolerates a Supabase-free config', () => {
  it('does not demand Supabase vars locally, where the app degrades by design', () => {
    // src/lib/supabase client returns null and middleware no-ops without them;
    // local dev is a supported dual mode, not a broken config.
    const found = checkEnv({}, { environment: 'local' });
    expect(isEnvSafe(found)).toBe(true);
  });

  it('still demands them for a real deployment', () => {
    expect(isEnvSafe(checkEnv({}, { environment: 'production' }))).toBe(false);
    expect(isEnvSafe(checkEnv({}, { environment: 'preview' }))).toBe(false);
  });
});

describe('checkEnv — harness flags in production', () => {
  it('flags LOOP_UNATTENDED in production and says what it breaks', () => {
    const found = checkEnv({ ...BASE, LOOP_UNATTENDED: '1' }, { environment: 'production' });
    const f = found.find((x) => x.name === 'LOOP_UNATTENDED');
    expect(f?.severity).toBe('critical');
    // The consequence is the point: users silently lose their deletion right.
    expect(f?.message).toMatch(/account.delete|503/i);
  });

  it('does not flag it locally, where the overnight loop legitimately sets it', () => {
    const found = checkEnv({ ...BASE, LOOP_UNATTENDED: '1' }, { environment: 'local' });
    expect(found.find((x) => x.name === 'LOOP_UNATTENDED')).toBeUndefined();
  });
});

describe('checkEnv — preview must not hold write credentials', () => {
  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'])('flags %s in preview', (name) => {
    const found = checkEnv({ ...BASE, [name]: 'x' }, { environment: 'preview' });
    expect(found.find((f) => f.name === name)?.severity).toBe('high');
  });

  it('allows the same credentials in production', () => {
    const found = checkEnv(
      { ...BASE, SUPABASE_SERVICE_ROLE_KEY: 'x', DATABASE_URL: 'y' },
      { environment: 'production' },
    );
    expect(isEnvSafe(found)).toBe(true);
  });
});

describe('checkEnv — essentials and analytics coherence', () => {
  // These pin the REQUIRED_ALWAYS rule, which is now scoped to deployed
  // environments — so they name one explicitly rather than relying on the
  // default. The local case is pinned separately above.
  it('flags a missing Supabase URL', () => {
    const found = checkEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' }, { environment: 'production' });
    expect(found.find((f) => f.name === 'NEXT_PUBLIC_SUPABASE_URL')?.severity).toBe('high');
  });

  it('treats an empty string as missing, not as set', () => {
    const found = checkEnv(
      { ...BASE, NEXT_PUBLIC_SUPABASE_URL: '   ' },
      { environment: 'production' },
    );
    expect(found.find((f) => f.name === 'NEXT_PUBLIC_SUPABASE_URL')).toBeDefined();
  });

  it('flags disagreeing analytics flags — App Privacy needs a definite answer', () => {
    const found = checkEnv({ ...BASE, ANALYTICS_ENABLED: '1' });
    expect(found.find((f) => f.name.includes('ANALYTICS'))?.severity).toBe('medium');
  });

  it('is clean when both analytics flags agree, either way', () => {
    expect(checkEnv({ ...BASE })).toEqual([]);
    expect(checkEnv({ ...BASE, ANALYTICS_ENABLED: '1', NEXT_PUBLIC_ANALYTICS: '1' })).toEqual([]);
  });
});

describe('isEnvSafe', () => {
  it('fails on critical or high, passes on medium alone', () => {
    expect(isEnvSafe([{ severity: 'critical', name: 'x', message: '' }])).toBe(false);
    expect(isEnvSafe([{ severity: 'high', name: 'x', message: '' }])).toBe(false);
    expect(isEnvSafe([{ severity: 'medium', name: 'x', message: '' }])).toBe(true);
    expect(isEnvSafe([])).toBe(true);
  });
});
