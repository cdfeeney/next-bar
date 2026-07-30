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

  it('never echoes a value, only names', () => {
    const found = checkEnv({ ...BASE, NEXT_PUBLIC_DATABASE_URL: 'postgres://u:p@h/db' });
    for (const f of found) {
      expect(f.message).not.toContain('postgres://u:p@h/db');
      expect(JSON.stringify(f)).not.toContain('u:p@h');
    }
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
  it('flags a missing Supabase URL', () => {
    const found = checkEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' });
    expect(found.find((f) => f.name === 'NEXT_PUBLIC_SUPABASE_URL')?.severity).toBe('high');
  });

  it('treats an empty string as missing, not as set', () => {
    const found = checkEnv({ ...BASE, NEXT_PUBLIC_SUPABASE_URL: '   ' });
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
