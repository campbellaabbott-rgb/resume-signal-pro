import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CONSENT_EVENT, analyticsAllowed } from '@/lib/consent';

interface AffiliateSession {
  affiliateId: string;
  email: string;
  referralCode: string;
  sessionToken: string;
}

// The fields marked optional arrive with the bug round's affiliate
// migrations (20261112120000, 20261112122000); until they apply the page
// reads the dashboard as main answers it.
export interface AffiliateStats {
  total_clicks: number;
  total_conversions: number;
  total_revenue: number;
  pending_payout: number;
  paid_out: number;
  conversion_rate: number;
  /** Sale totals per ISO currency (lower case); 'unknown' for a sale whose currency was not recorded. */
  revenue_by_currency?: Record<string, number>;
  /** Commission earned and not yet payable: pending, or held for review. */
  awaiting_approval?: number;
  awaiting_approval_count?: number;
}

/** One of the period selector's ranges (7, 30, 90, 365 days). */
export interface AffiliateRangeStats {
  clicks: number;
  conversions: number;
  earning_conversions: number;
  commission: number;
  revenue_by_currency: Record<string, number>;
}

export interface AffiliatePayoutRequestRow {
  id?: string;
  status: 'requested' | 'paid' | 'rejected' | string;
  amount_cents: number;
  requested_at: string;
  resolved_at: string | null;
}

interface AffiliateInfo {
  id: string;
  email: string;
  referral_code: string;
  commission_amount: number;
  status: string;
  created_at: string;
  email_confirmed?: boolean;
}

export interface AffiliateConversion {
  id: string;
  product_name: string;
  sale_amount: number;
  commission_amount: number;
  status: string;
  created_at: string;
  currency?: string | null;
  held_for_review?: boolean;
}

export interface DashboardData {
  affiliate: AffiliateInfo;
  stats: AffiliateStats;
  recent_conversions: AffiliateConversion[];
  stats_by_range?: Record<string, AffiliateRangeStats>;
  payout_requests?: AffiliatePayoutRequestRow[];
}

const SESSION_KEY = 'affiliate_session';
const REFERRAL_STORAGE_KEY = 'affiliate_ref';
const REFERRAL_EXPIRY_DAYS = 30;

// Cookie utilities for fallback storage
function setCookie(name: string, value: string, days: number): void {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}

export function useAffiliateAuth() {
  const [session, setSession] = useState<AffiliateSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);

  // Load session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSession(parsed);
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.rpc('register_affiliate', {
      p_email: email,
      p_password: password,
    });

    if (error) {
      throw new Error(error.message);
    }

    const result = data as {
      success: boolean;
      error?: string;
      affiliate_id: string;
      referral_code: string;
      session_token: string;
    };

    // A refusal after the server has counted the attempt comes back as
    // {success: false, error}, not as an RPC error: an exception would roll
    // the attempt count back with it (migration 20261004110000).
    if (!result.success) {
      throw new Error(result.error || 'Registration failed');
    }

    const newSession: AffiliateSession = {
      affiliateId: result.affiliate_id,
      email,
      referralCode: result.referral_code,
      sessionToken: result.session_token,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setSession(newSession);
    return newSession;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.rpc('login_affiliate', {
      p_email: email,
      p_password: password,
    });

    if (error) {
      throw new Error(error.message);
    }

    const result = data as {
      success: boolean;
      error?: string;
      affiliate_id: string;
      email: string;
      referral_code: string;
      session_token: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Login failed');
    }

    const newSession: AffiliateSession = {
      affiliateId: result.affiliate_id,
      email: result.email,
      referralCode: result.referral_code,
      sessionToken: result.session_token,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setSession(newSession);
    return newSession;
  }, []);

  const logout = useCallback(async () => {
    if (session?.sessionToken) {
      await supabase.rpc('logout_affiliate', {
        p_session_token: session.sessionToken,
      });
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setDashboardData(null);
  }, [session]);

  const fetchDashboard = useCallback(async () => {
    if (!session?.sessionToken) {
      throw new Error('Not logged in');
    }

    const { data, error } = await supabase.rpc('get_affiliate_dashboard', {
      p_session_token: session.sessionToken,
    });

    if (error) {
      // Session might be expired
      if (error.message.includes('Invalid or expired session')) {
        await logout();
      }
      throw new Error(error.message);
    }

    const dashboardResult = data as unknown as DashboardData;
    setDashboardData(dashboardResult);
    return dashboardResult;
  }, [session, logout]);

  const getReferralLink = useCallback(() => {
    if (!session?.referralCode) return null;
    const baseUrl = window.location.origin;
    return `${baseUrl}?ref=${session.referralCode}`;
  }, [session]);

  return {
    session,
    isLoading,
    isAuthenticated: !!session,
    dashboardData,
    register,
    login,
    logout,
    fetchDashboard,
    getReferralLink,
  };
}

