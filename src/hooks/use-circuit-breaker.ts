import { useState, useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxAttempts?: number;
}

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | null;
  successesInHalfOpen: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
}

/**
 * Circuit breaker hook for handling service failures gracefully
 * - Closed: Normal operation, requests go through
 * - Open: Service is down, immediately return fallback
 * - Half-Open: Testing if service is back, allow limited requests
 */
export function useCircuitBreaker(options: CircuitBreakerOptions = {}) {
  const {
    failureThreshold = 3,
    resetTimeout = 30000, // 30 seconds
    halfOpenMaxAttempts = 2,
  } = options;

  const [circuit, setCircuit] = useState<CircuitBreakerState>({
    state: "closed",
    failures: 0,
    lastFailureTime: null,
    successesInHalfOpen: 0,
    totalFailures: 0,
    totalSuccesses: 0,
  });

  const recordSuccess = useCallback(() => {
    setCircuit((prev) => {
      if (prev.state === "half-open") {
        const newSuccesses = prev.successesInHalfOpen + 1;
        if (newSuccesses >= halfOpenMaxAttempts) {
          console.log('[CircuitBreaker] Circuit closed after recovery');
          return {
            state: "closed",
            failures: 0,
            lastFailureTime: null,
            successesInHalfOpen: 0,
            totalFailures: prev.totalFailures,
            totalSuccesses: prev.totalSuccesses + 1,
          };
        }
        return { 
          ...prev, 
          successesInHalfOpen: newSuccesses,
          totalSuccesses: prev.totalSuccesses + 1,
        };
      }
      return { 
        ...prev, 
        failures: Math.max(0, prev.failures - 1),
        totalSuccesses: prev.totalSuccesses + 1,
      };
    });
  }, [halfOpenMaxAttempts]);

  const recordFailure = useCallback((errorMessage?: string) => {
    setCircuit((prev) => {
      const newFailures = prev.failures + 1;
      if (newFailures >= failureThreshold) {
        console.log(`[CircuitBreaker] Circuit OPENED after ${newFailures} failures`);
        return {
          state: "open",
          failures: newFailures,
          lastFailureTime: Date.now(),
          successesInHalfOpen: 0,
          totalFailures: prev.totalFailures + 1,
          totalSuccesses: prev.totalSuccesses,
          lastError: errorMessage,
        };
      }
      return { 
        ...prev, 
        failures: newFailures, 
        lastFailureTime: Date.now(),
        totalFailures: prev.totalFailures + 1,
        lastError: errorMessage,
      };
    });
  }, [failureThreshold]);

  const canAttempt = useCallback((): boolean => {
    if (circuit.state === "closed") return true;

    if (circuit.state === "open") {
      const timeSinceFailure = Date.now() - (circuit.lastFailureTime || 0);
      if (timeSinceFailure >= resetTimeout) {
        console.log('[CircuitBreaker] Moving to half-open state');
        setCircuit((prev) => ({
          ...prev,
          state: "half-open",
          successesInHalfOpen: 0,
        }));
        return true;
      }
      console.log(`[CircuitBreaker] Circuit open, ${Math.round((resetTimeout - timeSinceFailure) / 1000)}s until retry`);
      return false;
    }

    return true; // half-open allows attempts
  }, [circuit.state, circuit.lastFailureTime, resetTimeout]);

  const reset = useCallback(() => {
    console.log('[CircuitBreaker] Circuit manually reset');
    setCircuit({
      state: "closed",
      failures: 0,
      lastFailureTime: null,
      successesInHalfOpen: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    });
  }, []);

  const getTimeUntilRetry = useCallback((): number | null => {
    if (circuit.state !== "open" || !circuit.lastFailureTime) return null;
    const remaining = resetTimeout - (Date.now() - circuit.lastFailureTime);
    return remaining > 0 ? remaining : null;
  }, [circuit.state, circuit.lastFailureTime, resetTimeout]);

  return {
    state: circuit.state,
    failures: circuit.failures,
    totalFailures: circuit.totalFailures,
    totalSuccesses: circuit.totalSuccesses,
    lastError: circuit.lastError,
    canAttempt,
    recordSuccess,
    recordFailure,
    reset,
    isOpen: circuit.state === "open",
    isHalfOpen: circuit.state === "half-open",
    isClosed: circuit.state === "closed",
    getTimeUntilRetry,
  };
}

/**
 * Global circuit breaker registry for services
 * Persists state across component re-renders
 */
interface ServiceCircuitState extends CircuitBreakerState {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxAttempts: number;
}

