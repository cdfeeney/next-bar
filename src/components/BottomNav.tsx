'use client';

import Link from 'next/link';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  /** The primary action — rendered as an enlarged, raised accent pill in the
   * center of the row. There is exactly one. */
  primary?: boolean;
};

// Order matters: the `primary` tab sits in the middle of the row.
const TABS: Tab[] = [
  {
    href: '/map',
    label: 'Map',
    isActive: (pathname) => pathname.startsWith('/map'),
  },
  {
    href: '/rankings',
    label: 'Rankings',
    isActive: (pathname) =>
      pathname.startsWith('/rankings') || pathname.startsWith('/tried'),
  },
  {
    href: '/',
    label: 'Next Bar?',
    primary: true,
    isActive: (pathname) =>
      pathname === '/' || pathname.startsWith('/where-next'),
  },
  {
    href: '/friends',
    // V8 canonical IA (V8-PRD-2026-08-13): the tab reads "Social"; the route
    // stays /friends so every existing link, test, and share target keeps working.
    label: 'Social',
    isActive: (pathname) =>
      pathname.startsWith('/friends') || pathname.startsWith('/u/'),
  },
  {
    href: '/settings',
    label: 'Account',
    isActive: (pathname) => pathname.startsWith('/settings'),
  },
];

export default function BottomNav(): JSX.Element | null {
  const pathname = usePathname();
  // B3c: incoming-request count badges the Friends tab (server mode
  // only; [] when signed out, so no badge in demo mode).
  const { requests } = useFollowRequests();

  // Waitlist + install pitch + api routes get no bottom nav — they're either
  // pre-funnel marketing surfaces or system endpoints. Auth + share are
  // full-screen focus surfaces: the raised center pill overlaps the form on
  // phone viewports, and a recipient opening a share link isn't in the app yet.
  //
  // The Settings stack below the Account root (/settings/*) is hierarchical,
  // not a tab: the gear pushes it, a top-left back arrow returns, and it
  // carries no bottom nav (approved/next-bar-account-a-settings.png). The
  // Account ROOT itself (/settings) keeps the five-tab nav.
  if (
    pathname === '/install' ||
    pathname === '/join' ||
    pathname === '/auth' ||
    pathname.startsWith('/share') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/settings/')
  ) {
    return null;
  }

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-[1000] bg-bg/95 backdrop-blur border-t border-border pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <ul className="mx-auto flex max-w-lg items-end justify-around">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);

          // The primary tab is only special when it IS the current page:
          // big raised accent pill on its own page, ordinary tab elsewhere
          // (operator call 2026-07-23 — the permanent pill dominated the
          // row and read as always-selected).
          if (tab.primary && active) {
            return (
              <li key={tab.href} className="flex flex-none">
                <Link
                  href={tab.href}
                  aria-current="page"
                  className={[
                    'flex flex-col items-center justify-center text-center touch-manipulation',
                    // whitespace-nowrap: in Playfair Display (wider than Poppins, uppercase +
                    // tracking) the label wrapped to two lines on iPhone 13 (V9-11 capture).
                    // V9-10b: the nowrap pill made the five-tab row 394px wide at any viewport
                    // (measured: pill 123px = 75px text + 24px padding each side), so it
                    // overflowed 390px, 375px and 320px iPhones. The label now scales with the
                    // viewport (13px from 383px up, 11px at 320px) and the padding is 16px.
                    'min-h-[60px] min-w-[84px] -mt-7 px-4 py-3 rounded-full whitespace-nowrap',
                    'bg-accent text-bg font-display text-[clamp(11px,3.4vw,13px)] uppercase tracking-wide',
                    'shadow-lg shadow-accent/40 transition-transform active:scale-95',
                  ].join(' ')}
                >
                  {tab.label}
                </Link>
              </li>
            );
          }

          // V9-10b: plain tabs share the remaining width equally (flex-1, min-w-0)
          // instead of sizing to their label; the label scales 9px–11px with the
          // viewport so RANKINGS / ACCOUNT fit a 320px row next to the pill.
          return (
            <li key={tab.href} className="flex flex-1 min-w-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex w-full flex-col items-center justify-center gap-1 min-h-[44px] px-1 py-1 touch-manipulation rounded-lg font-display text-[clamp(9px,2.9vw,11px)] uppercase tracking-wide transition-colors text-center whitespace-nowrap',
                  active
                    ? 'border border-accent/60 bg-accent/10 text-accent'
                    : 'border border-transparent text-muted',
                ].join(' ')}
              >
                <span className="relative">
                  {tab.label}
                  {tab.href === '/friends' && requests.length > 0 ? (
                    <span
                      aria-label={`${requests.length} pending follow request${requests.length === 1 ? '' : 's'}`}
                      className="absolute -top-2 -right-4 min-w-[16px] h-4 px-1 rounded-full bg-accent text-bg text-[10px] leading-4 font-display text-center"
                    >
                      {requests.length > 9 ? '9+' : requests.length}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
