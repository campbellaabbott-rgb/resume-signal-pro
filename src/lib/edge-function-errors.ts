/**
 * Edge Function Error Parser
 * Extracts user-friendly error messages from Supabase edge function errors
 *
 * IN THE READER'S LANGUAGE (S14X-183). Every title and sentence below is an
 * entry of the edgeErrors namespace (src/i18n/locales/<lng>.json), keyed by
 * the entry's id, with today's English as its default; the sixteen call sites
 * toast the result as it is, so none of them changes. The `code` of an entry
 * is the telemetry value log_error_telemetry records and the error dashboard
 * groups by: it is not the id, and it does not change with the words.
 *
 * WHAT AN ANSWER SAYS, IN THIS ORDER: its machine code (`code`, which the
 * functions send for a busy model, a refused spend and an AI outage), then
 * its sentence (the map below), then its status. A paid analysis that met a
 * busy model was given the upload toast's "hourly limit" sentence, and the AI
 * provider running out of credits reached a past buyer as "Payment required",
 * because the module read only the last two (S14X-109, S14X-110).
 */

import i18next from 'i18next';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface ParsedEdgeFunctionError {
  title: string;
  description: string;
  isRetryable: boolean;
  statusCode?: number;
  errorCode?: string;
}

/** One answer: its edgeErrors id, today's English, and the telemetry code. */
interface Entry { id: string; title: string; description: string; isRetryable: boolean; code: string }

/** The translated title (and sentence), the English default when no string is loaded. */
function tr(key: string, english: string): string {
  try {
    return i18next.isInitialized ? i18next.t(key, { defaultValue: english }) : english;
  } catch {
    return english;
  }
}
const titleOf = (e: Pick<Entry, 'id' | 'title'>) => tr(`edgeErrors.${e.id}.title`, e.title);
const sentenceOf = (e: Pick<Entry, 'id' | 'description'>) => tr(`edgeErrors.${e.id}.description`, e.description);

// Known error messages from our backend functions
const ERROR_MESSAGE_MAP: Record<string, Entry> = {
  'Too many requests. Please try again later.': {
    id: 'rateLimited',
    title: 'Rate limit reached',
    description: 'You\'ve made too many requests. Please wait a few minutes and try again.',
    isRetryable: true,
    code: 'RATE_LIMIT',
  },
  'AI service temporarily unavailable. Please try again in a few moments.': {
    id: 'aiUnavailable',
    title: 'AI service busy',
    description: 'Our AI service is temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
    code: 'AI_UNAVAILABLE',
  },
  'Service temporarily unavailable. Please try again later.': {
    id: 'serviceUnavailable',
    title: 'Service unavailable',
    description: 'The service is temporarily unavailable. Please try again shortly.',
    isRetryable: true,
    code: 'SERVICE_UNAVAILABLE',
  },
  'Payment verification required.': {
    id: 'paymentRequired',
    title: 'Payment required',
    description: 'Please complete payment to access this feature.',
    isRetryable: false,
    code: 'PAYMENT_REQUIRED',
  },
  'This session has already been used.': {
    id: 'sessionUsed',
    title: 'Session expired',
    description: 'This purchase session has already been used. Please contact support if you need help.',
    isRetryable: false,
    code: 'SESSION_USED',
  },
  'Invalid input provided.': {
    id: 'invalidInput',
    title: 'Invalid input',
    description: 'Please check your input and try again.',
    isRetryable: false,
    code: 'INVALID_INPUT',
  },
  'The AI took too long to respond. Please try again.': {
    id: 'aiTimeout',
    title: 'AI timeout',
    description: 'The AI took longer than expected. This usually works on a retry—click the button below to try again.',
    isRetryable: true,
    code: 'AI_TIMEOUT',
  },
  'AI service is temporarily busy. Please try again in a few moments.': {
    id: 'aiBusy',
    title: 'AI busy',
    description: 'Our AI service is handling high demand. Please wait a moment and try again.',
    isRetryable: true,
    code: 'AI_BUSY',
  },
};

/**
 * THE AI PROVIDER OUT OF CREDITS (S14X-109). The gateway answers a 402 when
 * our model provider has no credit left: our outage, never the caller's
 * purchase. Functions not yet rebuilt still pass it on as a 402 with one of
 * these sentences; rebuilt ones answer 503 { code: "ai_unavailable" }. Read
 * only on a 402: the same short sentence is a limiter's 503 elsewhere.
 */
const AI_OUTAGE: Entry = {
  id: 'aiOutage',
  title: 'AI service busy',
  description: 'Our AI service can\'t take requests right now. This is on our side, not a problem with your payment. Please try again in a few minutes.',
  isRetryable: true,
  code: 'AI_UNAVAILABLE',
};
const GATEWAY_402_SENTENCES = new Set([
  'Service temporarily unavailable.',
  'AI service credits depleted. Please try again later.',
  'AI service credits depleted. Please contact support.',
]);

