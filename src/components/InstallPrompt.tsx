'use client';

import { useEffect, useRef, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Platform = 'ios-safari' | 'installable' | 'standalone' | 'other';

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'other';

  // Already installed — running in standalone display mode.
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari sets this non-standard flag when launched from home screen.
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (isStandalone) return 'standalone';

  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (isIOS && isSafari) return 'ios-safari';

  return 'other';
}

export default function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>('other');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSheet, setShowIosSheet] = useState(false);
  const gotItRef = useRef<HTMLButtonElement | null>(null);

  // Dialog keyboard contract (g-43d6da5f crit 5, santa: Codex + Claude
  // convergent): while the sheet is open, focus moves to its action,
  // Escape closes it, and closing returns focus to whatever opened it —
  // the same opener-capture pattern BarLightbox uses.
  useEffect(() => {
    if (!showIosSheet) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    gotItRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setShowIosSheet(false);
        return;
      }
      // aria-modal must not promise inertness the DOM doesn't deliver
      // (santa: GLM). With exactly ONE focusable element the complete
      // trap is one line: Tab in any direction stays on the action.
      if (event.key === 'Tab') {
        event.preventDefault();
        gotItRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [showIosSheet]);

  useEffect(() => {
    setPlatform(detectPlatform());

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setPlatform('installable');
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setPlatform('standalone');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (platform === 'standalone') return null;

  // Server-rendered fallback + non-installable browsers (desktop, Firefox iOS,
  // Android Chrome before the install prompt fires) — render nothing rather
  // than misleading UX.
  if (platform === 'other') return null;

  if (platform === 'ios-safari') {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIosSheet(true)}
          className="min-h-[44px] touch-manipulation bg-text text-bg hover:bg-accent transition-colors font-display text-base px-6 py-3 rounded-2xl inline-flex items-center gap-2"
        >
          Install on iPhone
        </button>
        {showIosSheet ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Install on iPhone"
            // z-[1100] = the app's modal tier (QuickAddBar, BarLightbox).
            // The old z-[60] sat UNDER the z-[1000] BottomNav, which painted
            // over this bottom sheet's lower edge and intercepted the
            // "Got it" tap (g-43d6da5f crit 1; pinned by install-sheet e2e).
            className="fixed inset-0 z-[1100] flex items-end md:items-center justify-center bg-bg/80 backdrop-blur"
            onClick={() => setShowIosSheet(false)}
          >
            <div
              className="bg-surface border-t md:border border-border md:rounded-3xl w-full md:max-w-md p-6 md:p-8 m-0 md:m-6"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-accent uppercase tracking-widest text-xs mb-3">
                Three steps
              </p>
              <h2 className="font-display text-2xl mb-5 leading-tight">
                Add Next Bar to your home screen
              </h2>
              <ol className="space-y-3 text-sm leading-relaxed">
                <li>
                  <span className="font-display text-accent mr-2">1.</span>
                  Tap the <strong>Share</strong> button in Safari (the square
                  with an arrow pointing up).
                </li>
                <li>
                  <span className="font-display text-accent mr-2">2.</span>
                  Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
                </li>
                <li>
                  <span className="font-display text-accent mr-2">3.</span>
                  Tap <strong>Add</strong> in the top right. Next Bar lives
                  with your other apps now.
                </li>
              </ol>
              <button
                type="button"
                ref={gotItRef}
                onClick={() => setShowIosSheet(false)}
                className="mt-6 w-full min-h-[44px] touch-manipulation bg-bg border border-border text-text font-display text-sm py-3 rounded-2xl"
              >
                Got it
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  // platform === 'installable' (Android Chrome / desktop Chrome with prompt)
  return (
    <button
      type="button"
      onClick={handleAndroidInstall}
      className="min-h-[44px] touch-manipulation bg-text text-bg hover:bg-accent transition-colors font-display text-base px-6 py-3 rounded-2xl inline-flex items-center gap-2"
    >
      Install Next Bar
    </button>
  );
}
