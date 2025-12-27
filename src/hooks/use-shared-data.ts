import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  inflatedCount: number;
}

// Cached today's scan count - deduplicates calls from Hero, Index, graceful-degradation
export function useTodayScanCount() {
  const [data, setData] = useState<TodayScanData>({ count: 0, inflatedCount: 2847 });
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
      
      // Inflate the number: base of 2800 + actual count * multiplier
      const inflatedCount = 2800 + (count * 3);
      setData({ count, inflatedCount });
    } catch (e) {
      // Fallback to time-based calculation
      const now = new Date();
      const hoursSinceMidnight = now.getHours() + now.getMinutes() / 60;
      const fallback = 2800 + Math.floor(hoursSinceMidnight * 25);
      setData({ count: 0, inflatedCount: fallback });
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
const getVisitorId = (): string => {
  const storageKey = 'rb_visitor_id';
  let visitorId = localStorage.getItem(storageKey);
  
  if (!visitorId) {
    visitorId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(storageKey, visitorId);
  }
  
  return visitorId;
};

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
  
  // Fire all events in parallel
  await Promise.allSettled(
    deduped.map(event => 
      supabase.functions.invoke('track-ab-event', { body: event })
    )
  );
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
