import Link from 'next/link';

export default function FriendsPage(): JSX.Element {
  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Coming with the app
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Friends</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          See what people you actually trust rated highly. Find consensus picks
          for the group chat.
        </p>
      </header>

      <section className="max-w-md mx-auto px-6 mt-12 mb-24">
        <div className="bg-surface border border-border rounded-3xl p-6 md:p-8 text-center">
          <p className="font-display text-2xl mb-3 leading-snug">
            The social layer ships
            <br />
            with the native app.
          </p>
          <p className="text-muted text-sm mb-6 leading-relaxed">
            Phone-based accounts, follow your bar-savvy friends, see who&apos;s out tonight,
            and find the bars everyone agrees on. No noise, no influencers.
          </p>
          <Link
            href="/install"
            className="inline-flex items-center justify-center bg-accent text-bg font-display text-base px-6 py-3 rounded-2xl min-h-[44px] touch-manipulation"
          >
            Get notified when it&apos;s ready →
          </Link>
        </div>

        <div className="mt-10 border-t border-border pt-8">
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
            What&apos;s coming
          </h2>
          <ul className="space-y-3 text-sm text-muted">
            <li className="flex items-start gap-3">
              <span className="text-accent">·</span>
              Follow friends by phone number — no usernames
            </li>
            <li className="flex items-start gap-3">
              <span className="text-accent">·</span>
              See a friend&apos;s top 10 bars without scrolling
            </li>
            <li className="flex items-start gap-3">
              <span className="text-accent">·</span>
              &ldquo;Where should we go&rdquo; mode — pools group ratings to find consensus
            </li>
            <li className="flex items-start gap-3">
              <span className="text-accent">·</span>
              Quiet by default — no feeds, no likes, no follower counts
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
