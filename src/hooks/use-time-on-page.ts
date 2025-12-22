import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

const TIME_MILESTONES = [0, 30, 60, 120, 300, 600] as const; // seconds: 0s, 30s, 1m, 2m, 5m, 10m

type TimeMilestone = typeof TIME_MILESTONES[number];

const getVisitorId = (): string => {
  const key = 'time_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

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
      trackedMilestones.current = new Set(JSON.parse(tracked) as TimeMilestone[]);
    }

    const trackMilestone = async (milestone: TimeMilestone) => {
      if (trackedMilestones.current.has(milestone)) return;
      
      trackedMilestones.current.add(milestone);
      sessionStorage.setItem(sessionKey, JSON.stringify([...trackedMilestones.current]));

      try {
        await supabase.functions.invoke('track-ab-event', {
          body: {
            testName: 'time_on_page',
            variant: formatMilestone(milestone),
            eventType: 'view',
            visitorId: getVisitorId(),
            metadata: {
              page: pageName,
              seconds: milestone,
              timestamp: new Date().toISOString(),
              referrer: document.referrer || 'direct',
            }
          }
        });
        console.log(`[Time on Page] Tracked ${formatMilestone(milestone)} on ${pageName}`);
      } catch (error) {
        console.error('Failed to track time on page:', error);
      }
    };

    // Always record a baseline "0s" view so the funnel has a starting point
    void trackMilestone(0);

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