/** A busy model or a limiter that could not be read: a short wait (S14X-110). */
const BUSY_SHORT: Omit<Entry, 'code'> = {
  id: 'busyShort',
  title: 'Busy right now',
  description: 'This is on our side, not a limit you reached. Please try again in a few minutes.',
  isRetryable: true,
};
/** A spend gate shared with everyone, or with your network: a longer wait. */
const BUSY_LONG: Omit<Entry, 'code'> = {
  id: 'busyLong',
  title: 'Too busy for now',
  description: 'This tool has had too many requests for now. Please try again later.',
  isRetryable: true,
};

/**
 * The answer's machine code, read before its sentence. The telemetry code is
 * the one the same answer was counted under before codes were read, except an
 * AI outage, which is counted as one. rate_limited_function is not here: it is
 * the caller's own limit, which the status entry for 429 says.
 */
const CODE_MAP: Record<string, Entry> = {
  ai_unavailable: AI_OUTAGE,
  model_busy: { ...BUSY_SHORT, code: 'AI_BUSY' },
  limiter_unavailable: { ...BUSY_SHORT, code: 'SERVICE_UNAVAILABLE' },
  rate_limited_global: { ...BUSY_LONG, code: 'RATE_LIMIT' },
  rate_limited_network: { ...BUSY_LONG, code: 'RATE_LIMIT' },
  rate_limited_budget: { ...BUSY_LONG, code: 'RATE_LIMIT' },
};

// Status code based fallbacks
const STATUS_CODE_MAP: Record<number, Entry> = {
  400: {
    id: 'status400',
    title: 'Invalid request',
    description: 'There was a problem with your request. Please check your input and try again.',
    isRetryable: false,
    code: 'BAD_REQUEST',
  },
  401: {
    id: 'status401',
    title: 'Authentication required',
    description: 'Please verify your purchase or log in to continue.',
    isRetryable: false,
    code: 'UNAUTHORIZED',
  },
  402: {
    id: 'paymentRequired',
    title: 'Payment required',
    description: 'Please complete payment to access this feature.',
    isRetryable: false,
    code: 'PAYMENT_REQUIRED',
  },
  403: {
    id: 'status403',
    title: 'Access denied',
    description: 'You don\'t have permission to access this resource.',
    isRetryable: false,
    code: 'FORBIDDEN',
  },
  404: {
    id: 'status404',
    title: 'Not found',
    description: 'The requested resource was not found.',
    isRetryable: false,
    code: 'NOT_FOUND',
  },
  409: {
    id: 'status409',
    title: 'Already processed',
    description: 'This request has already been processed.',
    isRetryable: false,
    code: 'CONFLICT',
  },
  // A parser that could not read the file, or a writer that refused its own
  // draft, answers 422 (M-S14-159). Without an entry it was titled "Error".
  422: {
    id: 'status422',
    title: 'Couldn\'t process that',
    description: 'We couldn\'t process what was sent. If it was a file, try a .docx, or paste your résumé text instead.',
    isRetryable: false,
    code: 'UNPROCESSABLE',
  },
  429: {
    id: 'status429',
    title: 'Too many requests',
    // The window is 60 minutes, not "a few". Saying minutes sent people straight
    // back to retry, fail again, and report it as the upload being broken.
    description: 'You\'ve hit the hourly limit. Please try again later, or paste your résumé text instead.',
    isRetryable: true,
    code: 'RATE_LIMIT',
  },
  500: {
    id: 'status500',
    title: 'Server error',
    description: 'Something went wrong on our end. Please try again.',
    isRetryable: true,
    code: 'SERVER_ERROR',
  },
  502: {
    id: 'status502',
    title: 'Service unavailable',
    description: 'Our service is temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
    code: 'BAD_GATEWAY',
  },
  503: {
    id: 'status503',
    title: 'Service busy',
    description: 'Our AI service is currently busy. Please try again in a few moments.',
    isRetryable: true,
    code: 'SERVICE_UNAVAILABLE',
  },
  504: {
    id: 'status504',
    title: 'AI response timeout',
    description: 'The AI took longer than expected to respond. This usually works on a retry—please try again.',
    isRetryable: true,
    code: 'GATEWAY_TIMEOUT',
  },
};

