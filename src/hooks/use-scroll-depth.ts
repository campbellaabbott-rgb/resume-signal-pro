import { useEffect, useRef } from 'react';
import { postTrackEvent } from '@/lib/track-transport';

const SCROLL_MILESTONES = [0, 25, 50, 75, 90, 100] as const;

type ScrollMilestone = typeof SCROLL_MILESTONES[number];

// The visitor id is not this hook's to decide: the transport stamps every
// event with the browser's one id (src/lib/track-transport.ts). This file
// used to keep a private copy under a private storage key.

export function useScrollDepth(pageName: string = 'home') {
  const trackedMilestones = useRef<Set<ScrollMilestone>>(new Set());
  const sessionKey = `scroll_tracked_${pageName}_${new Date().toDateString()}`;

  useEffect(() => {
    // Load already tracked milestones for this session
    const tracked = sessionStorage.getItem(sessionKey);
    if (tracked) {
      // Guarded: a corrupt/legacy value would otherwise throw synchronously
      // inside this effect and can take the page down. Start fresh instead —
      // every other storage parse in the app is guarded the same way.
      try {
        trackedMilestones.current = new Set(JSON.parse(tracked) as ScrollMilestone[]);
      } catch {
        trackedMilestones.current = new Set();
      }
    }

    const trackMilestone = (milestone: ScrollMilestone) => {
      if (trackedMilestones.current.has(milestone)) return;

      trackedMilestones.current.add(milestone);
      sessionStorage.setItem(sessionKey, JSON.stringify([...trackedMilestones.current]));

      // Through the one transport (keepalive, dev-silenced, one visitor id,
      // pathname-only page fields) — not a bare client invoke around it.
      postTrackEvent({
        testName: 'scroll_depth',
        variant: `${milestone}%`,
        eventType: 'view',
        metadata: {
          page: pageName,
          milestone,
          timestamp: new Date().toISOString(),
          referrer: document.referrer || 'direct',
        }
      });
    };

    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;

      const scrollPercent = Math.round((window.scrollY / scrollHeight) * 100);

      for (const milestone of SCROLL_MILESTONES) {
        if (scrollPercent >= milestone && !trackedMilestones.current.has(milestone)) {
          trackMilestone(milestone);
        }
      }
    };

    // Debounce scroll handler
    let ticking = false;
    const debouncedScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Always record a baseline "0%" view so the funnel has a starting point
    trackMilestone(0);

    window.addEventListener('scroll', debouncedScroll, { passive: true });

    // Track initial position (for short pages or already scrolled)
    handleScroll();

    return () => {
      window.removeEventListener('scroll', debouncedScroll);
    };
  }, [pageName, sessionKey]);

  return {
    getMilestones: () => [...trackedMilestones.current],
  };
}
