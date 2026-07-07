import { useCallback, useRef, useState } from 'react';
import { validateResumeBeforeSend } from '@/lib/resume-validation';
import { clearAllClientScanCaches } from './use-streaming-scan';

interface PrefetchState {
  isWarmedUp: boolean;
  isWarming: boolean;
  validationResult: ReturnType<typeof validateResumeBeforeSend> | null;
}

interface BackgroundScanResult {
  result: any;
  timestamp: number;
  resumeHash: string;
  resumePreview: string; // For debugging
}

interface UseScanPrefetchOptions {
  resumeText: string;
  jobDescriptionText?: string;
  honeypot?: string;
  onValidationComplete?: (result: ReturnType<typeof validateResumeBeforeSend>) => void;
}

const BACKGROUND_SCAN_TTL_MS = 3 * 60 * 1000; // 3 minutes (reduced from 5)
const DEBOUNCE_MS = 2000; // Wait 2s after last change before background scan

// Generate SHA-256 hash for robust cache keys (synchronous fallback version for quick checks)
function getSimpleHash(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase().substring(0, 3000);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36);
}

// Generate SHA-256 hash for robust cache keys (async for background scan)
async function generateSecureHash(text: string): Promise<string> {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
  } catch {
    return getSimpleHash(text);
  }
}

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
  
  // Get background scan result if available
  const getBackgroundScanResult = useCallback((text: string): any | null => {
    if (!backgroundScanCache.current || !text) return null;
    
    const currentHash = getSimpleHash(text);
    const cache = backgroundScanCache.current;
    
    // Verify both hash AND content preview match to prevent collisions
    const textPreview = text.substring(0, 100).toLowerCase().replace(/\s+/g, ' ');
    const cachePreview = cache.resumePreview?.toLowerCase().replace(/\s+/g, ' ') || '';
    
    if (cache.resumeHash === currentHash && 
        textPreview === cachePreview &&
        Date.now() - cache.timestamp < BACKGROUND_SCAN_TTL_MS) {
      console.log('[ScanPrefetch] Using background scan result for:', textPreview.substring(0, 50));
      return cache.result;
    }
    
    return null;
  }, []);

  // Check if background scan is in progress
  const isBackgroundScanning = useCallback(() => isScanningRef.current, []);

  // Wait for background scan to complete (with timeout)
  const waitForBackgroundScan = useCallback(async (text: string, timeoutMs = 8000): Promise<any | null> => {
    if (!isScanningRef.current) {
      return getBackgroundScanResult(text);
    }

    const currentHash = getSimpleHash(text);
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
  }, [getBackgroundScanResult]);

  // Run actual scan in background
  const runBackgroundScan = useCallback(async (text: string, jobDesc?: string, hp?: string) => {
    if (!text || text.length < 100) return;
    
    const currentHash = getSimpleHash(text);
    
    // Skip if already have results
    if (getBackgroundScanResult(text)) {
      console.log('[ScanPrefetch] Already have background scan result');
      return;
    }
    
    // Skip if already scanning same text
    if (isScanningRef.current && lastResumeHashRef.current === currentHash) {
      return;
    }
    
    // Cancel any existing scan and clear old cache if different resume
    if (lastResumeHashRef.current !== currentHash) {
      backgroundScanCache.current = null; // Clear stale cache immediately
      // Also clear client-side localStorage caches
      clearAllClientScanCaches();
    }
    backgroundScanAbortRef.current?.abort();
    backgroundScanAbortRef.current = new AbortController();
    isScanningRef.current = true;
    lastResumeHashRef.current = currentHash;
    
    console.log('[ScanPrefetch] Starting background scan for hash:', currentHash.substring(0, 8), 'preview:', text.substring(0, 50));
    
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
            skipCache: true, // Always get fresh results for background scan
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

      // Verify the hash still matches before caching
      if (result && getSimpleHash(text) === currentHash) {
        backgroundScanCache.current = {
          result: { ...result, prefetched: true, cached: true },
          timestamp: Date.now(),
          resumeHash: currentHash,
          resumePreview: text.substring(0, 100), // Store preview for collision detection
        };
        console.log('[ScanPrefetch] Background scan complete, result cached for:', text.substring(0, 50));
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[ScanPrefetch] Background scan failed:', err.message);
      }
    } finally {
      isScanningRef.current = false;
    }
  }, [getBackgroundScanResult]);

  // DISABLED 2026-07-06 (audit finding): the background scan hits the
  // streaming fork, which (a) registers rate limits under the SAME
  // 'free-keyword-scan' key as the real scanner and (b) returns the legacy
  // report shape, which Index.tsx discards 100% of the time (no
  // reportVerdict). Net effect was every paste burning one of the user's 7
  // daily scan slots plus a full AI scan for a result that was always thrown
  // away — users effectively got ~3 scans/day and we paid double per scan.
  // The cache-clearing side effects below still run (they're correct); only
  // the wasteful server call is skipped. Re-enable by pointing
  // runBackgroundScan at the enriched primary endpoint once the click path
  // can reliably consume its result (and the double-slot problem is solved).
  const PREFETCH_ENABLED = false;

  // Trigger background scan with debounce (call on text change/upload)
  const triggerBackgroundScan = useCallback((text: string, jobDesc?: string, hp?: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Immediately clear stale cache if resume changed (before debounce)
    const newHash = getSimpleHash(text);
    if (lastResumeHashRef.current && lastResumeHashRef.current !== newHash) {
      console.log('[ScanPrefetch] New resume detected, clearing all caches');
      backgroundScanCache.current = null;
      clearAllClientScanCaches(); // Clear localStorage caches too
      // Abort any in-progress scan for the old resume
      backgroundScanAbortRef.current?.abort();
      isScanningRef.current = false;
    }

    if (!PREFETCH_ENABLED) return;

    debounceTimerRef.current = setTimeout(() => {
      runBackgroundScan(text, jobDesc, hp);
    }, DEBOUNCE_MS);
  }, [runBackgroundScan]);

  // Original hover prefetch (warmup + validation)
  const prefetch = useCallback(async () => {
    if (state.isWarming || !resumeText?.trim()) return;
    
    const currentHash = getSimpleHash(resumeText);
    
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
  }, [resumeText, state.isWarming, state.isWarmedUp, onValidationComplete]);
  
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

  // Clear only the background scan cache (for force reanalyze)
  const clearBackgroundScanCache = useCallback(() => {
    backgroundScanAbortRef.current?.abort();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    backgroundScanCache.current = null;
    isScanningRef.current = false;
    clearAllClientScanCaches(); // Also clear localStorage caches
    console.log('[ScanPrefetch] All scan caches cleared for fresh analysis');
  }, []);
  
  return {
    ...state,
    prefetch,
    reset,
    clearBackgroundScanCache,
    getValidation: () => state.validationResult ?? validateResumeBeforeSend(resumeText),
    // Background scan methods
    triggerBackgroundScan,
    getBackgroundScanResult,
    waitForBackgroundScan,
    isBackgroundScanning,
  };
}
