import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('/api/health build identity', () => {
  it('falls through an empty Vercel SHA to the explicit build SHA', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', 'abcdef1234567890');

    await expect((await GET()).json()).resolves.toMatchObject({
      sha: 'abcdef123456',
    });
  });
});
