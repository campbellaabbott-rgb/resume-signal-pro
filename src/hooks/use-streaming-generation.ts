import { useState, useCallback, useRef } from 'react';

interface StreamingState {
  isStreaming: boolean;
  content: string;
  error: string | null;
  isComplete: boolean;
}

interface UseStreamingGenerationOptions {
  onContent?: (chunk: string, fullContent: string) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: string) => void;
}

export function useStreamingGeneration(options: UseStreamingGenerationOptions = {}) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    content: '',
    error: null,
    isComplete: false,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>
  ) => {
    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    setState({
      isStreaming: true,
      content: '',
      error: null,
      isComplete: false,
    });

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);
              
              if (event.type === 'content' && event.content) {
                fullContent += event.content;
                setState(prev => ({
                  ...prev,
                  content: fullContent,
                }));
                options.onContent?.(event.content, fullContent);
              } else if (event.type === 'complete' || event.type === 'done') {
                setState(prev => ({
                  ...prev,
                  isStreaming: false,
                  isComplete: true,
                }));
                options.onComplete?.(fullContent);
              } else if (event.type === 'error') {
                throw new Error(event.message || 'Stream error');
              }
            } catch (parseError) {
              // Ignore JSON parse errors for incomplete data
              console.debug('SSE parse skip:', jsonStr.substring(0, 50));
            }
          }
        }
      }

      // Ensure complete state is set
      setState(prev => ({
        ...prev,
        isStreaming: false,
        isComplete: true,
      }));

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Stream was intentionally aborted
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: errorMessage,
      }));
      options.onError?.(errorMessage);
    }
  }, [options]);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isStreaming: false,
    }));
  }, []);

  const reset = useCallback(() => {
    stopStream();
    setState({
      isStreaming: false,
      content: '',
      error: null,
      isComplete: false,
    });
  }, [stopStream]);

  return {
    ...state,
    startStream,
    stopStream,
    reset,
  };
}
