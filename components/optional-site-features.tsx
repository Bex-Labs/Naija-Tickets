'use client';

import { useEffect, useState, type ComponentType } from 'react';

export function OptionalSiteFeatures() {
  const [Tracker, setTracker] = useState<ComponentType | null>(null);

  useEffect(() => {
    let mounted = true;

    // Optional analytics may be blocked by the browser or fail to download.
    // Load outside React.lazy so that failure cannot replace the whole page.
    void import('./site-visitor-tracker')
      .then(({ SiteVisitorTracker }) => {
        if (mounted) setTracker(() => SiteVisitorTracker);
      })
      .catch(() => {
        // Respect blocked analytics and continue without visitor counting.
      });

    return () => {
      mounted = false;
    };
  }, []);

  return Tracker ? <Tracker /> : null;
}
