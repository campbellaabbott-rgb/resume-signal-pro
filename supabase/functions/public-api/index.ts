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
// OFFSET IS CAPPED BECAUSE POSTGRES IMPLEMENTS IT BY WALKING AND DISCARDING.
//
// Measured on this endpoint before the cursor existed: offset 0 answered in
// 0.7s, offset 100,000 in 8.7s. It returned 200 the whole way, which is what
// makes it dangerous — nothing fails, the database just does more work per page
// the deeper a caller goes, and walking a corpus is the FIRST thing an API
// consumer does. The board took a real outage from this shape (offset 583,921
// -> HTTP 500 after 9.1s) and answers it with a keyset cursor; so does this.
//
// Offset is kept, and kept working, up to the depth where it is still cheap:
// breaking existing callers to fix a performance cliff they may never have hit
// would be its own regression. Past the cap the error names the cursor.
const MAX_OFFSET = 10_000;

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

// Field names mirror the RPC's OUT parameters, which were RENAMED in
// 20260826161200. They are deliberately not `key_id`/`tier`/`daily_quota`: those
// are real columns of the tables the function touches, and a plpgsql OUT
// parameter that shares a column name made every authenticated call fail with
// 42702 "column reference is ambiguous".
type Decision = {
  is_allowed: boolean; deny_reason: string; api_key_id: string | null; key_tier: string | null;
  rate_limit: number; rate_used: number; quota_limit: number; quota_used: number;
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
      endpoints: ["/v1/jobs", "/v1/jobs/{id}", "/v1/changes", "/v1/companies", "/v1/stats", "/v1/usage"],
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
  if (!d || !d.is_allowed) {
    const reason = d?.deny_reason ?? "unknown_key";
    // Rate headers ride on the refusal too — that is the response a client most
    // needs them on.
    const headers: Record<string, string> = d
      ? {
          "X-RateLimit-Limit": String(d.rate_limit),
          "X-RateLimit-Remaining": String(Math.max(0, d.rate_limit - d.rate_used)),
          "X-Quota-Limit": String(d.quota_limit),
          "X-Quota-Remaining": String(Math.max(0, d.quota_limit - d.quota_used)),
        }
      : {};
    if (reason === "rate_limited") return fail(429, "rate_limited", `Over ${d!.rate_limit} requests/minute.`, { ...headers, "Retry-After": "60" });
    if (reason === "quota_exceeded") return fail(429, "quota_exceeded", `Daily quota of ${d!.quota_limit} requests used.`, { ...headers, "Retry-After": "3600" });
    if (reason === "revoked") return fail(403, "key_revoked", "This key has been revoked.", headers);
    return fail(401, "invalid_key", "That key is not recognised.");
  }

  const rateHeaders = {
    "X-RateLimit-Limit": String(d.rate_limit),
    "X-RateLimit-Remaining": String(Math.max(0, d.rate_limit - d.rate_used)),
    "X-Quota-Limit": String(d.quota_limit),
    "X-Quota-Remaining": String(Math.max(0, d.quota_limit - d.quota_used)),
    "X-Api-Version": API_VERSION,
  };

  // CONDITIONAL REQUESTS. The dominant traffic shape for an API like this is a
  // client polling the same query on a timer, and most of those polls return
  // bytes the caller already has. An ETag lets them say so and get a 304.
  //
  // The quota is still spent on a 304, deliberately: authentication, rate and
  // quota accounting all ran before the route did, and the database work that
  // produced the comparison happened. Free 304s would also be an obvious way to
  // poll a paid endpoint for nothing.
  const conditional = async (res: Response): Promise<Response> => {
    if (res.status !== 200) return res;
    const body = await res.text();
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(body));
    const etag = `W/"${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}"`;
    const headersOut = new Headers(res.headers);
    headersOut.set("ETag", etag);
    if ((req.headers.get("if-none-match") ?? "").split(",").map((x) => x.trim()).includes(etag)) {
      return new Response(null, { status: 304, headers: headersOut });
    }
    return new Response(body, { status: 200, headers: headersOut });
  };

  try {
    if (path === "/v1/jobs") return await conditional(await listJobs(client, url, rateHeaders));
    if (path.startsWith("/v1/jobs/")) return await conditional(await oneJob(client, decodeURIComponent(path.slice("/v1/jobs/".length)), rateHeaders));
    if (path === "/v1/changes") return await conditional(await changes(client, url, rateHeaders));
    if (path === "/v1/companies") return await conditional(await companies(client, url, rateHeaders));
    if (path === "/v1/stats") return await conditional(await stats(client, rateHeaders));
    if (path === "/v1/usage") return await usage(client, d.api_key_id, rateHeaders);
    return fail(404, "no_such_endpoint", `Unknown path ${path}. See /v1 for the endpoint list.`);
  } catch (e) {
    console.error("[PUBLIC-API] handler threw:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return fail(500, "internal_error", "The request could not be completed.");
  }
});

