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
      // Store referral code in localStorage for later use during checkout
      localStorage.setItem('affiliate_ref', refCode);
      
      // Track the click (async, fire-and-forget)
      (async () => {
        try {
          await supabase.rpc('track_affiliate_click', {
            p_referral_code: refCode,
            p_user_agent: navigator.userAgent,
            p_referrer: document.referrer || null,
          });
          console.debug('Affiliate click tracked');
        } catch {
          // Silently fail - don't affect user experience
          console.debug('Affiliate click tracking failed');
        }
      })();
    }
  }, []);
}

// Get stored referral code for checkout
export function getStoredReferralCode(): string | null {
  return localStorage.getItem('affiliate_ref');
}

// Clear referral code after successful purchase
export function clearReferralCode(): void {
  localStorage.removeItem('affiliate_ref');
}
