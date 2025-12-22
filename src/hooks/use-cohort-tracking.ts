import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Cohort dimensions for segmentation
export interface CohortData {
  // Traffic source cohorts
  trafficSource: 'organic' | 'paid' | 'social' | 'referral' | 'direct' | 'email';
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerDomain: string | null;
  
  // Device cohorts
  deviceType: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
  
  // Time cohorts
  dayOfWeek: string;
  hourOfDay: number;
  weekNumber: number;
  
  // User cohorts
  isReturningUser: boolean;
  previousScans: number;
  hasEmail: boolean;
  
  // Geographic cohorts (if available)
  country: string | null;
  timezone: string;
  
  // Entry point
  landingPage: string;
}

// Get or create cohort ID for this session
const getCohortSessionId = (): string => {
  const key = 'cohort_session_id';
  let sessionId = sessionStorage.getItem(key);
  
  if (!sessionId) {
    sessionId = `cohort_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem(key, sessionId);
  }
  
  return sessionId;
};

// Get visitor ID (persists across sessions)
const getVisitorId = (): string => {
  const key = 'cohort_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

// Detect traffic source from URL and referrer
const detectTrafficSource = (): CohortData['trafficSource'] => {
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get('utm_source')?.toLowerCase();
  const utmMedium = params.get('utm_medium')?.toLowerCase();
  const referrer = document.referrer;
  
  // Check for paid traffic
  if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid') {
    return 'paid';
  }
  
  // Check for email traffic
  if (utmSource === 'email' || utmMedium === 'email') {
    return 'email';
  }
  
  // Check for social traffic
  const socialDomains = ['facebook', 'twitter', 'linkedin', 'instagram', 'tiktok', 'youtube', 'reddit', 'pinterest'];
  if (utmSource && socialDomains.some(s => utmSource.includes(s))) {
    return 'social';
  }
  if (referrer && socialDomains.some(s => referrer.includes(s))) {
    return 'social';
  }
  
  // Check for referral traffic
  if (referrer && !referrer.includes(window.location.hostname)) {
    return 'referral';
  }
  
  // Check for organic search
  const searchEngines = ['google', 'bing', 'yahoo', 'duckduckgo', 'baidu'];
  if (referrer && searchEngines.some(s => referrer.includes(s))) {
    return 'organic';
  }
  
  // Direct traffic
  return 'direct';
};

// Get device type
const getDeviceType = (): CohortData['deviceType'] => {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
};

// Get browser name
const getBrowser = (): string => {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  if (ua.includes('Opera')) return 'Opera';
  return 'Other';
};

// Get OS name
const getOS = (): string => {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Other';
};

// Get referrer domain
const getReferrerDomain = (): string | null => {
  if (!document.referrer) return null;
  try {
    return new URL(document.referrer).hostname;
  } catch {
    return null;
  }
};

// Get week number
const getWeekNumber = (): number => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 604800000;
  return Math.ceil(diff / oneWeek);
};

// Check if returning user
const isReturningUser = (): boolean => {
  const scanHistory = localStorage.getItem('rb_scan_history');
  if (!scanHistory) return false;
  try {
    const history = JSON.parse(scanHistory);
    return history.totalScans > 0;
  } catch {
    return false;
  }
};

// Get previous scan count
const getPreviousScanCount = (): number => {
  const scanHistory = localStorage.getItem('rb_scan_history');
  if (!scanHistory) return 0;
  try {
    const history = JSON.parse(scanHistory);
    return history.totalScans || 0;
  } catch {
    return 0;
  }
};

// Check if user has email
const hasStoredEmail = (): boolean => {
  const scanHistory = localStorage.getItem('rb_scan_history');
  if (!scanHistory) return false;
  try {
    const history = JSON.parse(scanHistory);
    return !!history.email;
  } catch {
    return false;
  }
};

// Build complete cohort data
const buildCohortData = (): CohortData => {
  const params = new URLSearchParams(window.location.search);
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  return {
    trafficSource: detectTrafficSource(),
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    referrerDomain: getReferrerDomain(),
    deviceType: getDeviceType(),
    browser: getBrowser(),
    os: getOS(),
    dayOfWeek: days[now.getDay()],
    hourOfDay: now.getHours(),
    weekNumber: getWeekNumber(),
    isReturningUser: isReturningUser(),
    previousScans: getPreviousScanCount(),
    hasEmail: hasStoredEmail(),
    country: null, // Would need IP geolocation
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    landingPage: window.location.pathname,
  };
};

// Store cohort data in session
const storeCohortData = (cohortData: CohortData) => {
  sessionStorage.setItem('cohort_data', JSON.stringify(cohortData));
};

// Get stored cohort data
const getStoredCohortData = (): CohortData | null => {
  const stored = sessionStorage.getItem('cohort_data');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

// Track cohort event
const trackCohortEvent = async (
  eventType: string,
  metadata?: Record<string, unknown>
) => {
  try {
    const cohortData = getStoredCohortData() || buildCohortData();
    const visitorId = getVisitorId();
    const sessionId = getCohortSessionId();
    
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName: 'cohort_analysis',
        variant: cohortData.trafficSource,
        eventType: eventType === 'conversion' ? 'conversion' : 'view',
        visitorId,
        metadata: {
          ...metadata,
          sessionId,
          eventType,
          // Flatten cohort data for easier querying
          trafficSource: cohortData.trafficSource,
          utmSource: cohortData.utmSource,
          utmMedium: cohortData.utmMedium,
          utmCampaign: cohortData.utmCampaign,
          referrerDomain: cohortData.referrerDomain,
          deviceType: cohortData.deviceType,
          browser: cohortData.browser,
          os: cohortData.os,
          dayOfWeek: cohortData.dayOfWeek,
          hourOfDay: cohortData.hourOfDay,
          weekNumber: cohortData.weekNumber,
          isReturningUser: cohortData.isReturningUser,
          previousScans: cohortData.previousScans,
          hasEmail: cohortData.hasEmail,
          timezone: cohortData.timezone,
          landingPage: cohortData.landingPage,
        }
      }
    });
    
    console.log(`[Cohort] Tracked: ${eventType}`, { trafficSource: cohortData.trafficSource });
  } catch (error) {
    console.debug('Cohort tracking failed:', error);
  }
};

// Initialize cohort tracking
export const initCohortTracking = () => {
  if (typeof window === 'undefined') return;
  
  // Only initialize once per session
  if (sessionStorage.getItem('cohort_initialized')) return;
  
  const cohortData = buildCohortData();
  storeCohortData(cohortData);
  sessionStorage.setItem('cohort_initialized', 'true');
  
  // Track session start with cohort data
  trackCohortEvent('session_start', {
    timestamp: new Date().toISOString(),
  });
};

// React hook for cohort tracking
export function useCohortTracking() {
  const hasInitialized = useRef(false);
  
  useEffect(() => {
    if (!hasInitialized.current) {
      initCohortTracking();
      hasInitialized.current = true;
    }
  }, []);

  // Get current cohort data
  const getCohortData = useCallback((): CohortData => {
    return getStoredCohortData() || buildCohortData();
  }, []);

  // Track funnel stage with cohort context
  const trackCohortStage = useCallback((
    stage: string,
    metadata?: Record<string, unknown>
  ) => {
    trackCohortEvent(stage, metadata);
  }, []);

  // Get cohort segment string for analytics
  const getCohortSegment = useCallback((): string => {
    const cohort = getCohortData();
    return `${cohort.trafficSource}_${cohort.deviceType}_${cohort.isReturningUser ? 'returning' : 'new'}`;
  }, [getCohortData]);

  // Track conversion with cohort context
  const trackCohortConversion = useCallback((
    productId: string,
    value: number
  ) => {
    trackCohortEvent('conversion', { productId, value });
  }, []);

  return {
    getCohortData,
    trackCohortStage,
    getCohortSegment,
    trackCohortConversion,
  };
}

// Standalone functions for use outside React
export const getCohortData = () => getStoredCohortData() || buildCohortData();
export const trackCohort = trackCohortEvent;
