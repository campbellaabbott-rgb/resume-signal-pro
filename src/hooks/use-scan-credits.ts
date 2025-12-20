import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const CREDITS_PER_PACK = 30;
const PACK_PRICE_USD = 10;

interface ScanCreditsState {
  email: string | null;
  credits: number;
  isLoading: boolean;
}

export function useScanCredits() {
  const [state, setState] = useState<ScanCreditsState>({
    email: null,
    credits: 0,
    isLoading: false
  });

  // Check credits for an email
  const checkCredits = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) return 0;
    
    const normalizedEmail = email.toLowerCase().trim();
    
    try {
      const { data, error } = await supabase.rpc('get_scan_credits', {
        p_email: normalizedEmail
      });
      
      if (error) {
        console.error('[useScanCredits] Error checking credits:', error);
        return 0;
      }
      
      const credits = data || 0;
      setState(prev => ({ ...prev, email: normalizedEmail, credits }));
      return credits;
    } catch (err) {
      console.error('[useScanCredits] Error:', err);
      return 0;
    }
  }, []);

  // Use a credit (call before scan if user has credits)
  const useCredit = useCallback(async (email: string): Promise<boolean> => {
    if (!email || !email.includes('@')) return false;
    
    const normalizedEmail = email.toLowerCase().trim();
    
    try {
      const { data, error } = await supabase.rpc('use_scan_credit', {
        p_email: normalizedEmail
      });
      
      if (error) {
        console.error('[useScanCredits] Error using credit:', error);
        return false;
      }
      
      if (data) {
        setState(prev => ({ 
          ...prev, 
          email: normalizedEmail, 
          credits: Math.max(0, prev.credits - 1) 
        }));
      }
      
      return data === true;
    } catch (err) {
      console.error('[useScanCredits] Error:', err);
      return false;
    }
  }, []);

  // Purchase scan pack (redirects to Stripe checkout)
  const purchaseScanPack = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) {
      toast({
        title: "Email required",
        description: "Please enter a valid email address to purchase.",
        variant: "destructive"
      });
      return null;
    }

    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const { data, error } = await supabase.functions.invoke('create-scan-pack-checkout', {
        body: { email: email.toLowerCase().trim() }
      });

      if (error) throw error;
      
      if (data?.url) {
        // Redirect checkout in the same tab
        window.location.assign(data.url);
        return data.url;
      }
      
      throw new Error('No checkout URL received');
    } catch (err) {
      console.error('[useScanCredits] Purchase error:', err);
      toast({
        title: "Purchase failed",
        description: "Could not create checkout. Please try again.",
        variant: "destructive"
      });
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Verify purchase after returning from Stripe
  const verifyPurchase = useCallback(async (sessionId: string) => {
    if (!sessionId) return null;

    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const { data, error } = await supabase.functions.invoke('verify-scan-pack-purchase', {
        body: { sessionId }
      });

      if (error) throw error;
      
      if (data?.verified) {
        setState(prev => ({
          ...prev,
          email: data.email,
          credits: data.totalCredits || prev.credits
        }));
        
        toast({
          title: "Purchase successful!",
          description: `${data.creditsAdded || CREDITS_PER_PACK} scan credits added to your account.`,
        });
        
        return data;
      }
      
      return null;
    } catch (err) {
      console.error('[useScanCredits] Verify error:', err);
      toast({
        title: "Verification failed",
        description: "Could not verify purchase. Please contact support.",
        variant: "destructive"
      });
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  return {
    email: state.email,
    credits: state.credits,
    isLoading: state.isLoading,
    checkCredits,
    useCredit,
    purchaseScanPack,
    verifyPurchase,
    creditsPerPack: CREDITS_PER_PACK,
    packPrice: PACK_PRICE_USD
  };
}
