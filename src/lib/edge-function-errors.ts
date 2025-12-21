/**
 * Edge Function Error Parser
 * Extracts user-friendly error messages from Supabase edge function errors
 */

import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';

export interface ParsedEdgeFunctionError {
  title: string;
  description: string;
  isRetryable: boolean;
  statusCode?: number;
}

// Known error messages from our backend functions
const ERROR_MESSAGE_MAP: Record<string, { title: string; description: string; isRetryable: boolean }> = {
  'Too many requests. Please try again later.': {
    title: 'Rate limit reached',
    description: 'You\'ve made too many requests. Please wait a few minutes and try again.',
    isRetryable: true,
  },
  'AI service temporarily unavailable. Please try again in a few moments.': {
    title: 'AI service busy',
    description: 'Our AI service is temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
  },
  'Service temporarily unavailable. Please try again later.': {
    title: 'Service unavailable',
    description: 'The service is temporarily unavailable. Please try again shortly.',
    isRetryable: true,
  },
  'Payment verification required.': {
    title: 'Payment required',
    description: 'Please complete payment to access this feature.',
    isRetryable: false,
  },
  'This session has already been used.': {
    title: 'Session expired',
    description: 'This purchase session has already been used. Please contact support if you need help.',
    isRetryable: false,
  },
  'Invalid input provided.': {
    title: 'Invalid input',
    description: 'Please check your input and try again.',
    isRetryable: false,
  },
};

// Status code based fallbacks
const STATUS_CODE_MAP: Record<number, { title: string; description: string; isRetryable: boolean }> = {
  400: {
    title: 'Invalid request',
    description: 'There was a problem with your request. Please check your input and try again.',
    isRetryable: false,
  },
  401: {
    title: 'Authentication required',
    description: 'Please verify your purchase or log in to continue.',
    isRetryable: false,
  },
  402: {
    title: 'Payment required',
    description: 'Please complete payment to access this feature.',
    isRetryable: false,
  },
  403: {
    title: 'Access denied',
    description: 'You don\'t have permission to access this resource.',
    isRetryable: false,
  },
  404: {
    title: 'Not found',
    description: 'The requested resource was not found.',
    isRetryable: false,
  },
  409: {
    title: 'Already processed',
    description: 'This request has already been processed.',
    isRetryable: false,
  },
  429: {
    title: 'Too many requests',
    description: 'You\'ve made too many requests. Please wait a few minutes before trying again.',
    isRetryable: true,
  },
  500: {
    title: 'Server error',
    description: 'Something went wrong on our end. Please try again.',
    isRetryable: true,
  },
  502: {
    title: 'Service unavailable',
    description: 'Our service is temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
  },
  503: {
    title: 'Service busy',
    description: 'Our AI service is currently busy. Please try again in a few moments.',
    isRetryable: true,
  },
  504: {
    title: 'Request timeout',
    description: 'The request took too long. Please try again.',
    isRetryable: true,
  },
};

/**
 * Parse an edge function error into a user-friendly format
 */
export async function parseEdgeFunctionError(error: unknown): Promise<ParsedEdgeFunctionError> {
  // Default fallback
  const defaultError: ParsedEdgeFunctionError = {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Please try again.',
    isRetryable: true,
  };

  if (!error) {
    return defaultError;
  }

  // Handle FunctionsHttpError (non-2xx response)
  if (error instanceof FunctionsHttpError) {
    const statusCode = error.context?.status;
    
    // Try to parse the response body for our custom error message
    try {
      const response = error.context as Response;
      if (response && typeof response.json === 'function') {
        const body = await response.clone().json();
        
        // Check if we have a known error message
        if (body?.error && typeof body.error === 'string') {
          const knownError = ERROR_MESSAGE_MAP[body.error];
          if (knownError) {
            return { ...knownError, statusCode };
          }
          
          // Use the error message from the backend directly if it's user-friendly
          if (body.error.length < 200 && !body.error.includes('Error:')) {
            return {
              title: STATUS_CODE_MAP[statusCode]?.title || 'Error',
              description: body.error,
              isRetryable: STATUS_CODE_MAP[statusCode]?.isRetryable ?? true,
              statusCode,
            };
          }
        }
      }
    } catch {
      // Ignore JSON parse errors, fall through to status code handling
    }
    
    // Fall back to status code mapping
    if (statusCode && STATUS_CODE_MAP[statusCode]) {
      return { ...STATUS_CODE_MAP[statusCode], statusCode };
    }
    
    return { ...defaultError, statusCode };
  }

  // Handle FunctionsFetchError (network error)
  if (error instanceof FunctionsFetchError) {
    return {
      title: 'Connection error',
      description: 'Unable to connect to the server. Please check your internet connection and try again.',
      isRetryable: true,
    };
  }

  // Handle FunctionsRelayError
  if (error instanceof FunctionsRelayError) {
    return {
      title: 'Service error',
      description: 'There was a problem connecting to our service. Please try again.',
      isRetryable: true,
    };
  }

  // Handle generic Error objects
  if (error instanceof Error) {
    // Check for known error messages
    const knownError = ERROR_MESSAGE_MAP[error.message];
    if (knownError) {
      return knownError;
    }
    
    // Check for the generic "Edge Function returned a non-2xx status code" message
    if (error.message.includes('non-2xx status code')) {
      return {
        title: 'Request failed',
        description: 'The request could not be completed. Please try again.',
        isRetryable: true,
      };
    }
    
    // Use the error message if it's reasonably short and user-friendly
    if (error.message.length < 100 && !error.message.includes('Error:') && !error.message.includes('TypeError')) {
      return {
        title: 'Error',
        description: error.message,
        isRetryable: true,
      };
    }
  }

  return defaultError;
}

/**
 * Synchronous version that doesn't attempt to parse response body
 * Use this when you don't need the full error details
 */
export function parseEdgeFunctionErrorSync(error: unknown): ParsedEdgeFunctionError {
  const defaultError: ParsedEdgeFunctionError = {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Please try again.',
    isRetryable: true,
  };

  if (!error) {
    return defaultError;
  }

  if (error instanceof FunctionsHttpError) {
    const statusCode = error.context?.status;
    if (statusCode && STATUS_CODE_MAP[statusCode]) {
      return { ...STATUS_CODE_MAP[statusCode], statusCode };
    }
    return { ...defaultError, statusCode };
  }

  if (error instanceof FunctionsFetchError) {
    return {
      title: 'Connection error',
      description: 'Unable to connect to the server. Please check your internet connection and try again.',
      isRetryable: true,
    };
  }

  if (error instanceof FunctionsRelayError) {
    return {
      title: 'Service error',
      description: 'There was a problem connecting to our service. Please try again.',
      isRetryable: true,
    };
  }

  if (error instanceof Error) {
    const knownError = ERROR_MESSAGE_MAP[error.message];
    if (knownError) {
      return knownError;
    }
    
    if (error.message.includes('non-2xx status code')) {
      return {
        title: 'Request failed',
        description: 'The request could not be completed. Please try again.',
        isRetryable: true,
      };
    }
  }

  return defaultError;
}
