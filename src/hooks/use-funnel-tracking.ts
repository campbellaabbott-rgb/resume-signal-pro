import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCohortData, initCohortTracking } from './use-cohort-tracking';
// Funnel stages in order
export const FUNNEL_STAGES = [
  'landing_view',
  'upload_started',
  'upload_completed',
  'scan_started',
  'scan_completed',
  'results_viewed',
  'product_clicked',
  'checkout_started',
  'purchase_completed',
] as const;

export type FunnelStage = typeof FUNNEL_STAGES[number];

// Get or create session ID for funnel tracking
const getSessionId = (): string => {
  const key = 'funnel_session_id';
  let sessionId = sessionStorage.getItem(key);
  
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem(key, sessionId);
  }
  
  return sessionId;
};

// Get or create visitor ID (persists across sessions)
const getVisitorId = (): string => {
  const key = 'funnel_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

// Get the funnel progress from this session
const getFunnelProgress = (): FunnelStage[] => {
  const stored = sessionStorage.getItem('funnel_progress');
  return stored ? JSON.parse(stored) : [];
};

// Save funnel progress
const saveFunnelProgress = (stages: FunnelStage[]) => {
  sessionStorage.setItem('funnel_progress', JSON.stringify(stages));
};

// Calculate time since landing
const getTimeSinceLanding = (): number => {
  const landingTime = sessionStorage.getItem('funnel_landing_time');
  if (!landingTime) return 0;
  return Math.round((Date.now() - parseInt(landingTime)) / 1000);
};

// Track funnel event with cohort context
const trackFunnelEvent = async (
  stage: FunnelStage,
  metadata?: Record<string, unknown>
) => {
  try {
    const visitorId = getVisitorId();
    const sessionId = getSessionId();
    const progress = getFunnelProgress();
    const stageIndex = FUNNEL_STAGES.indexOf(stage);
    const cohortData = getCohortData();
    
    // Calculate drop-off info
    const previousStages = progress.length;
    const expectedPrevious = stageIndex;
    const skippedStages = expectedPrevious - previousStages;
    
    // Track the event with cohort context
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName: 'conversion_funnel',
        variant: stage,
        eventType: stage === 'purchase_completed' ? 'conversion' : 'view',
        visitorId,
        metadata: {
          ...metadata,
          sessionId,
          stageIndex,
          timeSinceLanding: getTimeSinceLanding(),
          previousStages,
          skippedStages,
          isSequential: skippedStages === 0,
          deviceType: getDeviceType(),
          referrer: document.referrer || 'direct',
          page: window.location.pathname,
          // Cohort dimensions for segmentation
          trafficSource: cohortData.trafficSource,
          utmSource: cohortData.utmSource,
          utmMedium: cohortData.utmMedium,
          utmCampaign: cohortData.utmCampaign,
          browser: cohortData.browser,
          os: cohortData.os,
          dayOfWeek: cohortData.dayOfWeek,
          hourOfDay: cohortData.hourOfDay,
          isReturningUser: cohortData.isReturningUser,
          cohortSegment: `${cohortData.trafficSource}_${cohortData.deviceType}_${cohortData.isReturningUser ? 'returning' : 'new'}`,
        }
      }
    });
    
    // Update progress (only add if not already tracked)
    if (!progress.includes(stage)) {
      progress.push(stage);
      saveFunnelProgress(progress);
    }
    
    console.log(`[Funnel] Stage: ${stage}`, { stageIndex, cohort: cohortData.trafficSource });
  } catch (error) {
    console.debug('Funnel tracking failed:', error);
  }
};

// Get device type for segmentation
const getDeviceType = (): 'mobile' | 'tablet' | 'desktop' => {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
};

// Initialize landing tracking with cohort data
export const initFunnelTracking = () => {
  if (typeof window === 'undefined') return;
  
  // Only initialize once per session
  if (sessionStorage.getItem('funnel_initialized')) return;
  
  // Initialize cohort tracking first
  initCohortTracking();
  
  sessionStorage.setItem('funnel_initialized', 'true');
  sessionStorage.setItem('funnel_landing_time', Date.now().toString());
  
  const cohortData = getCohortData();
  
  // Track landing immediately with cohort context
  trackFunnelEvent('landing_view', {
    landingPage: window.location.pathname,
    utmSource: cohortData.utmSource,
    utmMedium: cohortData.utmMedium,
    utmCampaign: cohortData.utmCampaign,
    trafficSource: cohortData.trafficSource,
  });
};

// React hook for funnel tracking
export function useFunnelTracking() {
  const trackedStages = useRef<Set<FunnelStage>>(new Set());
  
  // Initialize on mount
  useEffect(() => {
    initFunnelTracking();
  }, []);

  // Track a stage (prevents duplicates within component lifecycle)
  const trackStage = useCallback((stage: FunnelStage, metadata?: Record<string, unknown>) => {
    if (trackedStages.current.has(stage)) return;
    trackedStages.current.add(stage);
    trackFunnelEvent(stage, metadata);
  }, []);

  // Convenience methods for each stage
  const trackLandingView = useCallback(() => {
    trackStage('landing_view');
  }, [trackStage]);

  const trackUploadStarted = useCallback((fileType?: string) => {
    trackStage('upload_started', { fileType });
  }, [trackStage]);

  const trackUploadCompleted = useCallback((fileSize?: number, parseTime?: number) => {
    trackStage('upload_completed', { fileSize, parseTime });
  }, [trackStage]);

  const trackScanStarted = useCallback((industry?: string) => {
    trackStage('scan_started', { industry });
  }, [trackStage]);

  const trackScanCompleted = useCallback((score: number, industry?: string) => {
    trackStage('scan_completed', { score, industry });
  }, [trackStage]);

  const trackResultsViewed = useCallback((score: number, scrollDepth?: number) => {
    trackStage('results_viewed', { score, scrollDepth });
  }, [trackStage]);

  const trackProductClicked = useCallback((productId: string, productName: string, price?: number) => {
    trackStage('product_clicked', { productId, productName, price });
  }, [trackStage]);

  const trackCheckoutStarted = useCallback((productId: string, price: number) => {
    trackStage('checkout_started', { productId, price });
  }, [trackStage]);

  const trackPurchaseCompleted = useCallback((productId: string, price: number, sessionId?: string) => {
    trackStage('purchase_completed', { productId, price, stripeSessionId: sessionId });
  }, [trackStage]);

  // Get current funnel state
  const getFunnelState = useCallback(() => {
    const progress = getFunnelProgress();
    const lastStage = progress[progress.length - 1] || null;
    const lastStageIndex = lastStage ? FUNNEL_STAGES.indexOf(lastStage) : -1;
    
    return {
      progress,
      lastStage,
      lastStageIndex,
      stagesCompleted: progress.length,
      totalStages: FUNNEL_STAGES.length,
      completionRate: (progress.length / FUNNEL_STAGES.length) * 100,
      timeSinceLanding: getTimeSinceLanding(),
    };
  }, []);

  return {
    // Individual tracking methods
    trackLandingView,
    trackUploadStarted,
    trackUploadCompleted,
    trackScanStarted,
    trackScanCompleted,
    trackResultsViewed,
    trackProductClicked,
    trackCheckoutStarted,
    trackPurchaseCompleted,
    // Generic tracking
    trackStage,
    // State
    getFunnelState,
  };
}

// Standalone function for use outside React
export const trackFunnel = trackFunnelEvent;
