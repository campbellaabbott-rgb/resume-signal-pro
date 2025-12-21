/**
 * Edge Function Error Parser
 * Extracts user-friendly error messages from Supabase edge function errors
 */

import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface ParsedEdgeFunctionError {
  title: string;
  description: string;
  isRetryable: boolean;
  statusCode?: number;
  errorCode?: string;
}

// Known error messages from our backend functions
const ERROR_MESSAGE_MAP: Record<string, { title: string; description: string; isRetryable: boolean; code: string }> = {
  'Too many requests. Please try again later.': {
    title: 'Rate limit reached',
    description: 'You\'ve made too many requests. Please wait a few minutes and try again.',
    isRetryable: true,
    code: 'RATE_LIMIT',
  },
  'AI service temporarily unavailable. Please try again in a few moments.': {
    title: 'AI service busy',
    description: 'Our AI service is temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
    code: 'AI_UNAVAILABLE',
  },
  'Service temporarily unavailable. Please try again later.': {
    title: 'Service unavailable',
    description: 'The service is temporarily unavailable. Please try again shortly.',
    isRetryable: true,
    code: 'SERVICE_UNAVAILABLE',
  },
  'Payment verification required.': {
    title: 'Payment required',
    description: 'Please complete payment to access this feature.',
    isRetryable: false,
    code: 'PAYMENT_REQUIRED',
  },
  'This session has already been used.': {
    title: 'Session expired',
    description: 'This purchase session has already been used. Please contact support if you need help.',
    isRetryable: false,
    code: 'SESSION_USED',
  },
  'Invalid input provided.': {
    title: 'Invalid input',
    description: 'Please check your input and try again.',
    isRetryable: false,
    code: 'INVALID_INPUT',
  },
};

// Status code based fallbacks
const STATUS_CODE_MAP: Record<number, { title: string; description: string; isRetryable: boolean; code: string }> = {
  400: {
    title: 'Invalid request',
    description: 'There was a problem with your request. Please check your input and try again.',
    isRetryable: false,
    code: 'BAD_REQUEST',
  },
  401: {
    title: 'Authentication required',
    description: 'Please verify your purchase or log in to continue.',
    isRetryable: false,
    code: 'UNAUTHORIZED',
  },
  402: {
    title: 'Payment required',
    description: 'Please complete payment to access this feature.',
    isRetryable: false,
    code: 'PAYMENT_REQUIRED',
  },
  403: {
    title: 'Access denied',
    description: 'You don\'t have permission to access this resource.',
    isRetryable: false,
    code: 'FORBIDDEN',
  },
  404: {
    title: 'Not found',
    description: 'The requested resource was not found.',
    isRetryable: false,
    code: 'NOT_FOUND',
  },
  409: {
    title: 'Already processed',
    description: 'This request has already been processed.',
    isRetryable: false,
    code: 'CONFLICT',
  },
  429: {
    title: 'Too many requests',
    description: 'You\'ve made too many requests. Please wait a few minutes before trying again.',
    isRetryable: true,
    code: 'RATE_LIMIT',
  },
  500: {
    title: 'Server error',
    description: 'Something went wrong on our end. Please try again.',
    isRetryable: true,
    code: 'SERVER_ERROR',
  },
  502: {
    title: 'Service unavailable',
    description: 'Our service is temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
    code: 'BAD_GATEWAY',
  },
  503: {
    title: 'Service busy',
    description: 'Our AI service is currently busy. Please try again in a few moments.',
    isRetryable: true,
    code: 'SERVICE_UNAVAILABLE',
  },
  504: {
    title: 'Request timeout',
    description: 'The request took too long. Please try again.',
    isRetryable: true,
    code: 'GATEWAY_TIMEOUT',
  },
};

/**
 * Track an error to telemetry (fire-and-forget)
 */
async function trackError(
  errorCode: string,
  errorType: string,
  errorMessage?: string,
  httpStatus?: number,
  functionName?: string
): Promise<void> {
  try {
    await supabase.rpc('log_error_telemetry', {
      p_error_code: errorCode,
      p_error_type: errorType,
      p_error_message: errorMessage || null,
      p_http_status: httpStatus || null,
      p_function_name: functionName || null,
      p_context: null,
    });
  } catch {
    // Silently fail - don't let telemetry errors affect user experience
    console.debug('Error telemetry failed (non-critical)');
  }
}

/**
 * Parse an edge function error into a user-friendly format
 * @param error - The error to parse
 * @param functionName - Optional function name for telemetry tracking
 * @param enableTelemetry - Whether to track this error (default: true)
 */