/** Opaque to the caller by construction: base64url of the sort key it encodes.
 *  Opaque so the ordering can change later without breaking anyone who stored
 *  one, and so nobody hand-crafts a cursor into a scan we did not intend. */
function encodeCursor(ep: string, id: string): string {
  return btoa(JSON.stringify({ ep, id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeCursor(raw: string): { ep: string; id: string } | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const o = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { ep?: unknown; id?: unknown };
    if (typeof o.ep !== "string" || typeof o.id !== "string") return null;
    // A quote would break out of the quoted PostgREST value below. Vendor ids
    // do not contain one; a cursor that does was not issued by us.
    if (/["\\]/.test(o.ep) || /["\\]/.test(o.id)) return null;
    return { ep: o.ep, id: o.id };
  } catch { return null; }
}

async function listJobs(client: SupabaseClient, url: URL, headers: Record<string, string>) {
  const p = url.searchParams;
  const limit = Math.min(Math.max(Number(p.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  const cursorRaw = (p.get("cursor") ?? "").trim();
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) {
    return fail(400, "bad_cursor", "That cursor is not one we issued. Start from the first page and follow page.nextCursor.", headers);
  }
  if (!cursor && offset > MAX_OFFSET) {
    return fail(400, "offset_too_deep",
      `offset is capped at ${MAX_OFFSET.toLocaleString()} because the database walks and discards every skipped row. Page with cursor= instead: each response carries page.nextCursor.`,
      headers);
  }

  // effective_posted is selected but NOT published: it is the column the query
  // sorts by, so the cursor has to be built from it, and building one from
  // posted_at instead would produce a key that does not match the ordering —
  // pages that silently skip and repeat rows. It is stripped from every row
  // before the response so the documented field list stays exactly as documented.
  let q = client
    .from("job_board_postings")
    .select(`${JOB_FIELDS},effective_posted`, { count: "estimated" })
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
  eq("experience_band", "experience_band");
  // Substring rather than equality: department is the employer's own free text
  // ("EVOLV - CPP"), so an exact match would be unusable.
  const dept = (p.get("department") ?? "").trim().slice(0, 80).replace(/[%_,()]/g, " ").trim();
  if (dept) q = q.ilike("department", `%${dept}%`);
  const salaryMax = Number(p.get("salary_max"));
  if (Number.isFinite(salaryMax) && salaryMax > 0) q = q.lte("salary_rank_usd", salaryMax);
  const postedBefore = p.get("posted_before");
  if (postedBefore && !Number.isNaN(Date.parse(postedBefore))) q = q.lte("posted_at", new Date(postedBefore).toISOString());

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

  // KEYSET: start strictly after the last row of the previous page, in the same
  // (effective_posted DESC, id ASC) order the query is already sorted by. Cost
  // is flat with depth because the index seeks rather than walks.
  if (cursor) {
    q = q.or(`effective_posted.lt."${cursor.ep}",and(effective_posted.eq."${cursor.ep}",id.gt."${cursor.id}")`);
  }

  const { data: rawData, error, count } = await q
    .order("effective_posted", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(cursor ? 0 : offset, (cursor ? 0 : offset) + limit - 1);
  // The select string is built at runtime, so supabase-js cannot infer a row
  // type from it. The shape is JOB_FIELDS plus the ordering column, which this
  // function owns end to end.
  const data = rawData as unknown as Array<Record<string, unknown>> | null;

  if (error) {
    console.error("[PUBLIC-API] /v1/jobs query failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.");
  }

  // Strip the ordering column back off. Done once, here, rather than in the
  // select, because the cursor above needs it and the contract does not.
  const publicRows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const { effective_posted: _sortKey, ...rest } = r;
    return rest;
  });

  return json({
    apiVersion: API_VERSION,
    data: publicRows,
    page: (() => {
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const last = rows[rows.length - 1];
      const full = rows.length === limit;
      // effective_posted is not in JOB_FIELDS (it is an internal ordering
      // column), so the cursor is built from the sort key the query used, read
      // back off the row. When it is absent the cursor is null rather than
      // wrong — a cursor that silently restarts a walk is worse than none.
      const ep = last?.effective_posted ?? null;
      return {
        limit,
        ...(cursor ? {} : { offset }),
        returned: rows.length,
        nextCursor: full && typeof ep === "string" && typeof last?.id === "string" ? encodeCursor(ep, last.id as string) : null,
        // Kept for callers already paging by offset, and null once they are past
        // the cap so the field cannot walk them off the cliff.
        nextOffset: !cursor && full && offset + limit <= MAX_OFFSET ? offset + limit : null,
      };
    })(),
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

/**
 * /v1/changes — what OPENED and what CLOSED since a timestamp.
 *
 * This is the endpoint the rest of the API exists to make credible. Anyone can
 * serve a list of open jobs; almost nobody can tell you what came down last
 * Tuesday, or distinguish a role that was FILLED from one quietly re-listed
 * under a new id. Both are recorded here as a matter of course, because the
 * board has to know them to keep its own promises.
 */
async function changes(client: SupabaseClient, url: URL, headers: Record<string, string>) {
  const p = url.searchParams;
  const raw = p.get("since") ?? "";
  const since = Date.parse(raw);
  if (!raw || Number.isNaN(since)) {
    return fail(400, "missing_since", "Pass ?since=<ISO timestamp>, e.g. since=2026-08-26T00:00:00Z", headers);
  }
  // A window, not an epoch: `since=1970` would ask for a full-corpus scan on a
  // keyed endpoint, which is how a polling client accidentally DDoSes a
  // database. 30 days is the freshness window, so nothing beyond it is servable
  // anyway.
  const oldest = Date.now() - FRESH_WINDOW_DAYS * 86_400_000;
  if (since < oldest) {
    return fail(400, "since_too_old", `since must be within the last ${FRESH_WINDOW_DAYS} days — the board does not serve postings older than that.`, headers);
  }
  const sinceIso = new Date(since).toISOString();
  const limit = Math.min(Math.max(Number(p.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const [openedRes, closedRes] = await Promise.all([
    client.from("job_board_postings")
      .select("id,source,company_token,company,title,location,country,category,posted_at,first_seen,apply_url")
      .is("missing_since", null)
      .gte("first_seen", sinceIso)
      .order("first_seen", { ascending: false })
      .limit(limit),
    client.from("job_board_closures")
      .select("posting_id,source,company_token,company,title,category,first_seen,posted_at,closed_at,superseded")
      .gte("closed_at", sinceIso)
      .order("closed_at", { ascending: false })
      .limit(limit),
  ]);

  if (openedRes.error || closedRes.error) {
    console.error("[PUBLIC-API] /v1/changes failed:", (openedRes.error ?? closedRes.error)?.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.", headers);
  }

  return json({
    apiVersion: API_VERSION,
    since: sinceIso,
    opened: openedRes.data ?? [],
    closed: (closedRes.data ?? []).map((c) => ({
      ...c,
      // Named, not left as a bare boolean: `superseded` means the posting was
      // re-listed under a new id rather than genuinely closing, and a consumer
      // counting "roles filled" must not count those.
      outcome: (c as { superseded?: boolean }).superseded ? "relisted" : "closed",
    })),
    page: { limit, openedReturned: (openedRes.data ?? []).length, closedReturned: (closedRes.data ?? []).length },
    note: "opened = first seen in the employer's feed since `since`. closed = gone from it. outcome distinguishes a genuine close from a re-list under a new id.",
  }, 200, headers);
}

/** /v1/usage — a customer can see what they have spent before an invoice does. */
async function usage(client: SupabaseClient, keyId: string | null, headers: Record<string, string>) {
  if (!keyId) return fail(500, "no_key_context", "Key context unavailable.", headers);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await client
    .from("api_usage")
    .select("day,endpoint,calls")
    .eq("key_id", keyId)
    .gte("day", since)
    .order("day", { ascending: false });
  if (error) {
    console.error("[PUBLIC-API] /v1/usage failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.", headers);
  }
  const rows = (data ?? []) as Array<{ day: string; endpoint: string; calls: number }>;
  const byDay: Record<string, number> = {};
  for (const r of rows) byDay[r.day] = (byDay[r.day] ?? 0) + (r.calls ?? 0);
  return json({
    apiVersion: API_VERSION,
    // Only ever this key's own usage: key_id comes from the authenticated
    // decision, never from the query string, so one customer cannot read
    // another's consumption by guessing an id.
    limits: { perMinute: Number(headers["X-RateLimit-Limit"]), perDay: Number(headers["X-Quota-Limit"]) },
    remaining: { thisMinute: Number(headers["X-RateLimit-Remaining"]), today: Number(headers["X-Quota-Remaining"]) },
    byDay,
    byEndpoint: rows,
  }, 200, headers);
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
