/**
 * The 80px hero tile at the top of an onboarding screen, WITH its glyph.
 *
 * The approved canvas (`docs/design-reference/approved/next-bar-onboarding-v1.png`)
 * draws an accent stroked icon inside the tile — a bookmark on Age confirmation
 * and the Under-21 exit, a map pin on Location and Location denied. The tile
 * shipped empty (owner, staging 2026-09-14: "the icons are blank"). Glyphs are
 * 24-unit stroke paths in the tab bar's style (BottomNav.tsx), scaled to 32px.
 */
export default function OnboardingTile({ glyph }: { glyph: 'bookmark' | 'pin' }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="w-20 h-20 rounded-3xl bg-surface border border-border mx-auto mb-8 flex items-center justify-center text-accent"
    >
      <svg
        viewBox="0 0 24 24"
        width="32"
        height="32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyph === 'bookmark' ? (
          <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Z" />
        ) : (
          <>
            <path d="M12 21s-6-5.2-6-10.5a6 6 0 0 1 12 0C18 15.8 12 21 12 21Z" />
            <circle cx="12" cy="10.5" r="2.2" />
          </>
        )}
      </svg>
    </div>
  );
}
