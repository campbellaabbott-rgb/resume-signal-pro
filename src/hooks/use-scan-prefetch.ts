import { useCallback, useRef, useState } from 'react';
import { validateResumeBeforeSend } from '@/lib/resume-validation';

interface PrefetchState {
  isWarmedUp: boolean;
  isWarming: boolean;
  validationResult: ReturnType<typeof validateResumeBeforeSend> | null;
}

interface UseScanPrefetchOptions {
  resumeText: string;
  onValidationComplete?: (result: ReturnType<typeof validateResumeBeforeSend>) => void;
}

/**
 * Hook for prefetching scan resources on hover
 * - Warms up the edge function to reduce cold start latency
 * - Pre-validates resume text
 * - Caches validation results for instant scan start
 */
export function useScanPrefetch({ resumeText, onValidationComplete }: UseScanPrefetchOptions) {
  const [state, setState] = useState<PrefetchState>({
    isWarmedUp: false,
    isWarming: false,
    validationResult: null,
  });
  
  const warmupAbortRef = useRef<AbortController | null>(null);
  const lastResumeHashRef = useRef<string>('');
  
  // Simple hash to detect resume changes
  const getResumeHash = useCallback((text: string) => {
    return `${text.length}-${text.slice(0, 100)}-${text.slice(-100)}`;
  }, []);
  
  const prefetch = useCallback(async () => {
    // Skip if already warming or no resume
    if (state.isWarming || !resumeText?.trim()) return;
    
    const currentHash = getResumeHash(resumeText);
    
    // Skip if already warmed for this resume
    if (state.isWarmedUp && lastResumeHashRef.current === currentHash) return;
    
    console.log('[ScanPrefetch] Starting prefetch on hover');
    setState(prev => ({ ...prev, isWarming: true }));
    
    // Abort any previous warmup
    warmupAbortRef.current?.abort();
    warmupAbortRef.current = new AbortController();
    
    try {
      // Parallel: validate resume + warm up edge function
      const [validationResult] = await Promise.all([
        // 1. Pre-validate resume (sync but wrapped for parallel execution)
        Promise.resolve(validateResumeBeforeSend(resumeText)),
        
        // 2. Warm up edge function with minimal request
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/warm-up`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ target: 'free-keyword-scan-stream' }),
          signal: warmupAbortRef.current?.signal,
        }).catch(err => {
          // Don't fail prefetch if warmup fails - it's just an optimization
          console.log('[ScanPrefetch] Warmup request failed (non-critical):', err.message);
          return null;
        }),
      ]);
      
      lastResumeHashRef.current = currentHash;
      
      setState({
        isWarmedUp: true,
        isWarming: false,
        validationResult,
      });
      
      onValidationComplete?.(validationResult);
      
      console.log('[ScanPrefetch] Prefetch complete', {
        validationPassed: validationResult.isValid,
        warnings: validationResult.warnings.length,
      });
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ScanPrefetch] Prefetch aborted');
        return;
      }
      
      console.warn('[ScanPrefetch] Prefetch failed:', error);
      setState(prev => ({ ...prev, isWarming: false }));
    }
  }, [resumeText, state.isWarming, state.isWarmedUp, getResumeHash, onValidationComplete]);
  
  const reset = useCallback(() => {
    warmupAbortRef.current?.abort();
    lastResumeHashRef.current = '';
    setState({
      isWarmedUp: false,
      isWarming: false,
      validationResult: null,
    });
  }, []);
  
  return {
    ...state,
    prefetch,
    reset,
    // Convenience: get cached validation or run fresh
    getValidation: () => state.validationResult ?? validateResumeBeforeSend(resumeText),
  };
}
