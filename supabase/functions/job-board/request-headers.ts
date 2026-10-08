// Headers a vendor needs that the runtime will not send for us. Pure: index.ts
// merges these under the caller's own headers in fetchWithTimeout.
// Rationale: docs/job-board-index-notes.md#n437-workday-accept-language

/** The language a Workday CXS request names (S8-003). */
export const WORKDAY_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

/**
 * Default headers for one vendor request, by the host it goes to.
 *
 * Deno's fetch, like Node's, sends `Accept-Language: *` when the caller names
 * none, and some Workday tenants answer that with HTTP 500 (Truist, Geico,
 * 7-Eleven, WVU Medicine; measured 2026-10-08, 200 under en-US). Workday only:
 * another vendor may answer a named language with translated descriptions.
 */
export function vendorDefaultHeaders(url: string): Record<string, string> {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return {}; }
  return host.endsWith(".myworkdayjobs.com") ? { "Accept-Language": WORKDAY_ACCEPT_LANGUAGE } : {};
}
