/**
 * Stroke glyph paths on a 24x24 grid, shared between surfaces so one person
 * icon means "person" everywhere (T-01b: the compose People row uses the
 * Account tab's glyph, per the owner).
 */
export function PersonGlyphPaths(): JSX.Element {
  return (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </>
  );
}

export function MartiniGlyphPaths(): JSX.Element {
  return (
    <>
      <path d="M4 4h16l-8 9-8-9Z" />
      <path d="M12 13v7" />
      <path d="M8 20h8" />
    </>
  );
}

/** The svg shell the tab bar uses, for glyphs that render outside it. */
export function Glyph({
  children,
  className = 'h-5 w-5',
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}
