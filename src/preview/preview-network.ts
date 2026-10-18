/**
 * THE PREVIEW PAGES' NETWORK RULES, imported before anything else so the
 * Supabase client (which keeps the fetch it finds when it is created) is
 * created with this one.
 *
 *   - A preview never reaches a checkout, the billing portal or the
 *     subscription check: those function calls are answered here, in the
 *     browser. create-checkout's GET (the EU/UK switch question PurchaseTerms
 *     asks) answers "off", the shipped default.
 *   - ?fixture=1 answers get_board_vendor_counts with the mockup's read
 *     (1,040,488 open postings, counted 17 Oct 2026 22:45 UTC) so screenshots
 *     compare like with like. Without it the live, read-only call goes out.
 */
const BLOCKED_FUNCTIONS = [
  "create-checkout",
  "create-subscription-checkout",
  "create-portal-session",
  "check-subscription",
  "create-product-checkout",
];

export const PREVIEW_FIXTURE_COUNTS = { sourcesFacet: { workday: 1 }, openTotal: 1040488, as_of: "2026-10-17T22:45:00Z" };

const params = new URLSearchParams(window.location.search);
const fixture = params.get("fixture") === "1";
const realFetch = window.fetch.bind(window);

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const fn = BLOCKED_FUNCTIONS.find((f) => url.includes(`/functions/v1/${f}`));
  if (fn === "create-checkout") return json({ euUkSales: false });
  if (fn) return json({ error: "preview: no checkout from a preview page" }, 403);
  if (fixture && url.includes("/rest/v1/rpc/get_board_vendor_counts")) return json(PREVIEW_FIXTURE_COUNTS);
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;
