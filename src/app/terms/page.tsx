import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * /terms — honest v1 terms of use (H1 App-Store pack). Same rules as
 * /privacy: describes actual behavior, bracketed [PLACEHOLDER] items need
 * operator/legal review before App Store submission.
 */
export const metadata: Metadata = {
  title: 'Terms of Use — Next Bar',
  description: 'The rules for using Next Bar.',
};

const UPDATED = 'July 25, 2026';

export default function TermsPage(): JSX.Element {
  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          The fine print
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">
          Terms of Use
        </h1>
        <p className="text-muted text-sm">Last updated {UPDATED}</p>
      </header>

      <section className="max-w-md mx-auto px-6 space-y-6 text-sm leading-relaxed">
        <Block title="What Next Bar is">
          A guide to NYC bars: personalized suggestions, your own ratings
          and rankings, and your friends&apos; picks. By using it you agree
          to these terms.
        </Block>

        <Block title="You must be 21+">
          Next Bar is about bars and drinking culture. You must be of legal
          drinking age in the United States (21) to use it.
        </Block>

        <Block title="Drink responsibly">
          Next Bar tells you where the good bars are — what you do there is
          on you. Know your limits, don&apos;t drink and drive, and look
          after your friends.
        </Block>

        <Block title="Bar information is best-effort">
          Hours, prices, specials, photos, and reviews come from public
          sources and our own curation. Bars change and close without
          telling us. Always check before making a trip; we&apos;re not
          liable if a bar is closed, changed, or not what you expected.
        </Block>

        <Block title="Your account">
          <ul className="list-disc pl-5 space-y-2">
            <li>Keep your login to yourself; you&apos;re responsible for it.</li>
            <li>
              Pick a username that isn&apos;t impersonating someone else or
              plainly offensive.
            </li>
            <li>
              Don&apos;t scrape, spam, flood the follow system, or probe
              other people&apos;s data. We rate-limit and may remove
              accounts that abuse the service.
            </li>
          </ul>
        </Block>

        <Block title="Your content">
          Your ratings, rankings, and lists are yours. By sharing them with
          friends in-app you let us show them to the people you&apos;ve
          connected with — that&apos;s the whole point. We don&apos;t
          publish them anywhere else.
        </Block>

        <Block title="The service">
          Next Bar is provided as-is, without warranties. We may change,
          pause, or shut down features (or the whole thing) at any time.
          We&apos;re a small operation; we&apos;ll be decent about it.
        </Block>

        <Block title="Liability">
          To the maximum extent the law allows, Next Bar isn&apos;t liable
          for indirect or consequential damages arising from using the
          service.
          <span className="block mt-2 text-muted text-xs">
            [PLACEHOLDER — operator: liability + governing-law language
            needs a real legal review before App Store submission. Governing
            law presumably New York.]
          </span>
        </Block>

        <Block title="Contact">
          <a
            href="mailto:hi@next-bar.app"
            className="text-accent underline-offset-4 hover:underline"
          >
            hi@next-bar.app
          </a>
          <span className="block mt-2 text-muted text-xs">
            [PLACEHOLDER — operator: confirm inbox + add legal entity name,
            same as /privacy.]
          </span>
        </Block>

        <p className="text-muted text-xs text-center pt-4">
          <Link
            href="/privacy"
            className="text-accent underline-offset-4 hover:underline"
          >
            Privacy Policy →
          </Link>
        </p>
      </section>
    </main>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="bg-surface border border-border rounded-3xl p-5">
      <h2 className="font-display text-base mb-2">{title}</h2>
      <div className="text-muted">{children}</div>
    </div>
  );
}
