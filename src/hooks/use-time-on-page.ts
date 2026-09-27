import { useEffect, useRef } from 'react';
import { postTrackEvent } from '@/lib/track-transport';

const TIME_MILESTONES = [0, 30, 60, 120, 300, 600] as const; // seconds: 0s, 30s, 1m, 2m, 5m, 10m

type TimeMilestone = typeof TIME_MILESTONES[number];

// The visitor id is not this hook's to decide: the transport stamps every
// event with the browser's one id (src/lib/track-transport.ts). This file
// used to keep a private copy under a private storage key.

const formatMilestone = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
};

export function useTimeOnPage(pageName: string = 'home') {
  const startTime = useRef<number>(Date.now());
  const trackedMilestones = useRef<Set<TimeMilestone>>(new Set());
  const intervalRef = useRef<number | null>(null);
  const sessionKey = `time_tracked_${pageName}_${new Date().toDateString()}`;

  useEffect(() => {
    startTime.current = Date.now();

    // Load already tracked milestones for this session
    const tracked = sessionStorage.getItem(sessionKey);
    if (tracked) {
      // Guarded: a corrupt/legacy value would otherwise throw synchronously
      // inside this effect and can take the page down. Start fresh instead —
      // every other storage parse in the app is guarded the same way.
      try {
        trackedMilestones.current = new Set(JSON.parse(tracked) as TimeMilestone[]);
      } catch {
        trackedMilestones.current = new Set();
      }
    }

    const trackMilestone = (milestone: TimeMilestone) => {
      if (trackedMilestones.current.has(milestone)) return;

      trackedMilestones.current.add(milestone);
      sessionStorage.setItem(sessionKey, JSON.stringify([...trackedMilestones.current]));

      // Through the one transport (keepalive, dev-silenced, one visitor id,
      // pathname-only page fields) — not a bare client invoke around it.
      postTrackEvent({
        testName: 'time_on_page',
        variant: formatMilestone(milestone),
        eventType: 'view',
        metadata: {
          page: pageName,
          seconds: milestone,
          timestamp: new Date().toISOString(),
          referrer: document.referrer || 'direct',
        }
      });
    };

    // Always record a baseline "0s" view so the funnel has a starting point
    trackMilestone(0);

    const checkMilestones = () => {
      const elapsedSeconds = Math.floor((Date.now() - startTime.current) / 1000);

      for (const milestone of TIME_MILESTONES) {
        if (elapsedSeconds >= milestone && !trackedMilestones.current.has(milestone)) {
          trackMilestone(milestone);
        }
      }
    };

    // Check every 5 seconds
    intervalRef.current = window.setInterval(checkMilestones, 5000);

    // Handle visibility change (pause when tab hidden)
    let hiddenTime = 0;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenTime = Date.now();
      } else if (hiddenTime > 0) {
        // Adjust start time to exclude hidden duration
        startTime.current += Date.now() - hiddenTime;
        hiddenTime = 0;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pageName, sessionKey]);

  return {
    getElapsedSeconds: () => Math.floor((Date.now() - startTime.current) / 1000),
    getMilestones: () => [...trackedMilestones.current],
  };
}
