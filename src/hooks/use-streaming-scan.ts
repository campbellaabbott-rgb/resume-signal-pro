import { useState, useCallback, useRef } from 'react';
import { parseEdgeFunctionError, ParsedEdgeFunctionError } from '@/lib/edge-function-errors';
import { isNetworkRetryable } from '@/lib/resilient-edge-function';
import { 
  validateResumeBeforeSend, 
  validateExperienceEstimate,
  ResumeValidationResult,
  ExperienceValidationResult 
} from '@/lib/resume-validation';

// Client-side cache configuration
const CLIENT_CACHE_KEY_PREFIX = 'resume_scan_cache_v2_';
const CLIENT_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (reduced from 24)

// Generate cache key from resume text using SHA-256-like robust hash
async function generateClientCacheKey(resumeText: string, jobDescription?: string): Promise<string> {
  // Normalize content for consistent hashing
  const normalized = (resumeText + '|JD|' + (jobDescription || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  
  // Use SubtleCrypto for robust SHA-256 hash (browser native)
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return CLIENT_CACHE_KEY_PREFIX + hashHex.substring(0, 32);
  } catch {
    // Fallback to simple hash if SubtleCrypto unavailable
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return CLIENT_CACHE_KEY_PREFIX + Math.abs(hash).toString(36);
  }
}

// Clear all client-side scan caches (for fresh analysis)
export function clearAllClientScanCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('resume_scan_cache')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log(`[StreamingScan] Cleared ${keysToRemove.length} cached scan results`);
  } catch {
    // Ignore localStorage errors
  }
}

// Get cached result from localStorage
function getClientCachedResult(cacheKey: string): StreamingScanResult | null {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const { result, timestamp, resumePreview } = JSON.parse(cached);
    if (Date.now() - timestamp > CLIENT_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    console.log('[StreamingScan] Client cache HIT for key:', cacheKey.substring(0, 20), 'preview:', resumePreview?.substring(0, 50));
    return result;
  } catch {
    return null;
  }
}

// Store result in localStorage with resume preview for debugging
function setClientCachedResult(cacheKey: string, result: StreamingScanResult, resumePreview: string): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      result,
      timestamp: Date.now(),
      resumePreview: resumePreview.substring(0, 100), // Store first 100 chars for debugging
    }));
    console.log('[StreamingScan] Cached result in localStorage for key:', cacheKey.substring(0, 20));
  } catch (e) {
    console.warn('[StreamingScan] Failed to cache result:', e);
  }
}

export interface StreamProgress {
  stage: string;
  message: string;
  progress: number;
}

export interface StreamingScanState {
  isStreaming: boolean;
  progress: StreamProgress | null;
  error: ParsedEdgeFunctionError | null;
  attempt: number;
  isRetrying: boolean;
  resumeValidation?: ResumeValidationResult;
  experienceValidation?: ExperienceValidationResult;
}

export interface StreamingScanResult {
  success: boolean;
  cached?: boolean;
  rateLimited?: boolean;
  error?: string;
  // Analysis fields
  industry?: string;
  atsScoreEstimate?: number;
  formatGrade?: string;
  formatIssue?: string;
  experienceLevel?: {
    level: 'entry' | 'mid' | 'senior' | 'executive';
    yearsEstimate: string;
  };
  sectionCheck?: {
    hasContact: boolean;
    hasSummary: boolean;
    hasExperience: boolean;
    hasEducation: boolean;
    hasSkills: boolean;
    missingSections: string[];
  };
  topStrength?: {
    title: string;
    description: string;
  };
  redFlags?: { issue: string; impact: string }[];
  keywords?: { keyword: string; reason: string }[];
  quickWins?: { fix: string; timeEstimate: string; impact: 'low' | 'medium' | 'high' }[];
  improvementPotential?: {
    level: 'low' | 'medium' | 'high';
    estimatedScoreIncrease: number;
    topPriority: string;
  };
  // Validation results
  _resumeValidation?: ResumeValidationResult;
  _experienceValidation?: ExperienceValidationResult;
  [key: string]: unknown;
}

