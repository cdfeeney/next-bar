'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  {
    href: '/',
    label: 'Next Bar?',
    isActive: (pathname) =>
      pathname === '/' || pathname.startsWith('/where-next'),
  },
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
  // pre-funnel marketing surfaces or system endpoints.
  if (
    pathname === '/install' ||
    pathname === '/join' ||
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
      <ul className="flex justify-around items-stretch">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
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