export async function parseEdgeFunctionError(
  error: unknown,
  functionName?: string,
  enableTelemetry = true
): Promise<ParsedEdgeFunctionError> {
  // Default fallback
  const defaultError: ParsedEdgeFunctionError = {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Please try again.',
    isRetryable: true,
    errorCode: 'UNKNOWN',
  };

  if (!error) {
    return defaultError;
  }

  let result: ParsedEdgeFunctionError = defaultError;

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
            result = { 
              title: knownError.title, 
              description: knownError.description, 
              isRetryable: knownError.isRetryable, 
              statusCode, 
              errorCode: knownError.code 
            };
          } else if (body.error.length < 200 && !body.error.includes('Error:')) {
            // Use the error message from the backend directly if it's user-friendly
            const statusInfo = STATUS_CODE_MAP[statusCode];
            result = {
              title: statusInfo?.title || 'Error',
              description: body.error,
              isRetryable: statusInfo?.isRetryable ?? true,
              statusCode,
              errorCode: statusInfo?.code || 'BACKEND_ERROR',
            };
          }
        }
      }
    } catch {
      // Ignore JSON parse errors, fall through to status code handling
    }
    
    // Fall back to status code mapping if no result set
    if (result === defaultError && statusCode && STATUS_CODE_MAP[statusCode]) {
      const statusInfo = STATUS_CODE_MAP[statusCode];
      result = { 
        title: statusInfo.title, 
        description: statusInfo.description, 
        isRetryable: statusInfo.isRetryable, 
        statusCode, 
        errorCode: statusInfo.code 
      };
    } else if (result === defaultError) {
      result = { ...defaultError, statusCode };
    }
  }

  // Handle FunctionsFetchError (network error)
  else if (error instanceof FunctionsFetchError) {
    result = {
      title: 'Connection error',
      description: 'Unable to connect to the server. Please check your internet connection and try again.',
      isRetryable: true,
      errorCode: 'NETWORK_ERROR',
    };
  }

  // Handle FunctionsRelayError
  else if (error instanceof FunctionsRelayError) {
    result = {
      title: 'Service error',
      description: 'There was a problem connecting to our service. Please try again.',
      isRetryable: true,
      errorCode: 'RELAY_ERROR',
    };
  }

  // Handle generic Error objects
  else if (error instanceof Error) {
    // Check for known error messages
    const knownError = ERROR_MESSAGE_MAP[error.message];
    if (knownError) {
      result = { 
        title: knownError.title, 
        description: knownError.description, 
        isRetryable: knownError.isRetryable, 
        errorCode: knownError.code 
      };
    }
    // Check for the generic "Edge Function returned a non-2xx status code" message
    else if (error.message.includes('non-2xx status code')) {
      result = {
        title: 'Request failed',
        description: 'The request could not be completed. Please try again.',
        isRetryable: true,
        errorCode: 'NON_2XX',
      };
    }
    // Use the error message if it's reasonably short and user-friendly
    else if (error.message.length < 100 && !error.message.includes('Error:') && !error.message.includes('TypeError')) {
      result = {
        title: 'Error',
        description: error.message,
        isRetryable: true,
        errorCode: 'GENERIC_ERROR',
      };
    }
  }

  // Track error to telemetry (fire-and-forget)
  if (enableTelemetry) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    trackError(
      result.errorCode || 'UNKNOWN',
      error instanceof FunctionsHttpError ? 'http' : 
        error instanceof FunctionsFetchError ? 'network' : 
        error instanceof FunctionsRelayError ? 'relay' : 'unknown',
      errorMessage,
      result.statusCode,
      functionName
    );
  }

  return result;
}

/**
 * Synchronous version that doesn't attempt to parse response body
 * Use this when you don't need the full error details
 * Note: Does not track telemetry
 */
export function parseEdgeFunctionErrorSync(error: unknown): ParsedEdgeFunctionError {
  const defaultError: ParsedEdgeFunctionError = {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Please try again.',
    isRetryable: true,
    errorCode: 'UNKNOWN',
  };

  if (!error) {
    return defaultError;
  }

  if (error instanceof FunctionsHttpError) {
    const statusCode = error.context?.status;
    if (statusCode && STATUS_CODE_MAP[statusCode]) {
      const statusInfo = STATUS_CODE_MAP[statusCode];
      return { 
        title: statusInfo.title, 
        description: statusInfo.description, 
        isRetryable: statusInfo.isRetryable, 
        statusCode, 
        errorCode: statusInfo.code 
      };
    }
    return { ...defaultError, statusCode };
  }

  if (error instanceof FunctionsFetchError) {
    return {
      title: 'Connection error',
      description: 'Unable to connect to the server. Please check your internet connection and try again.',
      isRetryable: true,
      errorCode: 'NETWORK_ERROR',
    };
  }

  if (error instanceof FunctionsRelayError) {
    return {
      title: 'Service error',
      description: 'There was a problem connecting to our service. Please try again.',
      isRetryable: true,
      errorCode: 'RELAY_ERROR',
    };
  }

  if (error instanceof Error) {
    const knownError = ERROR_MESSAGE_MAP[error.message];
    if (knownError) {
      return { 
        title: knownError.title, 
        description: knownError.description, 
        isRetryable: knownError.isRetryable, 
        errorCode: knownError.code 
      };
    }
    
    if (error.message.includes('non-2xx status code')) {
      return {
        title: 'Request failed',
        description: 'The request could not be completed. Please try again.',
        isRetryable: true,
        errorCode: 'NON_2XX',
      };
    }
  }

  return defaultError;
}
