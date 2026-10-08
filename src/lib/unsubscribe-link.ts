/**
 * The unsubscribe link in our mails, read from the URL FRAGMENT of
 * /email/unsubscribe (supabase/functions/_shared/unsubscribe-link.ts writes it).
 *
 * A fragment is never sent to a server and never appears in a Referer header,
 * so the token cannot leak into an access log on the way in. The page acts
 * only when its button is pressed: link scanners open every link in a mail,
 * and an unsubscribe a scanner's prefetch could perform would not be the
 * person's choice (register L10-14).
 */
export type UnsubscribeList = "search-digest" | "market-pulse" | "scan-report";

export type UnsubscribeTarget = {
  list: UnsubscribeList;
  /** The edge function that unsubscribes this list. */
  fn: "send-search-digest" | "send-market-pulse" | "send-scan-report";
  params: Record<string, string>;
};

const HEX32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** What the fragment asks to stop, or null when it is not one of our links. */
export function unsubscribeFromHash(hash: string): UnsubscribeTarget | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const token = p.get("token") ?? "";
  if (!HEX32.test(token)) return null;
  switch (p.get("list")) {
    case "search-digest": {
      const id = p.get("id") ?? "";
      return UUID.test(id) ? { list: "search-digest", fn: "send-search-digest", params: { id, token } } : null;
    }
    case "market-pulse": {
      const email = p.get("email") ?? "";
      return EMAIL.test(email) ? { list: "market-pulse", fn: "send-market-pulse", params: { email, token } } : null;
    }
    case "scan-report":
      return { list: "scan-report", fn: "send-scan-report", params: { token } };
    default:
      return null;
  }
}
