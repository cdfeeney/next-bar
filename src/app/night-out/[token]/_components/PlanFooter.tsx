'use client';

/**
 * README §7 footer: the invite link. Round-2 review (Codex, high) — a plan
 * produced a link the app gave you no way to send; this is where it lives.
 * ("Not tonight" sits in RsvpRow, directly above, for members who can say it.)
 */
export default function PlanFooter({
  shareNotice,
  onCopyInvite,
}: {
  shareNotice: string | null;
  onCopyInvite: () => void;
}): JSX.Element {
  return (
    <footer className="mt-8" data-testid="plan-footer">
      <button
        type="button"
        onClick={onCopyInvite}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-border px-5 text-sm touch-manipulation"
      >
        Copy invite link
      </button>
      {shareNotice !== null ? (
        <p className="mt-2 break-all text-xs text-muted" role="status">
          {shareNotice}
        </p>
      ) : null}
    </footer>
  );
}
