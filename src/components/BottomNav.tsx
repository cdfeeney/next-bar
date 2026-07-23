'use client';

import Link from 'next/link';
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
    label: 'Friends',
    isActive: (pathname) =>
      pathname.startsWith('/friends') || pathname.startsWith('/u/'),
  },
  {
    href: '/settings',
    label: 'Settings',
    isActive: (pathname) => pathname.startsWith('/settings'),
  },
];

export default function BottomNav(): JSX.Element | null {
  const pathname = usePathname();

  // Waitlist + install pitch + api routes get no bottom nav — they're either
  // pre-funnel marketing surfaces or system endpoints. Auth + share are
  // full-screen focus surfaces: the raised center pill overlaps the form on
  // phone viewports, and a recipient opening a share link isn't in the app yet.
  if (
    pathname === '/install' ||
    pathname === '/join' ||
    pathname === '/auth' ||
    pathname.startsWith('/share') ||
    pathname.startsWith('/api')
  ) {
    return null;
  }

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-[1000] bg-bg/95 backdrop-blur border-t border-border pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <ul className="flex justify-around items-end">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);

          if (tab.primary) {
            return (
              <li key={tab.href} className="flex">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex flex-col items-center justify-center text-center touch-manipulation',
                    'min-h-[60px] min-w-[84px] -mt-7 px-6 py-3 rounded-full',
                    'font-display text-[13px] uppercase tracking-wider',
                    'transition-all active:scale-95',
                    // Accent fill only when it IS the current page — otherwise
                    // a quieter raised pill, so it stops reading as
                    // permanently selected.
                    active
                      ? 'bg-accent text-bg shadow-lg shadow-accent/40 ring-2 ring-accent/50 ring-offset-2 ring-offset-bg'
                      : 'bg-surface text-accent border border-accent/50 shadow-lg shadow-black/40',
                  ].join(' ')}
                >
                  {tab.label}
                </Link>
              </li>
            );
          }

          return (
            <li key={tab.href} className="flex">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[56px] px-2 py-1 touch-manipulation rounded-lg font-display text-[11px] uppercase tracking-wider transition-colors text-center',
                  active ? 'text-accent' : 'text-muted',
                ].join(' ')}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