const serviceRegistry: Map<string, ServiceCircuitState> = new Map();

const DEFAULT_CONFIG = {
  failureThreshold: 3,
  resetTimeout: 30000,
  halfOpenMaxAttempts: 2,
};

// Service-specific configurations
const SERVICE_CONFIGS: Record<string, Partial<typeof DEFAULT_CONFIG> & { critical?: boolean; friendlyName?: string }> = {
  'ai-gateway': { failureThreshold: 2, resetTimeout: 60000, critical: true, friendlyName: 'AI Gateway' },
  'stripe': { failureThreshold: 3, resetTimeout: 45000, critical: true, friendlyName: 'Payment System' },
  'database': { failureThreshold: 5, resetTimeout: 15000, critical: true, friendlyName: 'Database' },
  'free-keyword-scan': { failureThreshold: 2, resetTimeout: 60000, critical: true, friendlyName: 'Resume Scanner' },
  'analyze-resume': { failureThreshold: 2, resetTimeout: 60000, critical: true, friendlyName: 'Resume Analyzer' },
  'health-check': { failureThreshold: 5, resetTimeout: 10000, critical: false, friendlyName: 'Health Check' },
  'parse-pdf': { failureThreshold: 3, resetTimeout: 30000, critical: true, friendlyName: 'PDF Parser' },
  'parse-docx': { failureThreshold: 3, resetTimeout: 30000, critical: true, friendlyName: 'Document Parser' },
  'generate-cover-letter': { failureThreshold: 2, resetTimeout: 60000, critical: true, friendlyName: 'Cover Letter Generator' },
  'generate-tailored-resume': { failureThreshold: 2, resetTimeout: 60000, critical: true, friendlyName: 'Resume Tailoring' },
  'create-checkout': { failureThreshold: 3, resetTimeout: 45000, critical: true, friendlyName: 'Checkout' },
  'stripe-webhook': { failureThreshold: 3, resetTimeout: 30000, critical: true, friendlyName: 'Payment Webhook' },
};

// Track which circuits have already alerted to avoid spam
const alertedCircuits: Set<string> = new Set();

/**
 * Send circuit breaker alert (UI toast + database log)
 */
