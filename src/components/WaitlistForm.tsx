'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { VibeProfile } from '@/types';
import { quiz } from '@/lib/quiz';

type WaitlistFormProps = { profile: VibeProfile | null };
type Status = 'idle' | 'loading' | 'success' | 'error';

// Full service area, sourced from the quiz picker so the two lists can't
// drift (operator QA5: the waitlist select showed only 3 hoods while the
// catalog serves 18).
const SERVICE_AREA_NEIGHBORHOODS: readonly string[] =
  quiz.find(
    (q): q is Extract<(typeof quiz)[number], { kind: 'neighborhoodMultiSelect' }> =>
      q.kind === 'neighborhoodMultiSelect',
  )?.options ?? [];

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
    // LOW/join fix (U1): success used to be a dead end — hand the person
    // straight into the product they just signed up for.
    return (
      <section className="px-6 py-16">
        <div className="max-w-md mx-auto text-center">
          <h2 className="font-display text-3xl mb-3">You&apos;re on the list.</h2>
          <p className="text-muted mb-8">
            We launch the iOS app this summer. We&apos;ll DM you first.
          </p>
          <div className="space-y-3">
            <a
              href="/quiz"
              className="block bg-accent hover:bg-accentDim transition-colors text-bg font-display text-lg py-3 rounded-xl touch-manipulation"
            >
              Meanwhile — find tonight&apos;s bar →
            </a>
            <a
              href="/map"
              className="block text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] leading-[44px] touch-manipulation"
            >
              or browse the whole map
            </a>
          </div>
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
            {SERVICE_AREA_NEIGHBORHOODS.map((hood) => (
              <option key={hood} value={hood}>
                {hood}
              </option>
            ))}
            <option value="Other NYC">Other NYC neighborhood</option>
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
