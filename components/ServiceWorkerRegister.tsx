'use client';
// components/ServiceWorkerRegister.tsx
// Registers the service worker after hydration — avoids dangerouslySetInnerHTML
// in layout.tsx which causes hydration mismatches.

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null; // renders nothing
}