async function sendCircuitBreakerAlert(
  serviceName: string,
  config: typeof SERVICE_CONFIGS[string],
  lastError?: string
): Promise<void> {
  // Avoid duplicate alerts for the same circuit
  if (alertedCircuits.has(serviceName)) {
    return;
  }
  alertedCircuits.add(serviceName);

  const friendlyName = config.friendlyName || serviceName;
  const isCritical = config.critical !== false;

  // Show toast notification for critical services
  if (isCritical) {
    toast({
      title: `⚠️ ${friendlyName} Unavailable`,
      description: `Service is experiencing issues. Auto-retry in ${Math.round((config.resetTimeout || 30000) / 1000)}s.`,
      variant: "destructive",
      duration: 8000,
    });
  }

  // Log to database for persistent alerting
  try {
    await supabase.rpc('log_error_telemetry', {
      p_error_code: 'CIRCUIT_BREAKER_OPEN',
      p_error_type: 'circuit_breaker',
      p_error_message: `Circuit breaker opened for ${serviceName}`,
      p_function_name: serviceName,
      p_context: JSON.stringify({
        service_name: serviceName,
        friendly_name: friendlyName,
        is_critical: isCritical,
        reset_timeout_ms: config.resetTimeout || 30000,
        last_error: lastError,
        opened_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error('[CircuitBreaker] Failed to log alert:', e);
  }

  // Also log to dedicated alert table if should_send_alert returns true
  try {
    const { data: shouldAlert } = await supabase.rpc('should_send_alert', {
      p_metric_name: `circuit_breaker_${serviceName}`,
      p_alert_type: 'circuit_open',
      p_cooldown_minutes: 15,
    });

    if (shouldAlert) {
      await supabase.rpc('log_alert_sent', {
        p_metric_name: `circuit_breaker_${serviceName}`,
        p_alert_type: 'circuit_open',
        p_threshold: config.failureThreshold || 3,
        p_actual: config.failureThreshold || 3,
        p_sent_to: 'system',
        p_success: true,
      });
    }
  } catch (e) {
    // Non-critical, just log
    console.debug('[CircuitBreaker] Alert logging skipped:', e);
  }
}

/**
 * Clear alert state when circuit recovers
 */
function clearCircuitAlert(serviceName: string): void {
  alertedCircuits.delete(serviceName);
  
  const config = SERVICE_CONFIGS[serviceName] || {};
  const friendlyName = config.friendlyName || serviceName;
  
  // Show recovery toast for critical services
  if (config.critical !== false) {
    toast({
      title: `✅ ${friendlyName} Recovered`,
      description: "Service is back online.",
      duration: 5000,
    });
  }
}

function getServiceConfig(serviceName: string): typeof DEFAULT_CONFIG {
  const customConfig = SERVICE_CONFIGS[serviceName] || {};
  return { ...DEFAULT_CONFIG, ...customConfig };
}

export function getServiceCircuitState(serviceName: string): ServiceCircuitState {
  if (!serviceRegistry.has(serviceName)) {
    const config = getServiceConfig(serviceName);
    serviceRegistry.set(serviceName, {
      state: "closed",
      failures: 0,
      lastFailureTime: null,
      successesInHalfOpen: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      ...config,
    });
  }
  return serviceRegistry.get(serviceName)!;
}

export function recordServiceSuccess(serviceName: string): void {
  const state = getServiceCircuitState(serviceName);
  const wasHalfOpen = state.state === "half-open";
  
  if (state.state === "half-open") {
    state.successesInHalfOpen++;
    state.totalSuccesses++;
    if (state.successesInHalfOpen >= state.halfOpenMaxAttempts) {
      console.log(`[CircuitBreaker:${serviceName}] Circuit CLOSED after recovery`);
      state.state = "closed";
      state.failures = 0;
      state.lastFailureTime = null;
      state.successesInHalfOpen = 0;
      
      // Send recovery alert
      clearCircuitAlert(serviceName);
    }
  } else {
    state.failures = Math.max(0, state.failures - 1);
    state.totalSuccesses++;
  }
}

export function recordServiceFailure(serviceName: string, errorMessage?: string): void {
  const state = getServiceCircuitState(serviceName);
  const wasOpen = state.state === "open";
  
  state.failures++;
  state.totalFailures++;
  state.lastFailureTime = Date.now();
  state.lastError = errorMessage;
  
  if (state.failures >= state.failureThreshold && !wasOpen) {
    console.log(`[CircuitBreaker:${serviceName}] Circuit OPENED after ${state.failures} failures`);
    state.state = "open";
    
    // Send alert for circuit opening
    const config = SERVICE_CONFIGS[serviceName] || {};
    sendCircuitBreakerAlert(serviceName, config, errorMessage);
  }
}

export function canAttemptService(serviceName: string): boolean {
  const state = getServiceCircuitState(serviceName);
  
  if (state.state === "closed") return true;
  
  if (state.state === "open") {
    const timeSinceFailure = Date.now() - (state.lastFailureTime || 0);
    if (timeSinceFailure >= state.resetTimeout) {
      console.log(`[CircuitBreaker:${serviceName}] Moving to half-open state`);
      state.state = "half-open";
      state.successesInHalfOpen = 0;
      return true;
    }
    const remainingSeconds = Math.round((state.resetTimeout - timeSinceFailure) / 1000);
    console.log(`[CircuitBreaker:${serviceName}] Circuit OPEN - blocking call (${remainingSeconds}s until retry)`);
    return false;
  }
  
  return true; // half-open allows attempts
}

export function resetServiceCircuit(serviceName: string): void {
  const config = getServiceConfig(serviceName);
  serviceRegistry.set(serviceName, {
    state: "closed",
    failures: 0,
    lastFailureTime: null,
    successesInHalfOpen: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    ...config,
  });
  console.log(`[CircuitBreaker:${serviceName}] Circuit manually reset`);
}

export function getAllCircuitStates(): Record<string, {
  state: CircuitState;
  failures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
  timeUntilRetry: number | null;
}> {
  const result: Record<string, any> = {};
  
  serviceRegistry.forEach((state, serviceName) => {
    let timeUntilRetry: number | null = null;
    if (state.state === "open" && state.lastFailureTime) {
      const remaining = state.resetTimeout - (Date.now() - state.lastFailureTime);
      timeUntilRetry = remaining > 0 ? remaining : null;
    }
    
    result[serviceName] = {
      state: state.state,
      failures: state.failures,
      totalFailures: state.totalFailures,
      totalSuccesses: state.totalSuccesses,
      lastError: state.lastError,
      timeUntilRetry,
    };
  });
  
  return result;
}

/**
 * Error class thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public serviceName: string,
    public timeUntilRetry: number | null
  ) {
    super(`Circuit breaker open for ${serviceName}`);
    this.name = 'CircuitOpenError';
  }
}
