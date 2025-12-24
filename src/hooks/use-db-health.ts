/**
 * React hook for monitoring database connection health
 */

import { useState, useEffect, useCallback } from 'react';
import {
  checkConnectionHealth,
  getConnectionHealth,
  getQueryMetrics,
  resetQueryMetrics,
} from '@/lib/db-resilience';

interface DbHealthState {
  healthy: boolean;
  latencyMs: number | null;
  lastCheck: Date | null;
  consecutiveFailures: number;
  checking: boolean;
  error: string | null;
}

interface QueryMetricsState {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalRetries: number;
  avgLatencyMs: number;
  successRate: number;
}

interface UseDbHealthOptions {
  autoCheck?: boolean;
  checkIntervalMs?: number;
}

export function useDbHealth(options: UseDbHealthOptions = {}) {
  const {
    autoCheck = false,
    checkIntervalMs = 30000, // 30 seconds default
  } = options;

  const [health, setHealth] = useState<DbHealthState>({
    healthy: true,
    latencyMs: null,
    lastCheck: null,
    consecutiveFailures: 0,
    checking: false,
    error: null,
  });

  const [metrics, setMetrics] = useState<QueryMetricsState>({
    totalQueries: 0,
    successfulQueries: 0,
    failedQueries: 0,
    totalRetries: 0,
    avgLatencyMs: 0,
    successRate: 100,
  });

  const performHealthCheck = useCallback(async () => {
    setHealth(prev => ({ ...prev, checking: true }));

    try {
      const result = await checkConnectionHealth();
      const connectionStatus = getConnectionHealth();

      setHealth({
        healthy: result.healthy,
        latencyMs: result.latencyMs,
        lastCheck: new Date(),
        consecutiveFailures: connectionStatus.consecutiveFailures,
        checking: false,
        error: result.error || null,
      });
    } catch (error: any) {
      setHealth(prev => ({
        ...prev,
        healthy: false,
        checking: false,
        error: error.message,
      }));
    }
  }, []);

  const refreshMetrics = useCallback(() => {
    const currentMetrics = getQueryMetrics();
    setMetrics(currentMetrics);
  }, []);

  const clearMetrics = useCallback(() => {
    resetQueryMetrics();
    refreshMetrics();
  }, [refreshMetrics]);

  // Auto health check interval
  useEffect(() => {
    if (!autoCheck) return;

    // Initial check
    performHealthCheck();

    const interval = setInterval(performHealthCheck, checkIntervalMs);
    return () => clearInterval(interval);
  }, [autoCheck, checkIntervalMs, performHealthCheck]);

  // Metrics refresh interval
  useEffect(() => {
    if (!autoCheck) return;

    const interval = setInterval(refreshMetrics, 5000);
    return () => clearInterval(interval);
  }, [autoCheck, refreshMetrics]);

  return {
    health,
    metrics,
    performHealthCheck,
    refreshMetrics,
    clearMetrics,
  };
}

/**
 * Hook for connection alerts
 */
export function useDbHealthAlerts(options: {
  onUnhealthy?: (health: DbHealthState) => void;
  onRecovered?: () => void;
  thresholdFailures?: number;
} = {}) {
  const {
    onUnhealthy,
    onRecovered,
    thresholdFailures = 3,
  } = options;

  const { health } = useDbHealth({ autoCheck: true, checkIntervalMs: 10000 });
  const [wasUnhealthy, setWasUnhealthy] = useState(false);

  useEffect(() => {
    if (health.consecutiveFailures >= thresholdFailures && !wasUnhealthy) {
      setWasUnhealthy(true);
      onUnhealthy?.(health);
    } else if (health.healthy && wasUnhealthy) {
      setWasUnhealthy(false);
      onRecovered?.();
    }
  }, [health, wasUnhealthy, thresholdFailures, onUnhealthy, onRecovered]);

  return { health, isAlerting: wasUnhealthy };
}
