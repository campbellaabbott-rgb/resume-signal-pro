import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canAttemptService, recordServiceSuccess, recordServiceFailure } from "./use-circuit-breaker";
import { retryAsync, isRetryableError } from "./use-retry";

interface GracefulDegradationOptions {
  serviceName: string;
  cacheKey?: string;
  cacheDuration?: number; // in milliseconds
  enableOfflineMode?: boolean;
}

interface CachedResponse<T> {
  data: T;
  timestamp: number;
  isStale: boolean;
}

const responseCache = new Map<string, { data: unknown; timestamp: number }>();

/**
 * Hook for graceful degradation with caching and fallbacks
 */
export function useGracefulDegradation<T>(options: GracefulDegradationOptions) {
  const {
    serviceName,
    cacheKey,
    cacheDuration = 5 * 60 * 1000, // 5 minutes default
    enableOfflineMode = true,
  } = options;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [serviceAvailable, setServiceAvailable] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const getCached = useCallback((): CachedResponse<T> | null => {
    if (!cacheKey) return null;

    const cached = responseCache.get(cacheKey);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    const isStale = age > cacheDuration;

    return {
      data: cached.data as T,
      timestamp: cached.timestamp,
      isStale,
    };
  }, [cacheKey, cacheDuration]);

  const setCache = useCallback(
    (data: T) => {
      if (!cacheKey) return;
      responseCache.set(cacheKey, { data, timestamp: Date.now() });
    },
    [cacheKey]
  );

  const executeWithFallback = useCallback(
    async <R>(
      primaryFn: () => Promise<R>,
      fallbackFn?: () => Promise<R> | R,
      options?: { skipCache?: boolean }
    ): Promise<R> => {
      // Check if offline
      if (enableOfflineMode && !isOnline) {
        const cached = getCached();
        if (cached) {
          console.log(`[GracefulDegradation] Offline, using cached data for ${serviceName}`);
          return cached.data as unknown as R;
        }
        if (fallbackFn) {
          return fallbackFn();
        }
        throw new Error("No network connection and no cached data available");
      }

      // Check circuit breaker
      if (!canAttemptService(serviceName)) {
        const cached = getCached();
        if (cached) {
          console.log(`[GracefulDegradation] Circuit open, using cached data for ${serviceName}`);
          return cached.data as unknown as R;
        }
        if (fallbackFn) {
          return fallbackFn();
        }
        throw new Error(`Service ${serviceName} is temporarily unavailable`);
      }

      try {
        // Try primary function with retry
        const result = await retryAsync(primaryFn, {
          maxRetries: 2,
          initialDelay: 1000,
          shouldRetry: (error, attempt) => {
            return attempt < 2 && isRetryableError(error);
          },
        });

        recordServiceSuccess(serviceName);
        setServiceAvailable(true);
        
        // Cache successful response
        if (cacheKey && result) {
          setCache(result as unknown as T);
        }

        return result;
      } catch (error) {
        recordServiceFailure(serviceName);
        setServiceAvailable(false);

        console.warn(`[GracefulDegradation] Primary function failed for ${serviceName}:`, error);

        // Try cached data
        const cached = getCached();
        if (cached && !options?.skipCache) {
          console.log(`[GracefulDegradation] Using ${cached.isStale ? "stale" : "fresh"} cached data for ${serviceName}`);
          return cached.data as unknown as R;
        }

        // Try fallback
        if (fallbackFn) {
          console.log(`[GracefulDegradation] Using fallback for ${serviceName}`);
          return fallbackFn();
        }

        throw error;
      }
    },
    [serviceName, isOnline, enableOfflineMode, getCached, setCache, cacheKey]
  );

  return {
    executeWithFallback,
    isOnline,
    serviceAvailable,
    getCached,
    setCache,
    clearCache: () => cacheKey && responseCache.delete(cacheKey),
  };
}

/**
 * Check if backend is available (quick health check)
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const { error } = await supabase.rpc("get_today_scan_count");
    
    clearTimeout(timeoutId);
    
    return !error;
  } catch {
    return false;
  }
}

/**
 * Get a fallback response for common operations
 */
export function getFallbackResponse(operation: string): unknown {
  const fallbacks: Record<string, unknown> = {
    "free-keyword-scan": {
      success: false,
      error: "Service temporarily unavailable. Please try again in a moment.",
      fallback: true,
    },
    "analyze-resume": {
      success: false,
      error: "Analysis service temporarily unavailable. Your request has been queued.",
      fallback: true,
    },
    "create-checkout": {
      success: false,
      error: "Payment service temporarily unavailable. Please try again shortly.",
      fallback: true,
    },
  };

  return fallbacks[operation] || { success: false, error: "Service temporarily unavailable" };
}
