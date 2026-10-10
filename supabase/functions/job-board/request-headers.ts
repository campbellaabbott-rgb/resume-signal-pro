// The language a Workday request names. index.ts's fetchWithTimeout sends every
// vendor request through withWorkdayLanguage.
// Rationale: docs/job-board-index-notes.md#n437-workday-accept-language

/** The language a Workday CXS request names when the runtime's own is refused (S8-003). */
export const WORKDAY_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const ENGLISH = { "Accept-Language": WORKDAY_ACCEPT_LANGUAGE };

// Per isolate: true = this site refused the runtime's language and answered in
// English; false = it answered the runtime's language.
const siteNeedsEnglish = new Map<string, boolean>();
const MEMO_CAP = 4096;

/** The Workday site a request reads (host + CXS site), or null: another vendor, or a caller naming its own language. */
export function workdaySite(url: string, headers?: HeadersInit): string | null {
  if (headers && new Headers(headers).has("accept-language")) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".myworkdayjobs.com")) return null;
  const m = /^\/wday\/cxs\/[^/]+\/([^/]+)/.exec(u.pathname);
  return m ? `${host}/${m[1].toLowerCase()}` : host;
}

function remember(site: string, english: boolean): void {
  if (siteNeedsEnglish.size >= MEMO_CAP && !siteNeedsEnglish.has(site)) siteNeedsEnglish.clear();
  siteNeedsEnglish.set(site, english);
}

/**
 * Send one request, naming a language only where the runtime's is refused.
 *
 * Deno's fetch sends `Accept-Language: *` when the caller names none. Most
 * Workday tenants answer it in their own default language (Desjardins and
 * CBC/Radio-Canada in French), and what the board stores was read that way;
 * some tenants with no such language answer it with HTTP 500 (Truist, Geico,
 * 7-Eleven, WVU Medicine; 200 under en-US). So: the runtime's language first,
 * and English only after a 500 from a site not already seen answering it.
 * A site's answer is remembered for the isolate, so an English-only tenant
 * pays its one refused request once, and a tenant seen answering the default
 * is never re-read in English after a passing 500.
 */
export async function withWorkdayLanguage(
  url: string,
  headers: HeadersInit | undefined,
  send: (lang: Record<string, string>) => Promise<Response>,
  discard: (res: Response) => void,
): Promise<Response> {
  const site = workdaySite(url, headers);
  if (!site) return send({});
  const known = siteNeedsEnglish.get(site);
  if (known) return send(ENGLISH);
  const res = await send({});
  if (res.ok) { remember(site, false); return res; }
  if (res.status !== 500 || known === false) return res;
  const en = await send(ENGLISH);
  if (!en.ok) { discard(en); return res; }
  discard(res);
  remember(site, true);
  return en;
}
