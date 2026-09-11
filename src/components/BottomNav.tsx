'use client';

import Link from 'next/link';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  /** 24x24 stroke glyph paths (viewBox 0 0 24 24), same style as GearIcon. */
  glyph: JSX.Element;
};

// V10-08 (owner, 2026-09-11): the text-only row is gone. Five uppercase Poppins Bold
// labels never fit 320-390px iPhones (ACCOUNT's highlight ran off the right edge on
// build 11 and the 5847c15 staging), so this is now the iOS tab bar from the HIG:
// https://developer.apple.com/design/human-interface-guidelines/tab-bars
// 49pt bar + safe area, glyph over a 10pt label, active = tint only, no boxes, no
// raised pill. Labels are short by design; the row divides into five equal slots.
const TABS: Tab[] = [
  {
    href: '/map',
    label: 'Map',
    isActive: (pathname) => pathname.startsWith('/map'),
    glyph: (
      <>
        <path d="M12 21s-6-5.2-6-10.5a6 6 0 0 1 12 0C18 15.8 12 21 12 21Z" />
        <circle cx="12" cy="10.5" r="2.2" />
      </>
    ),
  },
  {
    href: '/rankings',
    label: 'Rankings',
    isActive: (pathname) =>
      pathname.startsWith('/rankings') || pathname.startsWith('/tried'),
    glyph: (
      <>
        <path d="M4 20V11" />
        <path d="M12 20V4" />
        <path d="M20 20v-6" />
      </>
    ),
  },
  {
    href: '/',
    label: 'Next Bar?',
    isActive: (pathname) =>
      pathname === '/' || pathname.startsWith('/where-next'),
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
      </>
    ),
  },
  {
    href: '/friends',
    // V8 canonical IA (V8-PRD-2026-08-13): the tab reads "Social"; the route
    // stays /friends so every existing link, test, and share target keeps working.
    label: 'Social',
    isActive: (pathname) =>
      pathname.startsWith('/friends') || pathname.startsWith('/u/'),
    glyph: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
        <path d="M17.5 14.3c2.1.7 3.5 2.7 3.5 5.7" />
      </>
    ),
  },
  {
    href: '/settings',
    label: 'Account',
    isActive: (pathname) => pathname.startsWith('/settings'),
    glyph: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      </>
    ),
  },
];

export default function BottomNav(): JSX.Element | null {
  const pathname = usePathname();
  // B3c: incoming-request count badges the Social tab (server mode
  // only; [] when signed out, so no badge in demo mode).
  const { requests } = useFollowRequests();

  // Waitlist + install pitch + api routes get no bottom nav — they're either
  // pre-funnel marketing surfaces or system endpoints. Auth + share are
  // full-screen focus surfaces, and a recipient opening a share link isn't in
  // the app yet.
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
      className="fixed bottom-0 left-0 right-0 z-[1000] bg-bg/95 backdrop-blur border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-[49px] max-w-lg items-stretch">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          const badge = tab.href === '/friends' ? requests.length : 0;
          return (
            <li key={tab.href} className="flex flex-1 min-w-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex w-full flex-col items-center justify-center gap-0.5 px-1 touch-manipulation',
                  'font-nav text-[10px] leading-none transition-colors',
                  active ? 'text-accent' : 'text-muted',
                ].join(' ')}
              >
                <span className="relative">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={active ? 2.2 : 1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                  >
                    {tab.glyph}
                  </svg>
                  {badge > 0 ? (
                    <span
                      aria-label={`${badge} pending follow request${badge === 1 ? '' : 's'}`}
                      className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-bg text-[10px] leading-4 text-center"
                    >
                      {badge > 9 ? '9+' : badge}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