interface StreamingScanOptions {
  jobDescriptionText?: string;
  honeypot?: string;
  skipCache?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  onProgress?: (progress: StreamProgress) => void;
  onComplete?: (result: StreamingScanResult) => void;
  onError?: (error: ParsedEdgeFunctionError) => void;
  onRetry?: (attempt: number, delay: number) => void;
  onValidationWarning?: (warning: string) => void;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 2000;

export function useStreamingScan() {
  const [state, setState] = useState<StreamingScanState>({
    isStreaming: false,
    progress: null,
    error: null,
    attempt: 0,
    isRetrying: false,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreamingScan = useCallback(async (
    resumeText: string,
    options?: StreamingScanOptions
  ): Promise<StreamingScanResult | null> => {
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;
    
    // Step 0: Check client-side cache first (instant, 0ms latency)
    const clientCacheKey = await generateClientCacheKey(resumeText, options?.jobDescriptionText);
    
    // If skipCache is true, clear the localStorage cache for this resume
    if (options?.skipCache) {
      try {
        localStorage.removeItem(clientCacheKey);
        console.log('[StreamingScan] Cleared client cache for fresh analysis');
      } catch {
        // Ignore localStorage errors
      }
    } else {
      const cachedResult = getClientCachedResult(clientCacheKey);
      if (cachedResult) {
        setState({
          isStreaming: false,
          progress: { stage: 'complete', message: 'Complete! (cached)', progress: 100 },
          error: null,
          attempt: 0,
          isRetrying: false,
        });
        options?.onComplete?.({ ...cachedResult, cached: true });
        return { ...cachedResult, cached: true };
      }
    }
    
    // Step 1: Pre-send validation - ensure resume text is complete
    const resumeValidation = validateResumeBeforeSend(resumeText);
    console.log('[StreamingScan] Pre-send validation:', resumeValidation);
    
    // Report validation errors
    if (!resumeValidation.isValid) {
      const errorMsg = resumeValidation.errors.join('; ');
      const parsedError: ParsedEdgeFunctionError = {
        title: 'Resume Validation Failed',
        description: errorMsg,
        isRetryable: false,
        errorCode: 'VALIDATION_ERROR',
      };
      setState({
        isStreaming: false,
        progress: null,
        error: parsedError,
        attempt: 0,
        isRetrying: false,
        resumeValidation,
      });
      options?.onError?.(parsedError);
      return null;
    }
    
    // Report validation warnings
    if (resumeValidation.warnings.length > 0) {
      resumeValidation.warnings.forEach(warning => {
        console.warn('[StreamingScan] Validation warning:', warning);
        options?.onValidationWarning?.(warning);
      });
    }
    
    // Abort any existing scan (only if one is actually in progress)
    // Note: Create new controller BEFORE aborting old one to prevent race conditions
    const newAbortController = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = newAbortController;
    
    let lastError: unknown = null;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      // Only create new abort controller for retries, first attempt uses the one we created above
      if (attempt > 1) {
        abortControllerRef.current = new AbortController();
      }
      
      setState({
        isStreaming: true,
        progress: { stage: 'starting', message: attempt > 1 ? `Retrying... (attempt ${attempt})` : 'Starting analysis...', progress: 0 },
        error: null,
        attempt,
        isRetrying: attempt > 1,
        resumeValidation,
      });

      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        
        console.log(`[StreamingScan] Attempt ${attempt}/${maxRetries + 1}`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/free-keyword-scan-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
          body: JSON.stringify({
            resumeText,
            jobDescriptionText: options?.jobDescriptionText,
            honeypot: options?.honeypot,
            skipCache: options?.skipCache,
            language: localStorage.getItem('i18nextLng') || 'en',
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          // Check if this is a retryable error
          const isRetryable = response.status === 408 || 
                             response.status === 429 || 
                             response.status >= 500;
          
          if (isRetryable && attempt <= maxRetries) {
            console.log(`[StreamingScan] HTTP ${response.status}, will retry in ${retryDelay}ms`);
            lastError = new Error(`HTTP error: ${response.status}`);
            options?.onRetry?.(attempt, retryDelay);
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
            continue;
          }
          
          throw new Error(`HTTP error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let result: StreamingScanResult | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE events
          const events = buffer.split('\n\n');
          buffer = events.pop() || ''; // Keep incomplete event in buffer

          for (const eventBlock of events) {
            if (!eventBlock.trim()) continue;
            
            const lines = eventBlock.split('\n');
            let eventType = '';
            let eventData = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7);
              } else if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }

            if (!eventType || !eventData) continue;

            try {
              const parsed = JSON.parse(eventData);

              switch (eventType) {
                case 'progress':
                  const progress: StreamProgress = {
                    stage: parsed.stage,
                    message: parsed.message,
                    progress: parsed.progress,
                  };
                  setState(prev => ({ ...prev, progress, isRetrying: false }));
                  options?.onProgress?.(progress);
                  break;

                case 'complete':
                  result = parsed as StreamingScanResult;
                  console.log(`[StreamingScan] Complete after ${attempt} attempt(s)`);
                  
                  // Step 2: Post-receive validation - check experience estimate consistency
                  let experienceValidation: ExperienceValidationResult | undefined;
                  if (result.experienceLevel?.yearsEstimate) {
                    experienceValidation = validateExperienceEstimate(
                      resumeText,
                      result.experienceLevel.yearsEstimate
                    );
                    
                    // Attach validation results to the result object
                    result._resumeValidation = resumeValidation;
                    result._experienceValidation = experienceValidation;
                    
                    // Report experience validation warning
                    if (!experienceValidation.isConsistent && experienceValidation.warning) {
                      console.warn('[StreamingScan] Experience validation warning:', experienceValidation.warning);
                      options?.onValidationWarning?.(experienceValidation.warning);
                    }
                  }
                  
                  // Cache successful result in localStorage for instant repeat scans
                  if (result.success !== false) {
                    setClientCachedResult(clientCacheKey, result, resumeText);
                  }
                  
                  setState({
                    isStreaming: false,
                    progress: { stage: 'complete', message: 'Complete!', progress: 100 },
                    error: null,
                    attempt,
                    isRetrying: false,
                    resumeValidation,
                    experienceValidation,
                  });
                  options?.onComplete?.(result);
                  break;

                case 'error':
                  const errorMsg = parsed.error || 'Analysis failed';
                  const parsedError: ParsedEdgeFunctionError = {
                    title: parsed.rateLimited ? 'Daily Scan Limit Reached' : 'Analysis Failed',
                    description: errorMsg,
                    isRetryable: false,
                    errorCode: parsed.rateLimited ? 'RATE_LIMITED' : 'ANALYSIS_ERROR',
                  };
                  
                  setState({
                    isStreaming: false,
                    progress: null,
                    error: parsedError,
                    attempt,
                    isRetrying: false,
                  });
                  options?.onError?.(parsedError);
                  
                  // Return rate limit info if present
                  if (parsed.rateLimited) {
                    return { 
                      success: false, 
                      rateLimited: true, 
                      error: errorMsg,
                      ...parsed 
                    };
                  }
                  return null;
              }
            } catch (e) {
              console.warn('[StreamingScan] Failed to parse event:', e);
            }
          }
        }

        return result;

      } catch (error) {
        lastError = error;
        
        if (error instanceof Error && error.name === 'AbortError') {
          setState({
            isStreaming: false,
            progress: null,
            error: null,
            attempt: 0,
            isRetrying: false,
          });
          return null;
        }

        // Check if we should retry
        const shouldRetry = attempt <= maxRetries && isNetworkRetryable(error);
        
        if (shouldRetry) {
          console.log(`[StreamingScan] Network error, retrying in ${retryDelay * attempt}ms`);
          options?.onRetry?.(attempt, retryDelay * attempt);
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          continue;
        }

        // Final failure - parse and return error
        const parsedError = await parseEdgeFunctionError(error, 'free-keyword-scan-stream', true);
        
        console.error(`[StreamingScan] Failed after ${attempt} attempt(s):`, error);
        
        setState({
          isStreaming: false,
          progress: null,
          error: parsedError,
          attempt,
          isRetrying: false,
        });
        options?.onError?.(parsedError);
        return null;
      }
    }

    // All retries exhausted
    const parsedError = await parseEdgeFunctionError(lastError, 'free-keyword-scan-stream', true);
    setState({
      isStreaming: false,
      progress: null,
      error: parsedError,
      attempt: maxRetries + 1,
      isRetrying: false,
    });
    options?.onError?.(parsedError);
    return null;
  }, []);

  const cancelScan = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState({
      isStreaming: false,
      progress: null,
      error: null,
      attempt: 0,
      isRetrying: false,
    });
  }, []);

  return {
    ...state,
    startStreamingScan,
    cancelScan,
  };
}