/**
 * A REFERRAL IS STORED AND ITS CLICK LOGGED ONLY AFTER THE VISITOR ALLOWS
 * ANALYTICS (hotfix H6; sweep M-S14-021, C-S14-009).
 *
 * An affiliate link (/?ref=CODE, and /r/CODE, which sends the browser there)
 * used to write a 30-day cookie and a localStorage entry and log the click
 * (user agent, referrer, an address hash) on the first render, before the
 * analytics banner was answered: the consent gate of S12-011 never covered
 * this hook. Now the code is held in this page's memory, which stores nothing
 * on the device, until analyticsAllowed() is true. A visitor who allows
 * analytics later in the same visit, on any page, still counts: the consent
 * event releases the held code then. A "No thanks" stores and logs nothing,
 * and a later yes from the Privacy page's control still releases it.
 */
let heldReferralCode: string | null = null;
let waitingForConsent = false;

/** The referral as it was always recorded: storage, cookie, one click row. */
function recordReferral(refCode: string): void {
  // Store referral code in both localStorage and cookie for redundancy
  const expiryTimestamp = Date.now() + (REFERRAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const storageData = JSON.stringify({ code: refCode, expires: expiryTimestamp });

  try {
    localStorage.setItem(REFERRAL_STORAGE_KEY, storageData);
  } catch {
    // Blocked storage: the cookie below still carries it
  }
  setCookie(REFERRAL_STORAGE_KEY, storageData, REFERRAL_EXPIRY_DAYS);

  // Log the click (fire-and-forget). No visitor hash from the page: the
  // server keys the platform's address itself (S14X-021, 20261112121000).
  (async () => {
    try {
      await supabase.rpc('track_affiliate_click', {
        p_referral_code: refCode,
        p_user_agent: navigator.userAgent.slice(0, 200), // Limit length
        p_referrer: document.referrer?.slice(0, 500) || null,
      });
    } catch {
      // Silently fail - don't affect user experience
      console.debug('Affiliate click tracking failed');
    }
  })();
}

function stopWaitingForConsent(): void {
  if (!waitingForConsent) return;
  waitingForConsent = false;
  window.removeEventListener(CONSENT_EVENT, releaseHeldReferral);
}

/** Record the held code once analytics are allowed; until then, keep waiting. */
function releaseHeldReferral(): void {
  if (!heldReferralCode) {
    stopWaitingForConsent();
    return;
  }
  if (!analyticsAllowed()) {
    if (!waitingForConsent) {
      waitingForConsent = true;
      window.addEventListener(CONSENT_EVENT, releaseHeldReferral);
      console.debug('Affiliate referral held until analytics are allowed');
    }
    return;
  }
  const code = heldReferralCode;
  heldReferralCode = null;
  stopWaitingForConsent();
  recordReferral(code);
}

// Hook to track referral clicks and store referral code, once allowed
export function useAffiliateTracking() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');

    if (refCode) {
      heldReferralCode = refCode;
      releaseHeldReferral();
    }
  }, []);
}

// Get stored referral code for checkout (checks both storage with expiry)
export function getStoredReferralCode(): string | null {
  // Try localStorage first
  try {
    const stored = localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      if (data.expires && data.expires > Date.now()) {
        return data.code;
      }
      // Expired - clean up
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
    }
  } catch {
    // Invalid data, clear it
    localStorage.removeItem(REFERRAL_STORAGE_KEY);
  }
  
  // Fallback to cookie
  try {
    const cookieData = getCookie(REFERRAL_STORAGE_KEY);
    if (cookieData) {
      const data = JSON.parse(cookieData);
      if (data.expires && data.expires > Date.now()) {
        return data.code;
      }
      // Expired - clean up
      deleteCookie(REFERRAL_STORAGE_KEY);
    }
  } catch {
    deleteCookie(REFERRAL_STORAGE_KEY);
  }

  // A code held until analytics are allowed: this page's memory, never
  // stored, so a purchase started in the same visit still names its referrer.
  return heldReferralCode;
}

// Clear referral code after successful purchase
export function clearReferralCode(): void {
  heldReferralCode = null;
  stopWaitingForConsent();
  localStorage.removeItem(REFERRAL_STORAGE_KEY);
  deleteCookie(REFERRAL_STORAGE_KEY);
}
