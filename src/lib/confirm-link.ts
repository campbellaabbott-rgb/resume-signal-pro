/**
 * Single-use tokens from confirmation links, read from the URL FRAGMENT.
 *
 * The API-key and market-pulse confirmation mails, and the fix-plan button in
 * a report mail, put their token after a "#" (…/data-api#confirm=…,
 * …/market-pulse/confirm#t=…, …/fix-plan/confirm#d=…). A fragment is never
 * sent to a server and never appears in a Referer header, so the token cannot
 * leak into an access log, a CDN log or an analytics hit on the way in.
 */
const TOKEN = "([0-9a-f]{64})";

function fromHash(hash: string, name: string): string | null {
  const m = new RegExp(`(?:^#|&)${name}=${TOKEN}(?:&|$)`).exec(hash);
  return m ? m[1] : null;
}

/** The token in `#confirm=…` (the data-API key link), or null. */
export const apiKeyTokenFromHash = (hash: string): string | null => fromHash(hash, "confirm");

/** The token in `#t=…` (the market-pulse link), or null. */
export const pulseTokenFromHash = (hash: string): string | null => fromHash(hash, "t");

/**
 * The signed plan in `#d=…` (the fix-plan button in a report mail), or null.
 * Not a 64-hex token: the free scan stores nothing, so the link carries the
 * plan itself, signed by the server (supabase/functions/_shared/scan-drip-link.ts).
 */
export function dripTokenFromHash(hash: string): string | null {
  const m = /(?:^#|&)d=([A-Za-z0-9_-]{8,5800}\.[0-9a-f]{64})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}

/** Drop the fragment from the address bar once its token has been spent. */
export function forgetConfirmFragment(): void {
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch { /* cosmetic */ }
}

/**
 * The JSON body of a non-2xx edge-function answer. supabase-js returns
 * data=null for those and puts the Response on error.context, so a page that
 * only reads `data` shows its own generic message instead of the server's.
 */
export async function errorBodyOf(error: unknown): Promise<{ error?: { code?: string; message?: string } | string } | null> {
  const ctx = (error as { context?: unknown } | null)?.context as { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } | undefined;
  if (!ctx) return null;
  try {
    const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
    return (await (res as { json: () => Promise<unknown> }).json()) as { error?: { code?: string; message?: string } | string };
  } catch {
    return null;
  }
}
