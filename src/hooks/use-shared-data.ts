import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getVisitorId } from '@/lib/track-transport';
import { postTrackEvent } from '@/lib/track-transport';

// =============================================================================
// SHARED DATA CACHE
// =============================================================================
// Singleton cache to deduplicate RPC calls across components
// Prevents multiple components from making identical network requests

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  promise?: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 60_000; // 1 minute default TTL

// Get or create a cached promise to deduplicate in-flight requests
async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = CACHE_TTL_MS
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  
  // Return cached data if still valid
  if (cached && (now - cached.timestamp) < ttlMs) {
    // If there's a pending promise, wait for it
    if (cached.promise) {
      return cached.promise;
    }
    return cached.data;
  }
  
  // Create a deduplicating promise
  const promise = fetcher().then(data => {
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  }).catch(err => {
    // Remove failed entry from cache
    cache.delete(key);
    throw err;
  });
  
  // Store the promise to dedupe concurrent calls
  cache.set(key, { data: cached?.data as T, timestamp: now, promise });
  
  return promise;
}

// Invalidate cache entry
export function invalidateCache(key: string) {
  cache.delete(key);
}

// =============================================================================
// SHARED HOOKS
// =============================================================================

interface TodayScanData {
  count: number;
}

// Cached today's scan count - deduplicates calls from Hero, Index, graceful-degradation
//
// `inflatedCount` REMOVED (2026-08-10). It was `2800 + count * 3`, with a
// clock-derived fallback when the RPC failed — a fabricated figure, rendered
// as social proof, in a codebase whose other stat surfaces enforce
// measured-or-nothing (use-scan-totals.ts says "no hardcoded or invented
// counts, ever", and cites the 9.5x trust-page overstatement that rule came
// from). The consumer now renders the REAL count past a floor, or nothing.
// An error yields count 0, and 0 renders nothing — never a synthetic number.
export function useTodayScanCount() {
  const [data, setData] = useState<TodayScanData>({ count: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const count = await getCachedOrFetch<number>(
        'today_scan_count',
        async () => {
          const { data, error } = await supabase.rpc('get_today_scan_count');
          if (error) throw error;
          return data ?? 0;
        },
        120_000 // 2 minute TTL for scan count
      );
      setData({ count });
    } catch (e) {
      setData({ count: 0 });
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  useEffect(() => {
    refresh();
  }, [refresh]);
  
  return { ...data, isLoading, refresh };
}

interface ErrorHistory {
  totalErrors: number;
  recentErrors: number;
  lastErrorAt: string | null;
  errorTypes: string[];
  hasHadErrors: boolean;
}

const DEFAULT_ERROR_HISTORY: ErrorHistory = {
  totalErrors: 0,
  recentErrors: 0,
  lastErrorAt: null,
  errorTypes: [],
  hasHadErrors: false
};

// Get visitor ID (same as error tracking)


// Cached error history - deduplicates calls
export function useVisitorErrorHistory() {
  const [data, setData] = useState<ErrorHistory>(DEFAULT_ERROR_HISTORY);
  const [isLoading, setIsLoading] = useState(true);
  const visitorId = useRef(getVisitorId());
  
  const refresh = useCallback(async () => {
    try {
      const history = await getCachedOrFetch<ErrorHistory>(
        `error_history_${visitorId.current}`,
        async () => {
          const { data, error } = await supabase.rpc('get_visitor_error_history', {
            p_visitor_id: visitorId.current
          });
          
          if (error || !data || data.length === 0) {
            return DEFAULT_ERROR_HISTORY;
          }
          
          const result = data[0];
          return {
            totalErrors: result.total_errors || 0,
            recentErrors: result.recent_errors || 0,
            lastErrorAt: result.last_error_at || null,
            errorTypes: result.error_types || [],
            hasHadErrors: (result.total_errors || 0) > 0
          };
        },
        300_000 // 5 minute TTL for error history
      );
      
      setData(history);
    } catch (e) {
      console.error('[SharedData] Error fetching error history:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  useEffect(() => {
    refresh();
  }, [refresh]);
  
  return { ...data, isLoading, refresh, visitorId: visitorId.current };
}

// =============================================================================
// A/B EVENT BATCHING
// =============================================================================
// Batches A/B events to reduce network calls

interface ABEvent {
  testName: string;
  variant: string;
  eventType: 'view' | 'conversion';
  visitorId: string;
  metadata?: Record<string, unknown>;
}

const pendingABEvents: ABEvent[] = [];
let abBatchTimer: ReturnType<typeof setTimeout> | null = null;
const AB_BATCH_DELAY_MS = 100; // Batch events within 100ms window

async function flushABEvents() {
  if (pendingABEvents.length === 0) return;
  
  const events = [...pendingABEvents];
  pendingABEvents.length = 0;
  abBatchTimer = null;
  
  // Deduplicate view events (keep only first per test)
  const viewsSeen = new Set<string>();
  const deduped = events.filter(e => {
    if (e.eventType === 'view') {
      const key = `${e.testName}_${e.visitorId}`;
      if (viewsSeen.has(key)) return false;
      viewsSeen.add(key);
    }
    return true;
  });
  
  // Keepalive posts survive navigation (a pending batch used to be silently
  // dropped when the user left for Stripe before the 100ms timer fired).
  for (const event of deduped) postTrackEvent(event);
}

// Flush any queued events at the last reliable moment before the page goes
// away — keepalive lets the posts complete after unload.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (abBatchTimer) { clearTimeout(abBatchTimer); abBatchTimer = null; }
    void flushABEvents();
  });
}

export function queueABEvent(event: ABEvent) {
  pendingABEvents.push(event);
  
  // Batch events
  if (!abBatchTimer) {
    abBatchTimer = setTimeout(flushABEvents, AB_BATCH_DELAY_MS);
  }
}

// =============================================================================
// CONNECTION HEALTH CHECK (cached)
// =============================================================================

interface ConnectionHealth {
  isConnected: boolean;
  lastChecked: number;
}

export async function checkConnectionHealth(): Promise<boolean> {
  try {
    const result = await getCachedOrFetch<ConnectionHealth>(
      'connection_health',
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const { error } = await supabase.rpc('get_today_scan_count');
        
        clearTimeout(timeoutId);
        
        return {
          isConnected: !error,
          lastChecked: Date.now()
        };
      },
      30_000 // 30 second TTL for connection health
    );
    
    return result.isConnected;
  } catch {
    return false;
  }
}
