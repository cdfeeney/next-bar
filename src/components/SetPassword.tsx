'use client';

/**
 * SetPassword — lets an already-signed-in user add or change a password
 * via supabase.auth.updateUser. This is the no-email path to password
 * sign-in: magic-link accounts have no password, and the built-in email
 * sender is rate-limited, so the /settings card must be able to mint one
 * without another inbox round-trip.
 *
 * Accepted tradeoff (security review 2026-07-23): no re-authentication
 * before the change. A magic-link account has no current password to
 * verify, and supabase.auth.reauthenticate() delivers its nonce over the
 * same rate-limited email channel this flow exists to avoid. Revisit when
 * custom SMTP lands (D2) — a reauth nonce becomes cheap then.
 */

import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';

// Matches the /auth client check and Supabase's server default.
const MIN_PASSWORD_LENGTH = 6;

type Status =
  | { kind: 'idle' }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export default function SetPassword(): JSX.Element {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        kind: 'error',
        message: `Password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus({ kind: 'error', message: 'Sign-in is unavailable on this build.' });
      return;
    }
    setStatus({ kind: 'saving' });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const friendly = /same.*password|different from the old/i.test(error.message)
        ? 'That is already your password.'
        : error.message;
      setStatus({ kind: 'error', message: friendly });
      return;
    }
    setPassword('');
    setStatus({ kind: 'saved' });
  };

  if (status.kind === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStatus({ kind: 'editing' })}
        className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
      >
        Set a password
      </button>
    );
  }

  if (status.kind === 'saved') {
    return (
      <p className="text-sm text-muted min-h-[44px] flex items-center">
        <span className="text-accent mr-1.5" aria-hidden="true">✓</span>
        Password set — you can sign in with it from now on.
      </p>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <label className="block">
        <span className="sr-only">New password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
          className="w-full bg-bg border border-border focus:border-accent outline-none rounded-2xl px-4 py-3 text-base min-h-[44px]"
          disabled={status.kind === 'saving'}
        />
      </label>
      {status.kind === 'error' ? (
        <p className="text-accent text-sm" role="alert">
          {status.message}
        </p>
      ) : null}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status.kind === 'saving'}
          className="bg-accent text-bg font-display text-sm px-5 py-2.5 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50"
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save password'}
        </button>
        <button
          type="button"
          onClick={() => setStatus({ kind: 'idle' })}
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
