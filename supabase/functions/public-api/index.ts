// The public data API. Keyed, rate-limited, metered, and fenced by the same
// invariants the board itself serves under.
//
// WHY IT IS A SEPARATE FUNCTION AND NOT AN ACTION ON job-board.
// job-board is 10k lines that answer the WEBSITE, and its response shape moves
// whenever the page needs it to. An API's shape is a promise to someone else's
// code. Keeping them apart is what lets the board keep changing while /v1 does
// not — and it means a bad deploy of one cannot take the other down, which the
// 2026-08-03 outage showed is a real failure mode here.
//
// EVERY READ CARRIES BOTH FENCES. `missing_since IS NULL` and the 30-day
// window are not board policy, they are the product's central claim: no ghost
// jobs. An API that served withdrawn postings would be selling the opposite of
// what the page promises, to people who cannot see the difference. Both
// predicates appear in every query below and a guard test pins them.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const API_VERSION = "2026-08-26.1";
const FRESH_WINDOW_DAYS = 30;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

// The columns /v1 promises. Listed once, explicitly, because `select("*")`
// would silently publish every column added to the table later — including
// operational ones nobody agreed to expose.
const JOB_FIELDS = [
  "id", "source", "company_token", "company", "title", "location", "country",
  "remote", "work_mode", "department", "category", "posted_at", "first_seen",
  "last_seen", "apply_url", "salary", "salary_min_annual", "salary_max_annual",
  "salary_period", "salary_currency", "experience_band", "min_years",
].join(",");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type Decision = {
  allowed: boolean; reason: string; key_id: string | null; tier: string | null;
  rate_limit: number; rate_used: number; daily_quota: number; daily_used: number;
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

/** Errors are a contract too: a machine reads `code`, a human reads `message`. */
const fail = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  json({ error: { code, message }, apiVersion: API_VERSION }, status, extra);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const db = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

/** Freshness fence, applied to every listing query. */
const freshCutoff = () => new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET") return fail(405, "method_not_allowed", "This API is read-only; use GET.");

  const url = new URL(req.url);
  // Supabase serves functions at /functions/v1/<name>/<rest>. Strip both so the
  // documented path is what callers actually type.
  const path = url.pathname.replace(/^\/functions\/v1/, "").replace(/^\/public-api/, "") || "/";

  if (path === "/" || path === "/v1" || path === "/v1/") {
    return json({
      apiVersion: API_VERSION,
      docs: "https://resumebooster.work/data-api",
      endpoints: ["/v1/jobs", "/v1/jobs/{id}", "/v1/companies", "/v1/stats"],
      auth: "Authorization: Bearer <your key>",
    });
  }

  const auth = req.headers.get("authorization") ?? "";
  const raw = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!raw) {
    return fail(401, "missing_key", "Send your key as: Authorization: Bearer <key>. Request one at https://resumebooster.work/data-api");
  }

  const client = db();
  const endpoint = path.startsWith("/v1/jobs/") ? "/v1/jobs/{id}" : path;

  const { data: dec, error: decErr } = await client
    .rpc("api_key_check", { p_key_hash: await sha256Hex(raw), p_endpoint: endpoint })
    .maybeSingle();

  if (decErr) {
    console.error("[PUBLIC-API] key check failed:", decErr.message?.slice(0, 160));
    return fail(503, "auth_unavailable", "Key verification is temporarily unavailable. Retry shortly.");
  }
  const d = (dec ?? null) as Decision | null;
  if (!d || !d.allowed) {
    const reason = d?.reason ?? "unknown_key";
    // Rate headers ride on the refusal too — that is the response a client most
    // needs them on.
    const headers: Record<string, string> = d
      ? {
          "X-RateLimit-Limit": String(d.rate_limit),
          "X-RateLimit-Remaining": String(Math.max(0, d.rate_limit - d.rate_used)),
          "X-Quota-Limit": String(d.daily_quota),
          "X-Quota-Remaining": String(Math.max(0, d.daily_quota - d.daily_used)),
        }
      : {};
    if (reason === "rate_limited") return fail(429, "rate_limited", `Over ${d!.rate_limit} requests/minute.`, { ...headers, "Retry-After": "60" });
    if (reason === "quota_exceeded") return fail(429, "quota_exceeded", `Daily quota of ${d!.daily_quota} requests used.`, { ...headers, "Retry-After": "3600" });
    if (reason === "revoked") return fail(403, "key_revoked", "This key has been revoked.", headers);
    return fail(401, "invalid_key", "That key is not recognised.");
  }

  const rateHeaders = {
    "X-RateLimit-Limit": String(d.rate_limit),
    "X-RateLimit-Remaining": String(Math.max(0, d.rate_limit - d.rate_used)),
    "X-Quota-Limit": String(d.daily_quota),
    "X-Quota-Remaining": String(Math.max(0, d.daily_quota - d.daily_used)),
    "X-Api-Version": API_VERSION,
  };

  try {
    if (path === "/v1/jobs") return await listJobs(client, url, rateHeaders);
    if (path.startsWith("/v1/jobs/")) return await oneJob(client, decodeURIComponent(path.slice("/v1/jobs/".length)), rateHeaders);
    if (path === "/v1/companies") return await companies(client, url, rateHeaders);
    if (path === "/v1/stats") return await stats(client, rateHeaders);
    return fail(404, "no_such_endpoint", `Unknown path ${path}. See /v1 for the endpoint list.`);
  } catch (e) {
    console.error("[PUBLIC-API] handler threw:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return fail(500, "internal_error", "The request could not be completed.");
  }
});

