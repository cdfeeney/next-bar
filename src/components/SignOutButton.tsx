'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  ACCOUNT_CONTENT_KEYS,
  discardLocalAccountContent,
  type AccountContentKey,
} from '@/lib/accountContent.local';
import {
  classifyAccountContent,
  clearConfirmedAccountContentMeta,
} from '@/lib/accountContent.confirmed';
import { ACCOUNT_CONTENT_LABELS } from '@/lib/accountContent.labels';
import { syncAccountContent } from '@/lib/accountContentSync';

/**
 * SignOutButton — voluntary sign-out with the v2.1 preservation gate.
 *
 * Signing out with UNCONFIRMED content is a decision, not a default: the
 * dialog offers exactly Retry sync / named Discard / Cancel (locked spec).
 * Content that IS confirmed clean signs out directly — server presence is
 * proven, and the ordinary sign-out path preserves a quarantined copy
 * anyway (released automatically on the next sign-in).
 */

function unconfirmedKeys(userId: string): AccountContentKey[] {
  return ACCOUNT_CONTENT_KEYS.filter((key) => {
    const cls = classifyAccountContent(key, userId);
    return cls === 'dirty' || cls === 'invalid';
  });
}

export default function SignOutButton(): JSX.Element | null {
  const auth = useAuth();
  const [dialog, setDialog] = useState<{
    keys: AccountContentKey[];
    retryFailed: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const requestSignOut = useCallback((): void => {
    if (auth.status !== 'signed-in') return;
    const keys = unconfirmedKeys(auth.user.id);
    if (keys.length === 0) {
      void auth.signOut();
      return;
    }
    setDialog({ keys, retryFailed: false });
  }, [auth]);

  const retrySync = useCallback(async (): Promise<void> => {
    if (auth.status !== 'signed-in') return;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setDialog((d) => (d ? { ...d, retryFailed: true } : d));
      return;
    }
    setBusy(true);
    try {
      await syncAccountContent({
        supabase,
        userId: auth.user.id,
        stillCurrent: () => true,
      });
      const remaining = unconfirmedKeys(auth.user.id);
      if (remaining.length === 0) {
        setDialog(null);
        await auth.signOut();
        return;
      }
      setDialog({ keys: remaining, retryFailed: true });
    } finally {
      setBusy(false);
    }
  }, [auth]);

  const discardAndSignOut = useCallback(async (): Promise<void> => {
    if (auth.status !== 'signed-in' || !dialog) return;
    const names = dialog.keys
      .map((key) => ACCOUNT_CONTENT_LABELS[key])
      .join(', ');
    // THE one named discard confirmation (locked spec): the exact domains
    // being discarded are spelled out; nothing else is ever deleted here.
    if (
      !window.confirm(
        `Discard without syncing: ${names}? This deletes them from this device permanently. Content already synced to your account is kept.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      discardLocalAccountContent(dialog.keys);
      clearConfirmedAccountContentMeta(dialog.keys);
      setDialog(null);
      await auth.signOut();
    } finally {
      setBusy(false);
    }
  }, [auth, dialog]);

  if (auth.status !== 'signed-in') return null;

  return (
    <>
      <button
        type="button"
        onClick={requestSignOut}
        className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
      >
        Sign out
      </button>
      {dialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Some content hasn't synced yet"
          data-testid="signout-unsynced-dialog"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 pb-24"
        >
          <div className="bg-surface border border-border rounded-3xl p-6 max-w-sm w-full">
            <h2 className="font-display text-xl mb-2">
              Some content hasn&apos;t synced yet
            </h2>
            <p className="text-muted text-sm mb-1 leading-relaxed">
              Not yet in your account:
            </p>
            <ul className="text-sm mb-4 list-disc list-inside">
              {dialog.keys.map((key) => (
                <li key={key}>{ACCOUNT_CONTENT_LABELS[key]}</li>
              ))}
            </ul>
            {dialog.retryFailed ? (
              <p role="status" className="text-xs text-muted mb-4">
                Sync didn&apos;t finish — still unsynced. You can retry,
                discard the items above, or cancel.
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void retrySync()}
                className="bg-accent text-bg rounded-full px-6 py-3 min-h-[48px] touch-manipulation font-display disabled:opacity-60"
              >
                {busy ? 'Syncing…' : 'Retry sync'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void discardAndSignOut()}
                className="border border-border text-muted rounded-full px-6 py-3 min-h-[48px] touch-manipulation font-display hover:text-text disabled:opacity-60"
              >
                Discard and sign out
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
                className="text-muted text-sm min-h-[44px] touch-manipulation underline-offset-4 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
