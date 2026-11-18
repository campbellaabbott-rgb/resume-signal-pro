import { useCallback, useEffect, useRef } from 'react';
import { postTrackEvent } from '@/lib/track-transport';
import { getCohortData, initCohortTracking } from './use-cohort-tracking';
import { analyticsSessionGet, analyticsSessionSet, persistAnalyticsSession } from '@/lib/analytics-session-store';
import { CONSENT_EVENT, analyticsAllowed } from '@/lib/consent';
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

// Get or create session ID for funnel tracking: in this page's memory until
// the visitor allows analytics (src/lib/analytics-session-store.ts).
const getSessionId = (): string => {
  let sessionId = analyticsSessionGet('funnel_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    analyticsSessionSet('funnel_session_id', sessionId);
  }
  return sessionId;
};

// The visitor id is not this hook's to decide: the transport stamps every
// event with the browser's one id (src/lib/track-transport.ts). This file
// used to keep a private copy under a private storage key, so the funnel's
// visitor was never the A/B hook's visitor or the product hook's visitor.

// Get the funnel progress from this session. Guarded: a corrupt/legacy
// funnel_progress value would otherwise throw from JSON.parse, and this runs on
// the landing page (via getFunnelState, which the hook exports) — an unguarded
// throw there white-screens the homepage. Every other storage parse in the app
// is guarded the same way.
const getFunnelProgress = (): FunnelStage[] => {
  try {
    // Analytics state: it only decides whether a purchase is counted, so it is
    // in the page's memory until the visitor allows analytics.
    const stored = analyticsSessionGet('funnel_progress');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

/**
 * Whether this tab reached `stage`. A purchase page uses it to tell the tab
 * that started the checkout from a revisit (the purchase email opened on any
 * device), which is never a second sale.
 */
export const reachedInThisTab = (stage: FunnelStage): boolean => getFunnelProgress().includes(stage);

// Save funnel progress
const saveFunnelProgress = (stages: FunnelStage[]) => {
  analyticsSessionSet('funnel_progress', JSON.stringify(stages));
};

// Calculate time since landing
const getTimeSinceLanding = (): number => {
  const landingTime = analyticsSessionGet('funnel_landing_time');
  if (!landingTime) return 0;
  return Math.round((Date.now() - parseInt(landingTime)) / 1000);
};

// The body one funnel stage sends, as it stands NOW: the page, the referrer,
// the session, the progress and the cohort are read at the moment it is built.
const funnelBody = (stage: FunnelStage, metadata?: Record<string, unknown>) => {
    const sessionId = getSessionId();
    const progress = getFunnelProgress();
    const stageIndex = FUNNEL_STAGES.indexOf(stage);
    const cohortData = getCohortData();
    
    // Calculate drop-off info
    const previousStages = progress.length;
    const expectedPrevious = stageIndex;
    const skippedStages = expectedPrevious - previousStages;
    
    return {
        testName: 'conversion_funnel',
        variant: stage,
        eventType: stage === 'purchase_completed' ? 'conversion' : 'view',
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
    };
};

/** This tab reached `stage`: kept once, in order. */
const markReached = (stage: FunnelStage) => {
  const progress = getFunnelProgress();
  if (!progress.includes(stage)) {
    progress.push(stage);
    saveFunnelProgress(progress);
  }
};

// Track funnel event with cohort context
const trackFunnelEvent = async (
  stage: FunnelStage,
  metadata?: Record<string, unknown>
) => {
  try {
    // Keepalive transport, not a plain client invoke: checkout_started fires
    // milliseconds before window.location.assign(stripe) and plain fetches are
    // cancelled by navigation — this funnel recorded purchases with zero
    // checkout_starts until this was switched.
    const body = funnelBody(stage, metadata);
    postTrackEvent(body);
    markReached(stage);
    console.log(`[Funnel] Stage: ${stage}`, { stageIndex: body.metadata.stageIndex, cohort: body.metadata.trafficSource });
  } catch (error) {
    console.debug('Funnel tracking failed:', error);
  }
};

// ── The landing a visitor saw before they chose (S14X-040) ─────────────────
// The landing is recorded once per tab, and on a first visit it runs before
// the banner is answered, when the transport sends nothing. It used to be
// marked done anyway and never sent, so a visitor who said yes during their
// first visit had no landing row and lost their campaign and referrer. The
// landing is now built when the page lands (its page, referrer and campaign
// as they were then) and held in this page's memory; a yes sends it once,
// after moving what the page held into the tab's storage, and a no drops it.
let heldLanding: ReturnType<typeof funnelBody> | null = null;
let onChoice: ((e: Event) => void) | null = null;

const sendLandingOnYes = (body: ReturnType<typeof funnelBody>) => {
  heldLanding = body;
  if (onChoice) return;
  onChoice = (e: Event) => {
    const choice = (e as CustomEvent<unknown>).detail;
    if (choice !== 'granted' && choice !== 'denied') return;
    if (onChoice) window.removeEventListener(CONSENT_EVENT, onChoice);
    onChoice = null;
    const held = heldLanding;
    heldLanding = null;
    if (choice !== 'granted' || !held) return;
    try {
      persistAnalyticsSession();
      postTrackEvent(held);
    } catch (error) {
      console.debug('Funnel landing after consent failed:', error);
    }
  };
  window.addEventListener(CONSENT_EVENT, onChoice);
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
  if (analyticsSessionGet('funnel_initialized')) return;

  // Initialize cohort tracking first
  initCohortTracking();

  analyticsSessionSet('funnel_initialized', 'true');
  analyticsSessionSet('funnel_landing_time', Date.now().toString());
  
  const cohortData = getCohortData();
  
  const landing = {
    landingPage: window.location.pathname,
    utmSource: cohortData.utmSource,
    utmMedium: cohortData.utmMedium,
    utmCampaign: cohortData.utmCampaign,
    trafficSource: cohortData.trafficSource,
  };
  // Track landing immediately with cohort context; before the visitor chose,
  // the landing as it is now waits for their answer (S14X-040).
  if (analyticsAllowed()) {
    trackFunnelEvent('landing_view', landing);
    return;
  }
  try {
    sendLandingOnYes(funnelBody('landing_view', landing));
    markReached('landing_view');
  } catch (error) {
    console.debug('Funnel tracking failed:', error);
  }
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

  // TWO SOURCES FOR ONE STAGE, decided 2026-09-27. The server now records
  // every Stripe session it mints in checkout_starts (immune to the writer's
  // window, to unload and to any budget), and this client event still exists.
  // They count different things: this is a VISITOR who reached the stage, as
  // every other stage here counts visitors; that is a SESSION minted. The
  // cohort reader keeps counting this event so its stages compare like with
  // like; checkout_starts is the count of sessions, and the paid join. When
  // the reader is next redefined, it may take this stage from checkout_starts
  // joined on visitor_id -- until then the two numbers are not one number.
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
