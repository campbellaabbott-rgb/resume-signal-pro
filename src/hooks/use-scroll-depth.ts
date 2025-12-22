import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

const SCROLL_MILESTONES = [25, 50, 75, 90, 100] as const;

type ScrollMilestone = typeof SCROLL_MILESTONES[number];

const getVisitorId = (): string => {
  const key = 'scroll_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

export function useScrollDepth(pageName: string = 'home') {
  const trackedMilestones = useRef<Set<ScrollMilestone>>(new Set());
  const sessionKey = `scroll_tracked_${pageName}_${new Date().toDateString()}`;

  useEffect(() => {
    // Load already tracked milestones for this session
    const tracked = sessionStorage.getItem(sessionKey);
    if (tracked) {
      trackedMilestones.current = new Set(JSON.parse(tracked) as ScrollMilestone[]);
    }

    const trackMilestone = async (milestone: ScrollMilestone) => {
      if (trackedMilestones.current.has(milestone)) return;
      
      trackedMilestones.current.add(milestone);
      sessionStorage.setItem(sessionKey, JSON.stringify([...trackedMilestones.current]));

      try {
        await supabase.functions.invoke('track-ab-event', {
          body: {
            testName: 'scroll_depth',
            variant: `${milestone}%`,
            eventType: 'view',
            visitorId: getVisitorId(),
            metadata: {
              page: pageName,
              milestone,
              timestamp: new Date().toISOString(),
              referrer: document.referrer || 'direct',
            }
          }
        });
        console.log(`[Scroll Depth] Tracked ${milestone}% on ${pageName}`);
      } catch (error) {
        console.error('Failed to track scroll depth:', error);
      }
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
