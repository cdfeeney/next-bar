import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: vi.fn() }));
vi.mock('@/lib/accountContentSync', () => ({
  syncAccountContent: vi.fn(() => Promise.resolve({})),
  syncAccountContentKey: vi.fn(() => Promise.resolve('in-sync')),
}));

import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { syncAccountContent, syncAccountContentKey } from '@/lib/accountContentSync';
import { ACCOUNT_CONTENT_META_KEY, storageKeyForAccountContent } from '@/lib/accountContent.local';
import AccountContentSync from './AccountContentSync';

const useAuthMock = vi.mocked(useAuth);
const getSupabaseMock = vi.mocked(getBrowserSupabase);
const syncAllMock = vi.mocked(syncAccountContent);
const syncKeyMock = vi.mocked(syncAccountContentKey);
const fakeClient = {} as ReturnType<typeof getBrowserSupabase>;

function signedOut(): ReturnType<typeof useAuth> {
  return {
    status: 'signed-out',
    user: null,
    session: null,
    signOut: vi.fn(),
  };
}

function signedIn(userId = 'user-a'): ReturnType<typeof useAuth> {
  return {
    status: 'signed-in',
    user: { id: userId },
    session: { user: { id: userId } },
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  useAuthMock.mockReturnValue(signedOut());
  getSupabaseMock.mockReturnValue(fakeClient);
  syncAllMock.mockResolvedValue({} as never);
  syncKeyMock.mockResolvedValue('in-sync');
});

describe('AccountContentSync wiring', () => {
  it('keeps anonymous mutations local while timestamping them for first sign-in', () => {
    render(<AccountContentSync />);
    window.localStorage.setItem(storageKeyForAccountContent('lists'), '[]');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: storageKeyForAccountContent('lists') }));
    });
    expect(JSON.parse(window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY)!)).toHaveProperty('lists');
    expect(getSupabaseMock).not.toHaveBeenCalled();
    expect(syncAllMock).not.toHaveBeenCalled();
    expect(syncKeyMock).not.toHaveBeenCalled();
  });

  it('runs a full pull on sign-in and write-through for a real content event', async () => {
    useAuthMock.mockReturnValue(signedIn());
    render(<AccountContentSync />);
    expect(syncAllMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }));

    window.localStorage.setItem(storageKeyForAccountContent('lists'), '[]');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: storageKeyForAccountContent('lists') }));
    });
    await waitFor(() => {
      expect(syncKeyMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', key: 'lists' }),
      );
    });
  });

  it('ignores the null-key account-wipe refresh so sign-out cannot delete server data', async () => {
    useAuthMock.mockReturnValue(signedIn());
    render(<AccountContentSync />);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    await Promise.resolve();
    expect(syncKeyMock).not.toHaveBeenCalled();
  });
});