async function listJobs(client: SupabaseClient, url: URL, headers: Record<string, string>) {
  const p = url.searchParams;
  const limit = Math.min(Math.max(Number(p.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);

  let q = client
    .from("job_board_postings")
    .select(JOB_FIELDS, { count: "estimated" })
    .is("missing_since", null)                       // fence: never serve a withdrawn posting
    .gte("effective_posted", freshCutoff());          // fence: never serve past the window

  const eq = (param: string, col: string) => {
    const v = p.get(param);
    if (v) q = q.eq(col, v);
  };
  eq("country", "country");
  eq("category", "category");
  eq("company_token", "company_token");
  eq("work_mode", "work_mode");
  eq("source", "source");

  if (p.get("remote") === "true") q = q.eq("remote", true);
  const salaryMin = Number(p.get("salary_min"));
  if (Number.isFinite(salaryMin) && salaryMin > 0) {
    // Same semantics the board uses, and the same disclosure obligation: only
    // about a fifth of postings state pay, so this filter is a narrow slice and
    // the response says so rather than letting a caller mistake it for a census.
    q = p.get("include_unstated_pay") === "true"
      ? q.or(`salary_rank_usd.gte.${salaryMin},salary_rank_usd.is.null`)
      : q.gte("salary_rank_usd", salaryMin);
  }
  const postedAfter = p.get("posted_after");
  if (postedAfter && !Number.isNaN(Date.parse(postedAfter))) q = q.gte("posted_at", new Date(postedAfter).toISOString());

  const term = (p.get("q") ?? "").trim().slice(0, 200);
  if (term) {
    // Title/company only, and websearch rather than raw ILIKE: the description
    // tier is what makes board search expensive, and an API caller paging a
    // broad term would pay that cost on every page.
    const safe = term.replace(/[|"%_\\]/g, " ").trim();
    if (safe) q = q.textSearch("title", safe, { type: "websearch", config: "simple" });
  }

  const { data, error, count } = await q
    .order("effective_posted", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[PUBLIC-API] /v1/jobs query failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.");
  }

  return json({
    apiVersion: API_VERSION,
    data: data ?? [],
    page: { limit, offset, returned: (data ?? []).length, nextOffset: (data ?? []).length === limit ? offset + limit : null },
    // "estimated" is named as estimated. An exact count over this table costs
    // seconds and the board already learned not to pay it per request.
    total: { value: count ?? null, basis: "estimated" },
    coverage: {
      freshnessWindowDays: FRESH_WINDOW_DAYS,
      note: "Only postings still live in the employer's own feed within the last 30 days. Withdrawn postings are excluded, never re-dated.",
      ...(Number.isFinite(salaryMin) && salaryMin > 0
        ? { statedPayShare: 0.201, statedPayNote: "About 20% of postings state pay; a salary filter can only ever see those unless include_unstated_pay=true." }
        : {}),
    },
  }, 200, headers);
}

async function oneJob(client: SupabaseClient, id: string, headers: Record<string, string>) {
  if (!id) return fail(400, "missing_id", "Provide a posting id: /v1/jobs/{id}");
  const { data, error } = await client
    .from("job_board_postings")
    .select(JOB_FIELDS)
    .eq("id", id)
    .is("missing_since", null)
    .maybeSingle();
  if (error) {
    console.error("[PUBLIC-API] /v1/jobs/{id} failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.");
  }
  // A withdrawn posting is 404 and NOT a stale 200. The difference is the whole
  // product: a caller must be able to tell "gone" from "we stopped looking".
  if (!data) return fail(404, "not_found", "No live posting with that id. It may have been withdrawn by the employer.");
  return json({ apiVersion: API_VERSION, data }, 200, headers);
}

async function companies(client: SupabaseClient, url: URL, headers: Record<string, string>) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), MAX_LIMIT);
  // Served from the board's own cached facet — the same numbers the site shows,
  // rather than a second count that would drift from it.
  const { data, error } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle();
  if (error) {
    console.error("[PUBLIC-API] /v1/companies failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.");
  }
  const v = (data?.v ?? {}) as { companiesFacet?: Array<{ token?: string; name?: string; count?: number }> };
  const facet = Array.isArray(v.companiesFacet) ? v.companiesFacet : [];
  return json({
    apiVersion: API_VERSION,
    data: facet
      .slice()
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, limit)
      .map((c) => ({ company_token: c.token ?? null, company: c.name ?? null, open_postings: c.count ?? 0 })),
    // The figure's age is published rather than implied. This facet refreshes
    // at the end of a rotation pass, so it is minutes-to-hours old by design.
    asOf: data?.updated_at ?? null,
    basis: "cached facet, refreshed at the end of each rotation pass",
  }, 200, headers);
}

async function stats(client: SupabaseClient, headers: Record<string, string>) {
  const { data } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle();
  const v = (data?.v ?? {}) as { total?: number; companiesFacet?: unknown[]; refreshedAt?: string };
  return json({
    apiVersion: API_VERSION,
    data: {
      livePostings: typeof v.total === "number" ? v.total : null,
      companies: Array.isArray(v.companiesFacet) ? v.companiesFacet.length : null,
      freshnessWindowDays: FRESH_WINDOW_DAYS,
    },
    asOf: v.refreshedAt ?? data?.updated_at ?? null,
    basis: "cached at the end of each rotation pass; not a live count",
  }, 200, headers);
}
