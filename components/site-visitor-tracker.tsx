'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  isValidVisitorId,
  shouldCountVisitor,
  visitorDay,
  visitorTrackingEnabled,
  VISITOR_DAY_STORAGE_KEY,
  VISITOR_STORAGE_KEY,
} from '@/lib/site-visitors';

export function SiteVisitorTracker() {
  const pathname = usePathname();
  const sending = useRef(false);

  useEffect(() => {
    if (
      !visitorTrackingEnabled(process.env.NODE_ENV) ||
      !shouldCountVisitor(pathname)
    )
      return;
    const recordVisit = async () => {
      if (
        sending.current ||
        document.visibilityState !== 'visible' ||
        navigator.doNotTrack === '1' ||
        navigator.webdriver
      )
        return;

      try {
        const day = visitorDay();
        if (localStorage.getItem(VISITOR_DAY_STORAGE_KEY) === day) return;
        let visitorId = localStorage.getItem(VISITOR_STORAGE_KEY);
        if (!isValidVisitorId(visitorId)) {
          visitorId = crypto.randomUUID();
          localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
        }
        sending.current = true;
        const response = await fetch('/api/visitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId }),
          keepalive: true,
        });
        if (response.ok) localStorage.setItem(VISITOR_DAY_STORAGE_KEY, day);
      } catch {
        // Optional analytics must never interrupt browsing or checkout. If
        // storage is blocked, skip counting rather than invent duplicate IDs.
      } finally {
        sending.current = false;
      }
    };

    void recordVisit();
    document.addEventListener('visibilitychange', recordVisit);
    return () => document.removeEventListener('visibilitychange', recordVisit);
  }, [pathname]);

  return null;
}
