/**
 * AN UNSUBSCRIBE IS A BUTTON ON OUR SITE, AND A ONE-CLICK POST FROM THE MAIL
 * CLIENT -- NEVER A BARE GET (register L10-14).
 *
 * The three mailers' unsubscribe links pointed at their own function on
 * <project>.supabase.co, which unsubscribed on GET and answered an HTML page.
 * Supabase serves a function's HTML as text/plain on that domain, so a person
 * saw raw markup; and corporate link scanners (Safe Links and the like) follow
 * every link in a mail before it is read, so a GET that unsubscribes turned
 * digests off for people who never asked.
 *
 * Now:
 *   - the link in the mail opens /email/unsubscribe on resumebooster.work,
 *     which says what will stop and acts only when its button is pressed
 *     (the token rides in the fragment, which no server or Referer sees);
 *   - the mail carries List-Unsubscribe and List-Unsubscribe-Post (RFC 8058),
 *     so a mail client's own unsubscribe button POSTs to the function;
 *   - a GET on the function (every link in mail already sent) changes nothing
 *     and redirects to the confirm page.
 */
export const SITE_URL = "https://resumebooster.work";

export type UnsubscribeList = "search-digest" | "market-pulse" | "scan-report";

/** The confirm page on our own domain, the parameters in the fragment. */
export function unsubscribePageUrl(list: UnsubscribeList, params: Record<string, string>): string {
  const frag = new URLSearchParams({ list, ...params });
  return `${SITE_URL}/email/unsubscribe#${frag.toString()}`;
}

/** The function URL a mail client POSTs to (RFC 8058). */
export function oneClickUrl(supabaseUrl: string, fn: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ action: "unsubscribe", ...params });
  return `${supabaseUrl}/functions/v1/${fn}?${q.toString()}`;
}

/** The two headers that give the mail client a one-click unsubscribe. */
export function oneClickHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/** A GET changes nothing: it sends the person to the page with the button. */
export function redirectToConfirm(list: UnsubscribeList, params: Record<string, string>): Response {
  return new Response(null, { status: 303, headers: { Location: unsubscribePageUrl(list, params), "Cache-Control": "no-store" } });
}

/**
 * The unsubscribe parameters of a POST: the query string (a mail client's
 * one-click POST carries them there) or a JSON body {action:"unsubscribe", ...}
 * (the confirm page). null when the request is not an unsubscribe.
 */
export async function unsubscribeParams(req: Request, url: URL): Promise<Record<string, string> | null> {
  if (url.searchParams.get("action") === "unsubscribe") {
    const out: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (k !== "action") out[k] = v;
    return out;
  }
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  const body = await req.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || (body as { action?: unknown }).action !== "unsubscribe") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k !== "action" && typeof v === "string") out[k] = v;
  }
  return out;
}
