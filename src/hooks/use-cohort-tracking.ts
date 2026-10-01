import { useCallback, useEffect, useRef } from 'react';
import { postTrackEvent } from '@/lib/track-transport';

// Cohort dimensions for segmentation
export const TRAFFIC_SOURCES = ['organic','paid','social','referral','direct','email'] as const;

export interface CohortData {
  // Traffic source cohorts
  trafficSource: (typeof TRAFFIC_SOURCES)[number];
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

// The visitor id is not this hook's to decide: the transport stamps every
// event with the browser's one id (src/lib/track-transport.ts). This file
// used to keep a private copy under a private storage key.

/* Declared ABOVE its callers, not below them. detectTrafficSource reads this,
 * and a const arrow function referenced before its initialiser runs is a
 * temporal-dead-zone throw — the shape that took ranked search down silently
 * for days. It happens to be safe here because nothing calls the detector
 * during module evaluation; "happens to be" is not the standard this repo
 * holds after that incident. */
const getReferrerDomain = (): string | null => {
  if (!document.referrer) return null;
  try {
    return new URL(document.referrer).hostname;
  } catch {
    return null;
  }
};

/**
 * THE SEARCH BRANCH WAS UNREACHABLE, WHICH IS WHY THIS FUNNEL HAS NEVER SHOWN
 * A SEARCH VISIT.
 *
 * The referral test ran first and returned for ANY external referrer, so the
 * search test below it could never be reached: a visitor arriving from
 * google.com has a referrer that is not our hostname, and left as 'referral'.
 * Checked by running the old order over every engine in its own list — all of
 * them answered 'referral', and no input at all could produce 'organic'. The
 * value existed in the type, in the dashboard and in the cohort reader, and
 * nothing could ever emit it.
 *
 * What that cost: 30 days to 2026-10-01 read 131,336 direct / 22 referral /
 * 15 social and NO organic row, and the 22 is every external referrer there
 * is — search, blogs and all. The one channel that could grow this was not
 * merely small on the dashboard, it was unrepresentable.
 *
 * MATCHED ON THE HOSTNAME, NOT ON A SUBSTRING OF THE URL. The old tests were
 * `referrer.includes('google')` against the whole referrer string, so
 * https://example.com/?q=google read as a Google visit, and
 * `referrer.includes(window.location.hostname)` made
 * https://notresumebooster.work.example.com one of ours. getReferrerDomain()
 * already parses the host properly for referrerDomain; this now uses it.
 */

/** `host` is `name` or a subdomain of it — never a substring of either. */
const hostIs = (host: string, name: string): boolean =>
  host === name || host.endsWith(`.${name}`);
const hostIn = (host: string, names: readonly string[]): boolean =>
  names.some((n) => hostIs(host, n));

const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'twitter.com', 'x.com', 'linkedin.com', 'lnkd.in',
  'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'reddit.com',
  'pinterest.com', 'threads.net', 'bsky.app', 't.co',
] as const;

const SEARCH_HOSTS = [
  'bing.com', 'duckduckgo.com', 'yahoo.com', 'search.yahoo.com', 'baidu.com',
  'yandex.com', 'yandex.ru', 'ecosia.org', 'startpage.com', 'qwant.com',
  'search.brave.com', 'naver.com', 'sogou.com', 'ask.com', 'aol.com',
  'seznam.cz', 'mojeek.com',
] as const;

/* Google needs its own test: it serves search from ~190 ccTLDs (google.co.uk,
 * google.de, …) that no fixed list keeps up with, while several of its
 * subdomains are not search at all and must stay 'referral' rather than be
 * counted as a search visit we did not earn. GB is a first-class market for
 * this board, so reading google.co.uk as a blog link is not a rounding error. */
const GOOGLE_HOST = /(^|\.)google(\.[a-z]{2,3}){1,2}$/;
const GOOGLE_NOT_SEARCH = ['mail', 'docs', 'drive', 'groups', 'news', 'translate', 'sites', 'meet'];
const isGoogleSearch = (host: string): boolean =>
  GOOGLE_HOST.test(host) && !GOOGLE_NOT_SEARCH.includes(host.split('.')[0]);

// Detect traffic source from URL and referrer
export const detectTrafficSource = (): CohortData['trafficSource'] => {
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get('utm_source')?.toLowerCase();
  const utmMedium = params.get('utm_medium')?.toLowerCase();
  const refHost = getReferrerDomain();

  // A campaign the visitor arrived under outranks where they came from: a paid
  // click and an email click both usually carry a referrer too.
  if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid') {
    return 'paid';
  }
  if (utmSource === 'email' || utmMedium === 'email') {
    return 'email';
  }
  if (utmSource && SOCIAL_HOSTS.some((h) => utmSource.includes(h.split('.')[0]))) {
    return 'social';
  }

  // No referrer, or our own pages: nothing external brought them here.
  if (!refHost) return 'direct';
  if (hostIs(refHost, window.location.hostname)) return 'direct';

  // Named sources BEFORE the catch-all, which is the ordering bug this block
  // exists to end. 'referral' means "external, and none of the above" — put it
  // first and every other label becomes unreachable.
  if (hostIn(refHost, SOCIAL_HOSTS)) return 'social';
  if (isGoogleSearch(refHost) || hostIn(refHost, SEARCH_HOSTS)) return 'organic';
  return 'referral';
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
    const sessionId = getCohortSessionId();

    // Through the one transport (keepalive, dev-silenced, one visitor id,
    // pathname-only page fields) — not a bare client invoke around it.
    postTrackEvent({
      testName: 'cohort_analysis',
      variant: cohortData.trafficSource,
      eventType: eventType === 'conversion' ? 'conversion' : 'view',
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
    });
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
