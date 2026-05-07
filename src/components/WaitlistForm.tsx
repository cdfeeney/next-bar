'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { VibeProfile } from '@/types';

type WaitlistFormProps = { profile: VibeProfile | null };
type Status = 'idle' | 'loading' | 'success' | 'error';

export default function WaitlistForm({ profile }: WaitlistFormProps) {
  const [email, setEmail] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, neighborhood, vibe_profile: profile }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <section className="px-6 py-16">
        <div className="max-w-md mx-auto text-center">
          <h2 className="font-display text-3xl mb-3">You&apos;re on the list.</h2>
          <p className="text-muted">
            We launch the iOS app this summer. We&apos;ll DM you first.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-16">
      <div className="max-w-md mx-auto">
        <h2 className="font-display text-3xl mb-2 text-center">Want it on your phone?</h2>
        <p className="text-muted text-center mb-8">
          Get early TestFlight access when we launch.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:border-accent outline-none"
          />
          <select
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:border-accent outline-none"
          >
            <option value="">Where do you go out most?</option>
            <option value="LES">LES</option>
            <option value="East Village">East Village</option>
            <option value="Williamsburg">Williamsburg</option>
            <option value="Other NYC">Other NYC neighborhood</option>
            <option value="Outside NYC">Outside NYC</option>
          </select>
          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full bg-accent hover:bg-accentDim disabled:opacity-60 transition-colors text-text font-display text-lg py-3 rounded-xl"
          >
            {status === 'loading' ? 'Joining...' : 'Join the waitlist'}
          </button>
          {status === 'error' && (
            <p className="text-red-400 text-sm text-center">
              Something went wrong. Try again.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
