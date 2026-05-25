'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Only register in production. Dev mode generates fresh chunks per reload
    // and a stale SW cache will fight Next.js HMR.
    if (process.env.NODE_ENV !== 'production') return;

    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Swallow — failed SW registration is non-fatal. The app still works.
      });
    };

    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
