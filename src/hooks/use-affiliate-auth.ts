import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AffiliateSession {
  affiliateId: string;
  email: string;
  referralCode: string;
  sessionToken: string;
}

interface AffiliateStats {
  total_clicks: number;
  total_conversions: number;
  total_revenue: number;
  pending_payout: number;
  paid_out: number;
  conversion_rate: number;
}

interface AffiliateInfo {
  id: string;
  email: string;
  referral_code: string;
  commission_amount: number;
  status: string;
  created_at: string;
}

interface Conversion {
  id: string;
  product_name: string;
  sale_amount: number;
  commission_amount: number;
  status: string;
  created_at: string;
}

interface DashboardData {
  affiliate: AffiliateInfo;
  stats: AffiliateStats;
  recent_conversions: Conversion[];
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

// Simple hash function for IP anonymization (client-side fingerprint)
async function generateVisitorHash(): Promise<string> {
  const data = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset().toString(),
  ].join('|');
  
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
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
      affiliate_id: string;
      referral_code: string;
      session_token: string;
    };

    if (!result.success) {
      throw new Error('Registration failed');
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
      affiliate_id: string;
      email: string;
      referral_code: string;
      session_token: string;
    };

    if (!result.success) {
      throw new Error('Login failed');
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

// Hook to track referral clicks and store referral code
export function useAffiliateTracking() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (refCode) {
      // Store referral code in both localStorage and cookie for redundancy
      const expiryTimestamp = Date.now() + (REFERRAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const storageData = JSON.stringify({ code: refCode, expires: expiryTimestamp });
      
      localStorage.setItem(REFERRAL_STORAGE_KEY, storageData);
      setCookie(REFERRAL_STORAGE_KEY, storageData, REFERRAL_EXPIRY_DAYS);
      
      // Track the click with visitor hash (async, fire-and-forget)
      (async () => {
        try {
          const visitorHash = await generateVisitorHash();
          await supabase.rpc('track_affiliate_click', {
            p_referral_code: refCode,
            p_ip_hash: visitorHash,
            p_user_agent: navigator.userAgent.slice(0, 200), // Limit length
            p_referrer: document.referrer?.slice(0, 500) || null,
          });
          console.debug('Affiliate click tracked with hash:', visitorHash.slice(0, 4) + '...');
        } catch {
          // Silently fail - don't affect user experience
          console.debug('Affiliate click tracking failed');
        }
      })();
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
  
  return null;
}

// Clear referral code after successful purchase
export function clearReferralCode(): void {
  localStorage.removeItem(REFERRAL_STORAGE_KEY);
  deleteCookie(REFERRAL_STORAGE_KEY);
}
