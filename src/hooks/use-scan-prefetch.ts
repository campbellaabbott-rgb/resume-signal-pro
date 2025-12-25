import { useCallback, useRef, useState } from 'react';
import { validateResumeBeforeSend } from '@/lib/resume-validation';

interface PrefetchState {
  isWarmedUp: boolean;
  isWarming: boolean;
  validationResult: ReturnType<typeof validateResumeBeforeSend> | null;
}

interface BackgroundScanResult {
  result: any;
  timestamp: number;
  resumeHash: string;
}

interface UseScanPrefetchOptions {
  resumeText: string;
  jobDescriptionText?: string;
  honeypot?: string;
  onValidationComplete?: (result: ReturnType<typeof validateResumeBeforeSend>) => void;
}

const BACKGROUND_SCAN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_MS = 2000; // Wait 2s after last change before background scan

/**
 * Hook for prefetching scan resources on hover AND background scanning on paste/upload
 * - Warms up the edge function to reduce cold start latency
 * - Pre-validates resume text
 * - Runs background scan so results are ready when user clicks "Scan"
 */
export function useScanPrefetch({ resumeText, jobDescriptionText, honeypot, onValidationComplete }: UseScanPrefetchOptions) {
  const [state, setState] = useState<PrefetchState>({
    isWarmedUp: false,
    isWarming: false,
    validationResult: null,
  });
  
  const warmupAbortRef = useRef<AbortController | null>(null);
  const backgroundScanAbortRef = useRef<AbortController | null>(null);
  const backgroundScanCache = useRef<BackgroundScanResult | null>(null);
  const lastResumeHashRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScanningRef = useRef(false);
  
  // Simple hash to detect resume changes
  const getResumeHash = useCallback((text: string) => {
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase().substring(0, 2000);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }, []);
  
  // Get background scan result if available
  const getBackgroundScanResult = useCallback((text: string): any | null => {
    if (!backgroundScanCache.current || !text) return null;
    
    const currentHash = getResumeHash(text);
    const cache = backgroundScanCache.current;
    
    if (cache.resumeHash === currentHash && Date.now() - cache.timestamp < BACKGROUND_SCAN_TTL_MS) {
      console.log('[ScanPrefetch] Using background scan result');
      return cache.result;
    }
    
    return null;
  }, [getResumeHash]);

  // Check if background scan is in progress
  const isBackgroundScanning = useCallback(() => isScanningRef.current, []);

  // Wait for background scan to complete (with timeout)
  const waitForBackgroundScan = useCallback(async (text: string, timeoutMs = 8000): Promise<any | null> => {
    if (!isScanningRef.current) {
      return getBackgroundScanResult(text);
    }

    const currentHash = getResumeHash(text);
    if (lastResumeHashRef.current !== currentHash) {
      return null; // Different resume, don't wait
    }

    console.log('[ScanPrefetch] Waiting for background scan...');
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!isScanningRef.current || Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve(getBackgroundScanResult(text));
        }
      }, 100);
    });
  }, [getResumeHash, getBackgroundScanResult]);

  // Run actual scan in background
  const runBackgroundScan = useCallback(async (text: string, jobDesc?: string, hp?: string) => {
    if (!text || text.length < 100) return;
    
    const currentHash = getResumeHash(text);
    
    // Skip if already have results
    if (getBackgroundScanResult(text)) {
      console.log('[ScanPrefetch] Already have background scan result');
      return;
    }
    
    // Skip if already scanning same text
    if (isScanningRef.current && lastResumeHashRef.current === currentHash) {
      return;
    }
    
    // Cancel any existing scan
    backgroundScanAbortRef.current?.abort();
    backgroundScanAbortRef.current = new AbortController();
    isScanningRef.current = true;
    lastResumeHashRef.current = currentHash;
    
    console.log('[ScanPrefetch] Starting background scan...');
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/free-keyword-scan-stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            resumeText: text,
            jobDescriptionText: jobDesc || undefined,
            honeypot: hp || '',
          }),
          signal: backgroundScanAbortRef.current.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Background scan failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let result: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'complete' && parsed.data) {
                result = parsed.data;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      if (result && getResumeHash(text) === currentHash) {
        backgroundScanCache.current = {
          result: { ...result, prefetched: true, cached: true },
          timestamp: Date.now(),
          resumeHash: currentHash,
        };
        console.log('[ScanPrefetch] Background scan complete, result cached');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[ScanPrefetch] Background scan failed:', err.message);
      }
    } finally {
      isScanningRef.current = false;
    }
  }, [getResumeHash, getBackgroundScanResult]);

  // Trigger background scan with debounce (call on text change/upload)
  const triggerBackgroundScan = useCallback((text: string, jobDesc?: string, hp?: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      runBackgroundScan(text, jobDesc, hp);
    }, DEBOUNCE_MS);
  }, [runBackgroundScan]);

  // Original hover prefetch (warmup + validation)
  const prefetch = useCallback(async () => {
    if (state.isWarming || !resumeText?.trim()) return;
    
    const currentHash = getResumeHash(resumeText);
    
    if (state.isWarmedUp && lastResumeHashRef.current === currentHash) return;
    
    console.log('[ScanPrefetch] Starting prefetch on hover');
    setState(prev => ({ ...prev, isWarming: true }));
    
    warmupAbortRef.current?.abort();
    warmupAbortRef.current = new AbortController();
    
    try {
      const [validationResult] = await Promise.all([
        Promise.resolve(validateResumeBeforeSend(resumeText)),
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
          console.log('[ScanPrefetch] Warmup request failed (non-critical):', err.message);
          return null;
        }),
      ]);
      
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
        return;
      }
      console.warn('[ScanPrefetch] Prefetch failed:', error);
      setState(prev => ({ ...prev, isWarming: false }));
    }
  }, [resumeText, state.isWarming, state.isWarmedUp, getResumeHash, onValidationComplete]);
  
  const reset = useCallback(() => {
    warmupAbortRef.current?.abort();
    backgroundScanAbortRef.current?.abort();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    lastResumeHashRef.current = '';
    backgroundScanCache.current = null;
    isScanningRef.current = false;
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
    getValidation: () => state.validationResult ?? validateResumeBeforeSend(resumeText),
    // Background scan methods
    triggerBackgroundScan,
    getBackgroundScanResult,
    waitForBackgroundScan,
    isBackgroundScanning,
  };
}
