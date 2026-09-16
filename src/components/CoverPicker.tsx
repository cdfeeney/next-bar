'use client';

import { useRef, useState } from 'react';
import Sheet from '@/components/story/Sheet';
import { COVER_TEMPLATES, mediaCoverValue, templateCoverValue } from '@/lib/nightOutCovers';
import { uploadImageThroughBoundary } from '@/lib/media/uploadClient';
import { getBrowserSupabase } from '@/lib/supabase/client';

/**
 * S-06b / S-06c — the cover sheet: "Choose from library" on top, then the six
 * bundled templates in a two-column grid.
 *
 * The library row is a native `<input type="file" accept="image/*">` — on a
 * phone that is the photo library. The file goes through `/api/media/upload`
 * (the one path bytes take to the media bucket); the picker then hands back
 * `media:<id>`, which 0082 taught `set_night_out_cover`, `media_read_window`
 * and the sweeps to understand. A refused or failed upload says so in the
 * sheet and leaves the current cover untouched — never a dead end.
 */
export default function CoverPicker({
  value,
  onPick,
  onClose,
}: {
  /** The current `cover` value, or null. */
  value: string | null;
  /** Called with the new value (or null to clear); the caller closes the sheet. */
  onPick: (cover: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const chooseFromLibrary = async (file: File | undefined): Promise<void> => {
    if (!file || uploading) return;
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setUploadError("That photo didn't upload — try again in a moment.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    const result = await uploadImageThroughBoundary(supabase, file);
    setUploading(false);
    if (result.kind === 'ok') {
      onPick(mediaCoverValue(result.mediaId));
      return;
    }
    setUploadError(
      result.kind === 'too_large'
        ? 'That photo is too large to upload. Try a smaller one.'
        : "That photo didn't upload — try again in a moment.",
    );
  };

  return (
    <Sheet label="Cover photo" testId="cover-picker" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        Pick a cover for the invite. You can change it until the plan is locked.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        data-testid="cover-library-input"
        aria-label="Choose a cover from your photo library"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file again re-fires the change event.
          event.target.value = '';
          void chooseFromLibrary(file);
        }}
      />
      <button
        type="button"
        data-testid="cover-choose-library"
        aria-pressed={value !== null && value.startsWith('media:')}
        disabled={uploading}
        onClick={() => fileInput.current?.click()}
        className={[
          'mb-3 flex w-full min-h-[44px] items-center justify-between rounded-full border px-4 text-sm touch-manipulation disabled:opacity-60',
          value !== null && value.startsWith('media:') ? 'border-accent ring-2 ring-accent/40' : 'border-border',
        ].join(' ')}
      >
        <span>{uploading ? 'Uploading…' : 'Choose from library'}</span>
        <span aria-hidden="true" className="text-muted">›</span>
      </button>
      {uploadError !== null ? (
        <p className="mb-3 text-sm text-red-400" role="status" data-testid="cover-library-error">
          {uploadError}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Cover templates">
        {COVER_TEMPLATES.map((t) => {
          const on = value === templateCoverValue(t.key);
          return (
            <button
              type="button"
              key={t.key}
              aria-pressed={on}
              aria-label={`${t.label} cover`}
              data-testid={`cover-template-${t.key}`}
              disabled={uploading}
              onClick={() => onPick(templateCoverValue(t.key))}
              className={[
                'relative aspect-[8/5] min-h-[44px] overflow-hidden rounded-2xl border text-left touch-manipulation',
                on ? 'border-accent ring-2 ring-accent/40' : 'border-border',
              ].join(' ')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute bottom-2 left-2 rounded-full bg-text/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-bg">
                {t.label}
              </span>
              {on ? (
                <span aria-hidden="true" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-bg">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {value !== null ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={uploading}
          className="mt-4 w-full min-h-[44px] rounded-full border border-border text-sm text-muted touch-manipulation"
        >
          Remove the cover
        </button>
      ) : null}
    </Sheet>
  );
}
