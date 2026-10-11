/**
 * fetch-job-posting: a posting link in, the posting's description out, as
 * plain text (sweep S11-032, owner decision 2026-10-11). The scanner's "Job
 * URL" tab calls it; nothing else does.
 *
 * Order, so a refusal costs as little as possible:
 *   1. the link is read and held to the host list (hosts.ts). An unlisted
 *      host answers `unsupported_host` with no meter touched and nothing
 *      fetched: the page asks the person to paste the text;
 *   2. the two meters (budget.ts): per address per hour, then the board's day;
 *   3. the vendor's API for the posting when it has one, else the page's
 *      schema.org JobPosting (extract.ts), every request fenced (net-guard.ts).
 *
 * "Could not read it" answers 200 with ok:false and a reason, so the page can
 * say which; a meter refusal answers 429 (503 when the hourly limiter cannot
 * answer). Logs name the vendor and the outcome, never the link.
 */
import { parseJobUrl } from "./hosts.ts";
import { type Refusal, type SafeFetchDeps, safeFetch } from "./net-guard.ts";
import { apiPlanFor, jobPostingFromHtml, type Posting, vendorPageText } from "./extract.ts";
import { meterFetch, type Rpc } from "./budget.ts";

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rb-budget",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type Outcome =
  | { ok: true; posting: Posting; vendor: string; source: "vendor_api" | "json_ld" | "vendor_page"; url: string }
  | { ok: false; reason: Refusal | "no_description" };

export type HandlerDeps = SafeFetchDeps & { rpc: Rpc; serviceKey: string };

const reply = (body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

/** Read one posting: its API first when the vendor has one, then its page. */
export async function readPosting(url: URL, vendor: string, deps: SafeFetchDeps): Promise<Outcome> {
  const plan = apiPlanFor(url, vendor);
  if (plan) {
    const r = await safeFetch(plan.url, deps, "application/json");
    if (r.ok === true) {
      const p = plan.read(r.body);
      if (p) return { ok: true, posting: p, vendor, source: "vendor_api", url: url.toString() };
    } else if (r.ok === false && (r.reason === "blocked_address" || r.reason === "unsupported_host" || r.reason === "not_https")) {
      // The fence refused the API's host or one of its redirects: the page is
      // on the same vendor, and is not asked.
      return { ok: false, reason: r.reason };
    }
  }
  const page = await safeFetch(url.toString(), deps);
  if (page.ok === false) return { ok: false, reason: page.reason };
  const fromLd = jobPostingFromHtml(page.body);
  if (fromLd) return { ok: true, posting: fromLd, vendor, source: "json_ld", url: url.toString() };
  const fromPage = vendorPageText(page.body, vendor);
  if (fromPage) return { ok: true, posting: fromPage, vendor, source: "vendor_page", url: url.toString() };
  return { ok: false, reason: "no_description" };
}

export async function handleFetchJobPosting(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, reason: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" });
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return reply({ ok: false, reason: "bad_request" }, 400);
  }
  const target = parseJobUrl(body.url);
  if (target.ok === false) {
    console.log(`[FETCH-JOB-POSTING] refused before fetching: ${target.reason}`);
    return reply({ ok: false, reason: target.reason });
  }
  const meter = await meterFetch(req.headers, deps.rpc, deps.serviceKey);
  if (meter.ok === false) {
    console.log(`[FETCH-JOB-POSTING] ${target.vendor}: ${meter.reason}`);
    return reply({ ok: false, reason: meter.reason }, meter.status, { "Retry-After": String(meter.retryAfter), "Access-Control-Expose-Headers": "Retry-After" });
  }
  const out = await readPosting(target.url, target.vendor, deps);
  if (out.ok === false) {
    console.log(`[FETCH-JOB-POSTING] ${target.vendor}: ${out.reason}`);
    return reply({ ok: false, reason: out.reason, vendor: target.vendor });
  }
  console.log(`[FETCH-JOB-POSTING] ${target.vendor}: ${out.source} ${out.posting.text.length} chars`);
  return reply({
    ok: true,
    vendor: out.vendor,
    source: out.source,
    url: out.url,
    title: out.posting.title,
    company: out.posting.company,
    text: out.posting.text,
  });
}
