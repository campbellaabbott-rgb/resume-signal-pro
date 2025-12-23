import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StreamProgress {
  stage: string;
  message: string;
  progress: number;
}

export interface StreamingScanState {
  isStreaming: boolean;
  progress: StreamProgress | null;
  error: string | null;
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
  [key: string]: unknown;
}

export function useStreamingScan() {
  const [state, setState] = useState<StreamingScanState>({
    isStreaming: false,
    progress: null,
    error: null,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreamingScan = useCallback(async (
    resumeText: string,
    options?: {
      jobDescriptionText?: string;
      honeypot?: string;
      skipCache?: boolean;
      onProgress?: (progress: StreamProgress) => void;
      onComplete?: (result: StreamingScanResult) => void;
      onError?: (error: string) => void;
    }
  ): Promise<StreamingScanResult | null> => {
    // Abort any existing scan
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    
    setState({
      isStreaming: true,
      progress: { stage: 'starting', message: 'Starting analysis...', progress: 0 },
      error: null,
    });

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
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
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
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
                setState(prev => ({ ...prev, progress }));
                options?.onProgress?.(progress);
                break;

              case 'complete':
                result = parsed as StreamingScanResult;
                setState({
                  isStreaming: false,
                  progress: { stage: 'complete', message: 'Complete!', progress: 100 },
                  error: null,
                });
                options?.onComplete?.(result);
                break;

              case 'error':
                const errorMsg = parsed.error || 'Analysis failed';
                setState({
                  isStreaming: false,
                  progress: null,
                  error: errorMsg,
                });
                options?.onError?.(errorMsg);
                
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
      if (error instanceof Error && error.name === 'AbortError') {
        setState({
          isStreaming: false,
          progress: null,
          error: null,
        });
        return null;
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState({
        isStreaming: false,
        progress: null,
        error: errorMsg,
      });
      options?.onError?.(errorMsg);
      return null;
    }
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
    });
  }, []);

  return {
    ...state,
    startStreamingScan,
    cancelScan,
  };
}
