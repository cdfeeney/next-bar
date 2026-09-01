'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared chrome for the Settings stack (approved/next-bar-account-a-settings.png).
 *
 * The stack is hierarchical, not modal: every screen below the Account root
 * carries a top-left back arrow and no bottom nav, and rows are a familiar
 * grouped list — label left, current value right, chevron. Nothing here is
 * Account-root chrome; the root keeps the five-tab nav and has no back arrow.
 */

const ROW_BASE =
  'w-full flex items-center gap-3 px-4 min-h-[48px] py-3 text-left touch-manipulation';

/**
 * Top-left back arrow + title. `backHref` is always an explicit route: the
 * stack is reachable by deep link, where history.back() has nowhere to go.
 *
 * `onBack` lets a screen with unsaved work intercept the tap (V8-R-ACC-006's
 * failure_recovery). It returns whether to proceed — `false` cancels the
 * navigation and leaves the screen exactly as it was. Screens without unsaved
 * state omit it and keep a plain link.
 */
export function StackHeader({
  title,
  backHref,
  onBack,
}: {
  title: string;
  backHref: string;
  onBack?: () => boolean;
}): JSX.Element {
  return (
    <header className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-border pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
      <div className="max-w-md mx-auto px-4 flex items-center gap-2">
        <Link
          href={backHref}
          aria-label="Back"
          onClick={(event) => {
            if (onBack && !onBack()) event.preventDefault();
          }}
          className="-ml-2 w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full text-text touch-manipulation"
        >
          <ChevronIcon direction="left" />
        </Link>
        <h1 className="font-display text-xl">{title}</h1>
      </div>
    </header>
  );
}

/** One labelled group of rows. The label is the uppercase section caption. */
export function Group({
  label,
  children,
  footnote,
}: {
  label: string;
  children: ReactNode;
  footnote?: ReactNode;
}): JSX.Element {
  return (
    <section>
      <h2 className="font-display text-[11px] uppercase tracking-[0.2em] text-muted mb-2 px-1">
        {label}
      </h2>
      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {children}
      </div>
      {footnote ? (
        <p className="text-xs text-muted leading-relaxed mt-2 px-1">{footnote}</p>
      ) : null}
    </section>
  );
}

/**
 * A navigating row. `value` is the current setting shown on the right, so the
 * grouped list answers "what is this set to?" without opening anything.
 */
export function LinkRow({
  href,
  label,
  value,
  onNavigate,
}: {
  href: string;
  label: string;
  value?: ReactNode;
  /**
   * Same contract as `StackHeader`'s `onBack`: return whether to proceed, and
   * `false` cancels the navigation. A screen with unsaved work has to guard
   * EVERY way off it, not just the back arrow — guarding one exit and leaving
   * the in-page rows as plain links is a discard prompt that is simply absent
   * on the route people actually took.
   */
  onNavigate?: () => boolean;
}): JSX.Element {
  const body = (
    <>
      <span className="text-sm flex-1 min-w-0">{label}</span>
      {value ? (
        <span className="text-xs text-muted truncate max-w-[45%] text-right">
          {value}
        </span>
      ) : null}
      <ChevronIcon direction="right" muted />
    </>
  );
  // mailto: and other non-app targets leave the router entirely — a plain
  // anchor, not a prefetching Link.
  const intercept = onNavigate
    ? (event: { preventDefault: () => void }) => {
        if (!onNavigate()) event.preventDefault();
      }
    : undefined;
  return href.startsWith('/') ? (
    <Link href={href} className={ROW_BASE} onClick={intercept}>
      {body}
    </Link>
  ) : (
    <a href={href} className={ROW_BASE} onClick={intercept}>
      {body}
    </a>
  );
}

/**
 * A row that states a value it cannot yet change.
 *
 * V8 ships a capability-scoped Settings surface: the approved reference draws
 * rows whose persistence does not exist in this repo, and a switch that
 * silently forgets is worse than an honest line of text (V8-R-OPS-001 —
 * "never presents a fallback as a success"). This row names what is true and
 * offers nothing that pretends otherwise.
 */
export function StatusRow({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}): JSX.Element {
  return (
    <div className={`${ROW_BASE} items-start`}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted leading-relaxed mt-1">
          {description}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted text-right">{value}</span>
    </div>
  );
}

/** A row whose whole surface is an action rather than a destination. */
export function ButtonRow({
  label,
  onClick,
  value,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  value?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        ROW_BASE,
        'disabled:opacity-40 disabled:cursor-not-allowed',
        danger ? 'text-red-400' : 'text-text',
      ].join(' ')}
    >
      <span className="text-sm flex-1 min-w-0">{label}</span>
      {value ? <span className="text-xs text-muted">{value}</span> : null}
    </button>
  );
}

/** A row carrying an on/off switch. State is never colour-alone: the switch
 *  reports its value to assistive tech and the helper line spells it out. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  busy = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  busy?: boolean;
}): JSX.Element {
  return (
    <div className={`${ROW_BASE} items-start`}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted leading-relaxed mt-1">
          {description}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={busy}
        onClick={onChange}
        className={[
          'shrink-0 relative w-12 h-7 rounded-full border transition-colors touch-manipulation disabled:opacity-50',
          checked ? 'bg-accent border-accent' : 'bg-bg border-border',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'absolute top-0.5 w-5 h-5 rounded-full transition-all',
            checked ? 'right-0.5 bg-bg' : 'left-0.5 bg-muted',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

/** A row that is only a container — used where a control brings its own UI. */
export function SlotRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-4 py-4 space-y-3">{children}</div>;
}

export function ChevronIcon({
  direction,
  muted = false,
}: {
  direction: 'left' | 'right';
  muted?: boolean;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[
        'w-4 h-4 shrink-0',
        muted ? 'text-muted' : '',
        direction === 'left' ? 'w-6 h-6' : '',
      ].join(' ')}
    >
      <polyline points={direction === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}
