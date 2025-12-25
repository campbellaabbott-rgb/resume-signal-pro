import { useCallback, useRef, useState } from 'react';

interface PrefetchState {
  isWarmedUp: boolean;
  isWarming: boolean;
  lastWarmupTime: number | null;
}

// Warm-up is valid for 5 minutes
const WARMUP_TTL_MS = 5 * 60 * 1000;

/**
 * Hook for prefetching checkout resources on hover
 * - Warms up the checkout edge function to reduce cold start latency
 * - Caches warmup state to avoid redundant requests
 */
export function useCheckoutPrefetch() {
  const [state, setState] = useState<PrefetchState>({
    isWarmedUp: false,
    isWarming: false,
    lastWarmupTime: null,
  });
  
  const warmupAbortRef = useRef<AbortController | null>(null);
  
  const prefetch = useCallback(async () => {
    // Skip if already warming
    if (state.isWarming) return;
    
    // Skip if warmed up recently
    if (state.isWarmedUp && state.lastWarmupTime) {
      const elapsed = Date.now() - state.lastWarmupTime;
      if (elapsed < WARMUP_TTL_MS) return;
    }
    
    console.log('[CheckoutPrefetch] Starting prefetch on hover');
    setState(prev => ({ ...prev, isWarming: true }));
    
    // Abort any previous warmup
    warmupAbortRef.current?.abort();
    warmupAbortRef.current = new AbortController();
    
    try {
      // Warm up checkout edge function
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/warm-up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ target: 'create-product-checkout' }),
        signal: warmupAbortRef.current?.signal,
      });
      
      setState({
        isWarmedUp: true,
        isWarming: false,
        lastWarmupTime: Date.now(),
      });
      
      console.log('[CheckoutPrefetch] Prefetch complete');
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[CheckoutPrefetch] Prefetch aborted');
        return;
      }
      
      // Don't fail on warmup errors - it's just an optimization
      console.log('[CheckoutPrefetch] Prefetch failed (non-critical):', error);
      setState(prev => ({ ...prev, isWarming: false }));
    }
  }, [state.isWarming, state.isWarmedUp, state.lastWarmupTime]);
  
  const reset = useCallback(() => {
    warmupAbortRef.current?.abort();
    setState({
      isWarmedUp: false,
      isWarming: false,
      lastWarmupTime: null,
    });
  }, []);
  
  // Props to spread onto checkout buttons
  const prefetchProps = {
    onMouseEnter: prefetch,
    onFocus: prefetch,
  };
  
  return {
    ...state,
    prefetch,
    reset,
    prefetchProps,
  };
}
