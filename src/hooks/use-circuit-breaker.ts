import { useState, useCallback } from "react";

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
const SERVICE_CONFIGS: Record<string, Partial<typeof DEFAULT_CONFIG>> = {
  'ai-gateway': { failureThreshold: 2, resetTimeout: 60000 },
  'stripe': { failureThreshold: 3, resetTimeout: 45000 },
  'database': { failureThreshold: 5, resetTimeout: 15000 },
  'free-keyword-scan': { failureThreshold: 2, resetTimeout: 60000 },
  'analyze-resume': { failureThreshold: 2, resetTimeout: 60000 },
  'health-check': { failureThreshold: 5, resetTimeout: 10000 },
  'parse-pdf': { failureThreshold: 3, resetTimeout: 30000 },
  'parse-docx': { failureThreshold: 3, resetTimeout: 30000 },
};

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
  
  if (state.state === "half-open") {
    state.successesInHalfOpen++;
    state.totalSuccesses++;
    if (state.successesInHalfOpen >= state.halfOpenMaxAttempts) {
      console.log(`[CircuitBreaker:${serviceName}] Circuit CLOSED after recovery`);
      state.state = "closed";
      state.failures = 0;
      state.lastFailureTime = null;
      state.successesInHalfOpen = 0;
    }
  } else {
    state.failures = Math.max(0, state.failures - 1);
    state.totalSuccesses++;
  }
}

export function recordServiceFailure(serviceName: string, errorMessage?: string): void {
  const state = getServiceCircuitState(serviceName);
  state.failures++;
  state.totalFailures++;
  state.lastFailureTime = Date.now();
  state.lastError = errorMessage;
  
  if (state.failures >= state.failureThreshold) {
    console.log(`[CircuitBreaker:${serviceName}] Circuit OPENED after ${state.failures} failures`);
    state.state = "open";
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