// The answers that are not a function's: no answer at all, the network, the relay.
const UNKNOWN: Entry = { id: 'unknown', title: 'Something went wrong', description: 'An unexpected error occurred. Please try again.', isRetryable: true, code: 'UNKNOWN' };
const NETWORK: Entry = { id: 'network', title: 'Connection error', description: 'Unable to connect to the server. Please check your internet connection and try again.', isRetryable: true, code: 'NETWORK_ERROR' };
const RELAY: Entry = { id: 'relay', title: 'Service error', description: 'There was a problem connecting to our service. Please try again.', isRetryable: true, code: 'RELAY_ERROR' };
const NON_2XX: Entry = { id: 'non2xx', title: 'Request failed', description: 'The request could not be completed. Please try again.', isRetryable: true, code: 'NON_2XX' };
/** The title over a sentence the server wrote itself, when its status has no entry. */
const PLAIN = { id: 'plain', title: 'Error' };

/** Every edgeErrors id this module can answer with: each has a title, and all but "plain" a sentence, in every language. */
export const EDGE_ERROR_IDS: readonly string[] = [...new Set([
  ...Object.values(ERROR_MESSAGE_MAP), ...Object.values(CODE_MAP), ...Object.values(STATUS_CODE_MAP),
  UNKNOWN, NETWORK, RELAY, NON_2XX, PLAIN,
].map((e) => e.id))];

/** An entry, said in the reader's language. */
function said(e: Entry, statusCode?: number): ParsedEdgeFunctionError {
  return {
    title: titleOf(e),
    description: sentenceOf(e),
    isRetryable: e.isRetryable,
    ...(statusCode !== undefined ? { statusCode } : {}),
    errorCode: e.code,
  };
}

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
  if (!error) {
    return said(UNKNOWN);
  }

  let result: ParsedEdgeFunctionError | null = null;

  // Handle FunctionsHttpError (non-2xx response)
  if (error instanceof FunctionsHttpError) {
    const statusCode = error.context?.status;

    // Try to parse the response body for our custom error message
    try {
      const response = error.context as Response;
      if (response && typeof response.json === 'function') {
        const body = await response.clone().json();
        const code = typeof body?.code === 'string' ? body.code : null;
        const sentence = typeof body?.error === 'string' ? body.error : null;

        if (code && Object.prototype.hasOwnProperty.call(CODE_MAP, code)) {
          // The machine code first: it says what happened in every language.
          result = said(CODE_MAP[code], statusCode);
        } else if (sentence !== null && statusCode === 402 && GATEWAY_402_SENTENCES.has(sentence)) {
          result = said(AI_OUTAGE, statusCode);
        } else if (sentence !== null) {
          // Check if we have a known error message
          const knownError = ERROR_MESSAGE_MAP[sentence];
          if (knownError) {
            result = said(knownError, statusCode);
          } else if (sentence.length < 200 && !sentence.includes('Error:')) {
            // Use the error message from the backend directly if it's user-friendly
            const statusInfo = STATUS_CODE_MAP[statusCode];
            result = {
              title: statusInfo ? titleOf(statusInfo) : titleOf(PLAIN),
              description: sentence,
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
    if (!result && statusCode && STATUS_CODE_MAP[statusCode]) {
      result = said(STATUS_CODE_MAP[statusCode], statusCode);
    } else if (!result) {
      result = { ...said(UNKNOWN), statusCode };
    }
  }

  // Handle FunctionsFetchError (network error)
  else if (error instanceof FunctionsFetchError) {
    result = said(NETWORK);
  }

  // Handle FunctionsRelayError
  else if (error instanceof FunctionsRelayError) {
    result = said(RELAY);
  }

  // Handle generic Error objects
  else if (error instanceof Error) {
    // Check for known error messages
    const knownError = ERROR_MESSAGE_MAP[error.message];
    if (knownError) {
      result = said(knownError);
    }
    // Check for the generic "Edge Function returned a non-2xx status code" message
    else if (error.message.includes('non-2xx status code')) {
      result = said(NON_2XX);
    }
    // Use the error message if it's reasonably short and user-friendly
    else if (error.message.length < 100 && !error.message.includes('Error:') && !error.message.includes('TypeError')) {
      result = {
        title: titleOf(PLAIN),
        description: error.message,
        isRetryable: true,
        errorCode: 'GENERIC_ERROR',
      };
    }
  }

  if (!result) result = said(UNKNOWN);

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
  if (!error) {
    return said(UNKNOWN);
  }

  if (error instanceof FunctionsHttpError) {
    const statusCode = error.context?.status;
    if (statusCode && STATUS_CODE_MAP[statusCode]) {
      return said(STATUS_CODE_MAP[statusCode], statusCode);
    }
    return { ...said(UNKNOWN), statusCode };
  }

  if (error instanceof FunctionsFetchError) {
    return said(NETWORK);
  }

  if (error instanceof FunctionsRelayError) {
    return said(RELAY);
  }

  if (error instanceof Error) {
    const knownError = ERROR_MESSAGE_MAP[error.message];
    if (knownError) {
      return said(knownError);
    }

    if (error.message.includes('non-2xx status code')) {
      return said(NON_2XX);
    }
  }

  return said(UNKNOWN);
}
