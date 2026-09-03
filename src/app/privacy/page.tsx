import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * /privacy — honest v1 privacy policy (H1 App-Store pack; finalized
 * 2026-07-25 on operator instruction, updated 2026-08-20 when migration 0064
 * made the numeric score visible to the accounts that follow you). Written to
 * match what the app ACTUALLY does; UPDATED must move whenever what it says
 * about sharing changes. hi@next-bar.app must be receiving mail (registrar
 * forwarding after the domain purchase) before App Store submission.
 */
export const metadata: Metadata = {
  title: 'Privacy Policy — Next Bar',
  description: 'How Next Bar handles your data.',
};

const UPDATED = 'September 3, 2026';

export default function PrivacyPage(): JSX.Element {
  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          The fine print
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">
          Privacy Policy
        </h1>
        <p className="text-muted text-sm">Last updated {UPDATED}</p>
      </header>

      <section className="max-w-md mx-auto px-6 space-y-6 text-sm leading-relaxed">
        <Block title="The short version">
          Next Bar helps you find NYC bars. Until you create an account,
          almost everything — your quiz answers, ratings, rankings, lists —
          lives in your browser on your device, not on our servers. If you
          sign in, your ratings and social graph sync to our database so
          they work across devices. We don&apos;t sell your data, and we
          don&apos;t show ads.
        </Block>

        <Block title="What we collect">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>On your device only (signed out):</strong> vibe-quiz
              answers, bar ratings and comparisons, saved lists, app
              preferences, and your night log (the bars you tell us
              you&apos;re at, so we can recap your night) — stored in your
              browser&apos;s local storage and never sent to us.
            </li>
            <li>
              <strong>If you create an account:</strong> your email address,
              a username you choose, your bar ratings, rankings, and who you
              follow — plus everything you post: stories and the photos in
              them, the bar and people you tag on a story, groups you join
              and messages you send there, night outs you plan or join, and
              the &ldquo;I&apos;m here&rdquo; presence pin you share with
              friends (a bar you pick by hand — never GPS — and it expires
              at 4:00&nbsp;AM). All of it is stored with our database provider
              (Supabase) so it works across devices.
            </li>
            <li>
              <strong>If you join the waitlist:</strong> your email, the
              neighborhood you picked, and — if you took the quiz first —
              your vibe profile, so your early-access invite matches your
              taste. That&apos;s the one time signed-out quiz answers leave
              your device.
            </li>
            <li>
              <strong>Location:</strong> only when you tap a
              &ldquo;near&nbsp;me&rdquo; feature, only in the browser, only
              while you use it. We never store your location on our servers.
            </li>
          </ul>
        </Block>

        <Block title="What we don't do">
          <ul className="list-disc pl-5 space-y-2">
            <li>No selling or renting your personal data. Ever.</li>
            <li>No third-party advertising or ad trackers.</li>
            <li>
              Your 1.0–10.0 scores go to your followers and nobody else. No
              public page and no shared link ever carries a score. Two things
              about that are worth knowing rather than discovering: while your
              account is public, anyone signed in can follow you without your
              approval and will then see your scores — turn on the
              private-account setting in Settings to approve each follower
              first, and existing followers keep the access they already have.
              And if you opt your list into public sharing, the tier you gave a
              bar (loved, liked, pass) becomes visible to anyone, including
              people who are not signed in; that opt-in is off unless you turn
              it on, and it never exposes the numeric score.
            </li>
          </ul>
        </Block>

        <Block title="Who else touches data">
          Bar photos, hours, and review snippets come from Google Places and
          are cached on our side. Bar photos are sourced from Google (Places);
          photographer attribution is shown in the photo viewer and is
          available on request. Our database and sign-in run on Supabase.
          Hosting is on Vercel. Each of these providers processes data under
          their own terms; none of them get your ratings or social graph for
          their own use.
        </Block>

        <Block title="Age">
          Next Bar is for people 21 and older (it&apos;s about bars). We
          don&apos;t knowingly collect data from anyone under 21.
        </Block>

        <Block title="Deleting your data">
          Signed-out data can be wiped any time from Settings → Clear all
          ratings, or by clearing your browser storage. Signed in, go to
          Settings → Delete account: it permanently and immediately removes
          your login, profile, ratings, rankings, follows, stories, night
          outs, presence pins, and group memberships. Messages you already
          sent to a group stay visible to its members, with your name
          detached. Photos you posted stop being reachable through the app
          at the same moment; clearing the leftover files out of our
          storage systems is a cleanup we run on our side — email us and
          we&apos;ll scrub them right away and confirm. Prefer a human for
          the whole thing? Email us and we&apos;ll do it for you.
        </Block>

        <Block title="Contact">
          Next Bar is an independent, individually operated service based in
          New York. Questions or requests:{' '}
          <a
            href="mailto:hi@next-bar.app"
            className="text-accent underline-offset-4 hover:underline"
          >
            hi@next-bar.app
          </a>
          . Privacy requests get a reply within a few days.
        </Block>

        <Block title="Changes">
          If this policy changes in a way that matters, we&apos;ll note it
          here with a new date up top.
        </Block>

        <p className="text-muted text-xs text-center pt-4">
          <Link
            href="/terms"
            className="text-accent underline-offset-4 hover:underline"
          >
            Terms of Use →
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
