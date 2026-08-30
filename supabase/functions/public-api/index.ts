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
/** How far back a PAID key may ask for closure history. The free tier gets the
 *  serving window; depth is the thing this dataset actually has that others do
 *  not, and it is what the tiers sell. */
const CHANGES_MAX_DAYS_PAID = 180;
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

// EXPOSED, OR THEY MIGHT AS WELL NOT BE SENT. A browser can only read a
// non-simple response header if it is named in Access-Control-Expose-Headers —
// so every rate, quota and version header this API documents was invisible to
// exactly the callers most likely to need them, and the documented
// If-None-Match flow failed at preflight because the request header was not
// allowed. That blocks every browser-side integrator: an internal dashboard, a
// spreadsheet connector, a client-side prototype.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers":
    "ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-Quota-Limit, X-Quota-Remaining, X-Api-Version",
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
      modes: {
        explain: "/v1/jobs?explain=1 — appends a diagnostics block explaining what the query did.",
        rankedEngine: "/v1/jobs?engine=ranked (paid) — the site's full relevance/rescue engine instead of the default title match.",
      },
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
    if (path === "/v1/jobs") return await conditional(await listJobs(client, url, rateHeaders, d.key_tier));
    if (path.startsWith("/v1/jobs/")) {
      // decodeURIComponent THROWS on malformed percent-encoding, which reached
      // the outer catch and came back as a 500 — telling a machine client to
      // back off and retry a request that can only ever fail. It is a 400.
      let jobId: string;
      try {
        jobId = decodeURIComponent(path.slice("/v1/jobs/".length));
      } catch {
        return fail(400, "bad_id", "The posting id is not valid percent-encoding.", rateHeaders);
      }
      return await conditional(await oneJob(client, jobId, rateHeaders));
    }
    if (path === "/v1/changes") return await conditional(await changes(client, url, rateHeaders, d.key_tier));
    if (path === "/v1/companies") return await conditional(await companies(client, url, rateHeaders));
    if (path === "/v1/stats") return await conditional(await stats(client, rateHeaders));
    if (path === "/v1/usage") return await usage(client, d.api_key_id, rateHeaders);
    return fail(404, "no_such_endpoint", `Unknown path ${path}. See /v1 for the endpoint list.`, rateHeaders);
  } catch (e) {
    console.error("[PUBLIC-API] handler threw:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    // Headers on the failure too: a client that just spent quota on a request
    // that threw still needs to know what it has left, and this is the response
    // it is most likely to be looking at.
    return fail(500, "internal_error", "The request could not be completed.", rateHeaders);
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


/**
 * A MISSPELLED FILTER MUST NOT READ AS A VALID ANSWER.
 *
 * Every parameter was fetched by literal name and the parameter SET was never
 * inspected, so `?county=US`, or `workmode` for `work_mode`, or anything from a
 * future version, vanished silently — and the response was a normal 200 with a
 * normal `total`, describing the whole corpus while the caller believed it was
 * filtered. That is the failure mode that produces a month of confidently wrong
 * downstream numbers before anyone notices, and it is invisible from the
 * response.
 *
 * An API two days old can still afford to be strict, and being strict now is
 * what makes adding parameters later safe.
 */
function rejectUnknownParams(
  url: URL,
  allowed: readonly string[],
  headers: Record<string, string>,
): Response | null {
  for (const k of url.searchParams.keys()) {
    if (!allowed.includes(k)) {
      return fail(400, "unknown_parameter",
        `Unknown parameter "${k}". This endpoint accepts: ${[...allowed].sort().join(", ")}.`,
        headers);
    }
  }
  return null;
}

const JOBS_PARAMS = [
  "limit", "offset", "cursor", "q", "company_token", "source", "category", "country",
  "work_mode", "experience_band", "department", "remote",
  "salary_min", "salary_max", "include_unstated_pay", "posted_after", "posted_before",
  // explain=1 appends a `diagnostics` block describing what this endpoint did —
  // which filters bound, the fences, the count basis, the paging mode — so an
  // integrator can see WHY a query returned what it did without guessing.
  "explain",
  // engine=ranked (paid) routes the query through the site's full ranked engine
  // — relevance ranking, alias/typo rescue, honest disclosures — instead of
  // /v1's default title/company websearch. Opt-in, because it is the heavier
  // path; the default stays cheap and flat-latency for high-volume callers.
  "engine",
] as const;
const CHANGES_PARAMS = ["since", "limit", "opened_cursor", "closed_cursor"] as const;
const COMPANIES_PARAMS = ["limit", "q", "cursor"] as const;

/**
 * Call the job-board function's ranked `list` — the SAME engine the site and
 * the MCP use. The anon key is the right credential: this is the public serving
 * path, and /v1 must hold no more search power than the site does.
 */
async function board(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((out as { error?: string }).error ?? `board ${res.status}`));
  return out as Record<string, unknown>;
}

/**
 * engine=ranked: the site's full relevance/rescue engine, translated into the
 * /v1 envelope. Offset-paged (the ranked engine does not keyset), so `cursor`
 * and `posted_before` — which this engine has no equivalent for — are refused
 * rather than silently dropped. Every honesty disclosure the board emits is
 * passed through, so the ranked API is exactly as candid as the site.
 */
async function listJobsRanked(url: URL, headers: Record<string, string>) {
  const p = url.searchParams;
  if ((p.get("cursor") ?? "").trim()) {
    return fail(400, "unsupported_param", "engine=ranked pages by offset, not cursor. Use ?offset= and follow page.nextOffset.", headers);
  }
  if (p.get("posted_before")) {
    return fail(400, "unsupported_param", "engine=ranked has no posted_before filter. Use posted_after and/or default-engine keyset paging.", headers);
  }
  const limit = Math.min(Math.max(Number(p.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  if (offset > MAX_OFFSET) {
    return fail(400, "offset_too_deep", `offset cannot exceed ${MAX_OFFSET}.`, headers);
  }
  const salaryMin = Number(p.get("salary_min"));
  const salaryMax = Number(p.get("salary_max"));
  // snake_case /v1 params -> camelCase board body. Names differ where the board
  // and the public API named the same predicate differently (company_token ->
  // companies, source -> vendor, experience_band -> experience).
  const body: Record<string, unknown> = {
    action: "list", limit, offset, includeFacets: false,
    ...(p.get("q") ? { q: p.get("q") } : {}),
    ...(p.get("country") ? { country: p.get("country") } : {}),
    ...(p.get("category") ? { category: p.get("category") } : {}),
    ...(p.get("company_token") ? { companies: p.get("company_token") } : {}),
    ...(p.get("work_mode") ? { workMode: p.get("work_mode") } : {}),
    ...(p.get("experience_band") ? { experience: p.get("experience_band") } : {}),
    ...(p.get("department") ? { department: p.get("department") } : {}),
    ...(p.get("source") ? { vendor: p.get("source") } : {}),
    ...(p.get("remote") === "true" ? { remote: true } : {}),
    ...(Number.isFinite(salaryMin) && salaryMin > 0 ? { salaryFloor: salaryMin } : {}),
    ...(Number.isFinite(salaryMax) && salaryMax > 0 ? { salaryCeiling: salaryMax } : {}),
    ...(p.get("include_unstated_pay") === "true" ? { includeUnstatedPay: true } : {}),
    ...(p.get("posted_after") ? { postedAfter: p.get("posted_after") } : {}),
  };

  let r: Record<string, unknown>;
  try {
    r = await board(body);
  } catch (e) {
    console.error("[PUBLIC-API] ranked engine call failed:", String((e as Error)?.message ?? e).slice(0, 160));
    return fail(502, "ranked_unavailable", "The ranked engine did not respond. Retry, or drop engine=ranked to use the default.", headers);
  }
  const jobs = (Array.isArray(r.jobs) ? r.jobs : []) as Array<Record<string, unknown>>;
  const toV1 = (j: Record<string, unknown>) => ({
    id: j.id, source: j.source, company_token: j.token, company: j.company,
    title: j.title, location: j.location, country: j.country, remote: j.remote,
    work_mode: j.workMode ?? null, department: j.department ?? null, category: j.category ?? null,
    posted_at: j.postedAt ?? null,
    // The ranked engine does not carry first_seen; null rather than a guess.
    first_seen: null, last_seen: j.lastSeen ?? null,
    apply_url: j.applyUrl, salary: j.salary ?? null,
    salary_min_annual: j.salaryMinAnnual ?? null, salary_max_annual: j.salaryMaxAnnual ?? null,
    salary_period: j.salaryPeriod ?? null, salary_currency: j.salaryCurrency ?? null,
    experience_band: j.experienceBand ?? null, min_years: j.minYears ?? null,
  });
  const total = typeof r.total === "number" ? r.total : null;
  const disc: Record<string, unknown> = {};
  for (const k of ["ignoredFilters", "excludedTerms", "intentFilters", "aliases", "didYouMean", "searchRoute", "coverage", "salaryStatedOnly"]) {
    if (r[k] !== undefined && r[k] !== null) disc[k] = r[k];
  }
  return json({
    apiVersion: API_VERSION,
    engine: "ranked",
    data: jobs.map(toV1),
    page: {
      limit,
      offset,
      returned: jobs.length,
      nextCursor: null,
      nextOffset: r.hasMore === true && typeof r.nextOffset === "number" && (r.nextOffset as number) <= MAX_OFFSET ? r.nextOffset : null,
    },
    total: { value: r.countUnavailable === true ? null : total, basis: r.countUnavailable === true ? "unavailable" : (r.countCapped === true ? "capped" : "ranked") },
    coverage: {
      freshnessWindowDays: FRESH_WINDOW_DAYS,
      note: "Only postings still live in the employer's own feed within the last 30 days.",
    },
    // The board's own honesty, verbatim — filters it could not honour, words it
    // read as filters, spelling suggestions, the route it took.
    ...(Object.keys(disc).length ? { disclosures: disc } : {}),
  }, 200, headers);
}

async function listJobs(client: SupabaseClient, url: URL, headers: Record<string, string>, tier: string | null = null) {
  const bad = rejectUnknownParams(url, JOBS_PARAMS, headers);
  if (bad) return bad;
  const p = url.searchParams;

  // OPT-IN RANKED ENGINE, paid only. The default engine below is untouched.
  const engine = (p.get("engine") ?? "").trim().toLowerCase();
  if (engine && engine !== "simple" && engine !== "ranked") {
    return fail(400, "invalid_value", `engine must be "simple" (default) or "ranked", got "${engine}".`, headers);
  }
  if (engine === "ranked") {
    const paid = tier != null && tier !== "free" && tier !== "trial";
    if (!paid) {
      return fail(402, "upgrade_required", "engine=ranked is a paid feature — the site's full relevance/rescue engine. The default engine stays available on your key. See https://resumebooster.work/data-api.", headers);
    }
    return await listJobsRanked(url, headers);
  }
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

  // Values derived from the query string once, then applied by baseQuery() below
  // to BOTH the row query and the count query. salaryMin is also read by the
  // coverage block after the fetch, so it lives out here.
  const dept = (p.get("department") ?? "").trim().slice(0, 80).replace(/[%_,()]/g, " ").trim();
  const includeUnstated = p.get("include_unstated_pay") === "true";
  const salaryMax = Number(p.get("salary_max"));
  const salaryMin = Number(p.get("salary_min"));
  const postedBefore = p.get("posted_before");
  const postedAfter = p.get("posted_after");
  // Title/company only, and websearch rather than raw ILIKE: the description
  // tier is what makes board search expensive, and an API caller paging a broad
  // term would pay that cost on every page.
  const term = (p.get("q") ?? "").trim().slice(0, 200);
  const safeTerm = term.replace(/[|"%_\\]/g, " ").trim();

  // remote is a BOOLEAN, not a presence flag. A bare `=== "true"` test silently
  // dropped remote=false (and every typo) and returned the WHOLE corpus under a
  // filtered-looking total. Bind both values; reject anything else with the same
  // 400 shape an unknown parameter gets, rather than treating it as "no filter".
  const remoteRaw = p.get("remote");
  let remoteFilter: boolean | undefined;
  if (remoteRaw !== null) {
    if (remoteRaw === "true") remoteFilter = true;
    else if (remoteRaw === "false") remoteFilter = false;
    else return fail(400, "invalid_value", `remote must be "true" or "false", got "${remoteRaw}".`, headers);
  }

  // effective_posted is selected but NOT published: it is the column the query
  // sorts by, so the cursor has to be built from it, and building one from
  // posted_at instead would produce a key that does not match the ordering —
  // pages that silently skip and repeat rows. It is stripped from every row
  // before the response so the documented field list stays exactly as documented.
  //
  // Base filters WITHOUT the keyset predicate, as a factory so the row query and
  // the count query are built independently. The COUNT must not carry the keyset
  // `.or` clause below: with it applied, count "estimated" measures only the
  // rows still AHEAD of the cursor, so total.value shrank on every page a caller
  // walked. Built here once and shared by both reads for filter parity.
  const baseQuery = (opts: { count?: "estimated" | "planned"; head?: boolean } = {}) => {
    let qb = client
      .from("job_board_postings")
      .select(`${JOB_FIELDS},effective_posted`, opts)
      .is("missing_since", null)                       // fence: never serve a withdrawn posting
      .gte("effective_posted", freshCutoff());          // fence: never serve past the window
    const eq = (param: string, col: string) => {
      const v = p.get(param);
      if (v) qb = qb.eq(col, v);
    };
    eq("country", "country");
    eq("category", "category");
    eq("company_token", "company_token");
    eq("work_mode", "work_mode");
    eq("source", "source");
    eq("experience_band", "experience_band");
    // Substring rather than equality: department is the employer's own free text
    // ("EVOLV - CPP"), so an exact match would be unusable.
    if (dept) qb = qb.ilike("department", `%${dept}%`);
    // THE CEILING SHARES include_unstated_pay's WIDENING, or it cancels it.
    // NULL fails `<=`, so a plain .lte() ANDed after the floor's OR-arm throws
    // out every unpriced row that arm just re-admitted — the caller sets a band
    // and include_unstated_pay=true and silently gets the floor-only answer.
    // Same defect and same fix as the board's own query builder.
    if (Number.isFinite(salaryMax) && salaryMax > 0) {
      qb = includeUnstated
        ? qb.or(`salary_rank_usd.lte.${salaryMax},salary_rank_usd.is.null`)
        : qb.lte("salary_rank_usd", salaryMax);
    }
    if (postedBefore && !Number.isNaN(Date.parse(postedBefore))) qb = qb.lte("posted_at", new Date(postedBefore).toISOString());
    if (remoteFilter !== undefined) qb = qb.eq("remote", remoteFilter);
    if (Number.isFinite(salaryMin) && salaryMin > 0) {
      // Same semantics the board uses, and the same disclosure obligation: only
      // about a fifth of postings state pay, so this filter is a narrow slice and
      // the response says so rather than letting a caller mistake it for a census.
      qb = includeUnstated
        ? qb.or(`salary_rank_usd.gte.${salaryMin},salary_rank_usd.is.null`)
        : qb.gte("salary_rank_usd", salaryMin);
    }
    if (postedAfter && !Number.isNaN(Date.parse(postedAfter))) qb = qb.gte("posted_at", new Date(postedAfter).toISOString());
    if (safeTerm) qb = qb.textSearch("title", safeTerm, { type: "websearch", config: "simple" });
    return qb;
  };

  // KEYSET: start strictly after the last row of the previous page, in the same
  // (effective_posted DESC, id ASC) order the query is already sorted by. Cost
  // is flat with depth because the index seeks rather than walks. Applied to the
  // ROW query only — never to the count (see baseQuery above).
  let rowQuery = baseQuery();
  if (cursor) {
    rowQuery = rowQuery.or(`effective_posted.lt."${cursor.ep}",and(effective_posted.eq."${cursor.ep}",id.gt."${cursor.id}")`);
  }

  // The count is computed ONCE from the filtered-but-not-keyset query, so
  // total.value is stable for a given query across every cursor page. head:true
  // means the count query returns no rows — just the count.
  const [rowRes, countRes] = await Promise.all([
    rowQuery
      .order("effective_posted", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(cursor ? 0 : offset, (cursor ? 0 : offset) + limit - 1),
    baseQuery({ count: "estimated", head: true }),
  ]);
  const { data: rawData, error } = rowRes;

  // ESTIMATED CAN ESCALATE TO EXACT, AND EXACT OVER A TEXT PREDICATE TIMES OUT.
  //
  // PostgREST's `estimated` returns the planner figure only while that figure
  // is ABOVE its threshold; below it, it runs a real count. A filter-only query
  // plans in the hundreds of thousands and answers instantly, but a websearch
  // tsquery plans small, so the fallback exact count walked the FTS predicate
  // over ~575k rows and hit the statement timeout. Measured live the hour this
  // shipped: total.value was a number for every filter-only query and NULL for
  // EVERY text query — an API whose headline count vanished the moment anyone
  // searched.
  //
  // `planned` is the planner estimate and nothing else: it cannot escalate, so
  // it cannot time out. It is less precise on narrow result sets, which is why
  // it is the FALLBACK rather than the default — and the basis says which one
  // answered, because a number whose provenance is unstated is the kind of
  // figure this file exists to refuse.
  let count = countRes.count ?? null;
  let countBasis: "estimated" | "planned" | "unavailable" = "estimated";
  if (countRes.error || count === null) {
    if (countRes.error) {
      console.warn("[PUBLIC-API] /v1/jobs estimated count failed, falling back to planned:", countRes.error.message?.slice(0, 160));
    }
    const planned = await baseQuery({ count: "planned", head: true });
    if (!planned.error && typeof planned.count === "number") {
      count = planned.count;
      countBasis = "planned";
    } else {
      count = null;
      countBasis = "unavailable";
      console.error("[PUBLIC-API] /v1/jobs planned count also failed:", planned.error?.message?.slice(0, 160));
    }
  }
  // The select string is built at runtime, so supabase-js cannot infer a row
  // type from it. The shape is JOB_FIELDS plus the ordering column, which this
  // function owns end to end.
  const data = rawData as unknown as Array<Record<string, unknown>> | null;

  if (error) {
    console.error("[PUBLIC-API] /v1/jobs query failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.", headers);
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
    total: { value: count, basis: countBasis },
    coverage: {
      freshnessWindowDays: FRESH_WINDOW_DAYS,
      note: "Only postings still live in the employer's own feed within the last 30 days. Withdrawn postings are excluded, never re-dated.",
      ...(Number.isFinite(salaryMin) && salaryMin > 0
        ? { statedPayShare: 0.201, statedPayNote: "About 20% of postings state pay; a salary filter can only ever see those unless include_unstated_pay=true." }
        : {}),
    },
    // explain=1: the endpoint's own decision trace. Honest about THIS engine —
    // /v1 runs a title/company websearch with exact filter binding, NOT the
    // site's ranked/ring path, so it names what it actually did rather than
    // borrowing a richer engine's reasoning. (For the ranked engine's trace,
    // the site and the MCP debug_search tool expose job-board's `explain`.)
    ...(p.get("explain") === "1" || p.get("explain") === "true"
      ? {
        diagnostics: {
          matcher: safeTerm ? "websearch(title, simple) + exact filter binding" : "exact filter binding only (no text query)",
          boundFilters: {
            ...(safeTerm ? { q: safeTerm } : {}),
            ...(p.get("country") ? { country: p.get("country") } : {}),
            ...(p.get("category") ? { category: p.get("category") } : {}),
            ...(p.get("company_token") ? { company_token: p.get("company_token") } : {}),
            ...(p.get("work_mode") ? { work_mode: p.get("work_mode") } : {}),
            ...(p.get("source") ? { source: p.get("source") } : {}),
            ...(p.get("experience_band") ? { experience_band: p.get("experience_band") } : {}),
            ...(dept ? { department: `ilike %${dept}%` } : {}),
            ...(remoteFilter !== undefined ? { remote: remoteFilter } : {}),
            ...(Number.isFinite(salaryMin) && salaryMin > 0 ? { salary_min: salaryMin, statedPayOnly: !includeUnstated } : {}),
            ...(Number.isFinite(salaryMax) && salaryMax > 0 ? { salary_max: salaryMax } : {}),
            ...(postedAfter ? { posted_after: postedAfter } : {}),
            ...(postedBefore ? { posted_before: postedBefore } : {}),
            ...(includeUnstated ? { include_unstated_pay: true } : {}),
          },
          fences: ["missing_since IS NULL", `effective_posted >= now-${FRESH_WINDOW_DAYS}d`],
          order: "effective_posted DESC, id ASC",
          paging: cursor ? "keyset (cursor)" : "offset",
          countBasis: `${countBasis} (keyset-independent, so it is stable across pages)`,
          note: "This is /v1's own simpler engine — title/company text match, no relevance ranking, no rescue tiers. The site's ranked search differs.",
        },
      }
      : {}),
  }, 200, headers);
}

async function oneJob(client: SupabaseClient, id: string, headers: Record<string, string>) {
  if (!id) return fail(400, "missing_id", "Provide a posting id: /v1/jobs/{id}", headers);
  const { data, error } = await client
    .from("job_board_postings")
    // WITH THE DESCRIPTION, and only here. The board serves description text to
    // anonymous visitors while the paying API withheld it, which is backwards:
    // it is the field that turns a job feed into something a customer can build
    // on — matching, skill extraction, classification, salary mining.
    //
    // NOT on the list route. At ~5.7KB per posting a 100-row page would be
    // ~570KB, which is the wrong trade for a paginated endpoint; the
    // single-posting lookup already fetches exactly one row and already carries
    // both fences.
    .select(`${JOB_FIELDS},description`)
    .eq("id", id)
    .is("missing_since", null)                        // fence: withdrawn by the employer
    // FENCE TWO, MISSING UNTIL NOW. This bound `missing_since` and stopped, so
    // /v1/jobs/{id} served postings past the 30-day window that /v1/jobs — and
    // the board itself — both refuse. The listing had both fences from the
    // start; the single-posting lookup was written separately and only got one.
    // That is the fifth query shape in this codebase to miss a fence, which is
    // why the guard now counts BOTH per read path rather than checking that
    // "a fence" is present.
    .gte("effective_posted", freshCutoff())           // fence: past the serving window
    .maybeSingle();
  if (error) {
    console.error("[PUBLIC-API] /v1/jobs/{id} failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.", headers);
  }
  // A withdrawn posting is 404 and NOT a stale 200. The difference is the whole
  // product: a caller must be able to tell "gone" from "we stopped looking".
  if (!data) return fail(404, "not_found", "No live posting with that id. It may have been withdrawn by the employer, or aged past the 30-day window.", headers);
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
/**
 * /v1/changes — what opened and what closed. THE ENDPOINT NOBODY CAN COPY.
 *
 * A live feed can tell you what is open today; only a corpus that has been
 * watching can tell you what CLOSED. That is the whole reason this API is worth
 * paying for, and it was returning about one percent of a day.
 *
 * It had no pagination of any kind: `opened` and `closed` were each capped at
 * 100 rows, ordered NEWEST FIRST, and the response said nothing about
 * truncation. Against the board's own boardFlow for a 24h window — 143,418
 * opened, 111,770 closed — a client received 100 of each and no way to know, or
 * to ask for the rest. The only way to mirror the board was to poll fast enough
 * that no 100-event window was ever exceeded, and to accept silent loss whenever
 * it was.
 *
 * ASCENDING NOW, AND KEYSET-PAGED. A change feed is walked FORWARD from a
 * watermark — newest-first is the wrong order for the one job this endpoint has,
 * because the page you can reach is the page you already had. Ascending plus a
 * cursor means a consumer can drain the window exactly once, in order, with no
 * gaps and no duplicates.
 *
 * The keys are total: (first_seen ASC, id ASC) for opened, and
 * (closed_at ASC, event_id ASC) for closed — event_id is
 * `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, so it cannot tie.
 *
 * Each list pages INDEPENDENTLY, because they drain at different rates. One
 * cursor over both would stall the faster list behind the slower one.
 */
async function changes(
  client: SupabaseClient,
  url: URL,
  headers: Record<string, string>,
  tier: string | null,
) {
  const bad = rejectUnknownParams(url, CHANGES_PARAMS, headers);
  if (bad) return bad;
  const p = url.searchParams;
  const raw = p.get("since") ?? "";
  const since = Date.parse(raw);
  if (!raw || Number.isNaN(since)) {
    return fail(400, "missing_since", "Pass ?since=<ISO timestamp>, e.g. since=2026-08-26T00:00:00Z", headers);
  }
  // HOW FAR BACK THE CLOSURE HISTORY GOES IS WHAT THE TIERS SELL.
  //
  // key_tier reached this function and was never read, so the only difference
  // between a free key and a paid one was requests per minute — the weakest
  // possible pitch for a dataset whose value is the history. Depth is the thing
  // that is actually scarce here, and it costs nothing to serve to those who
  // have it.
  //
  // Opened postings are still bounded by the serving window whatever the tier:
  // the board does not serve a posting older than that, so it cannot report one
  // as newly opened either.
  const paid = tier != null && tier !== "free" && tier !== "trial";
  const maxDays = paid ? CHANGES_MAX_DAYS_PAID : FRESH_WINDOW_DAYS;
  const oldest = Date.now() - maxDays * 86_400_000;
  if (since < oldest) {
    return fail(
      400,
      "since_too_old",
      paid
        ? `since must be within the last ${maxDays} days.`
        : `since must be within the last ${maxDays} days on this key. Paid keys reach ${CHANGES_MAX_DAYS_PAID} days of closure history.`,
      headers,
    );
  }
  const sinceIso = new Date(since).toISOString();
  const limit = Math.min(Math.max(Number(p.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const openedAfter = decodeCursor(p.get("opened_cursor") ?? "");
  const closedAfter = decodeCursor(p.get("closed_cursor") ?? "");
  if (p.get("opened_cursor") && !openedAfter) {
    return fail(400, "bad_cursor", "opened_cursor is not a cursor this API issued.", headers);
  }
  if (p.get("closed_cursor") && !closedAfter) {
    return fail(400, "bad_cursor", "closed_cursor is not a cursor this API issued.", headers);
  }

  let openedQ = client.from("job_board_postings")
    .select("id,source,company_token,company,title,location,country,category,posted_at,first_seen,apply_url")
    .is("missing_since", null)                       // fence: withdrawn by the employer
    // THE THIRD READ PATH TO MISS THIS, caught by the guard rather than by a
    // person. `first_seen` is when WE first saw the posting; effective_posted
    // is the date the board serves on. A posting discovered recently can
    // still be past the window — the cap sweep lags under a day, and 2,613
    // rows were measured sitting between 30 and 31 days old. Without this,
    // /v1/changes reports as "opened" postings /v1/jobs would refuse.
    .gte("effective_posted", freshCutoff())          // fence: past the serving window
    .gte("first_seen", sinceIso);
  if (openedAfter) {
    openedQ = openedQ.or(`first_seen.gt.${openedAfter.ep},and(first_seen.eq.${openedAfter.ep},id.gt.${openedAfter.id})`);
  }

  let closedQ = client.from("job_board_closures")
    .select("event_id,posting_id,source,company_token,company,title,category,first_seen,posted_at,closed_at,superseded")
    .gte("closed_at", sinceIso);
  if (closedAfter) {
    closedQ = closedQ.or(`closed_at.gt.${closedAfter.ep},and(closed_at.eq.${closedAfter.ep},event_id.gt.${closedAfter.id})`);
  }

  const [openedRes, closedRes] = await Promise.all([
    openedQ.order("first_seen", { ascending: true }).order("id", { ascending: true }).limit(limit),
    closedQ.order("closed_at", { ascending: true }).order("event_id", { ascending: true }).limit(limit),
  ]);

  if (openedRes.error || closedRes.error) {
    console.error("[PUBLIC-API] /v1/changes failed:", (openedRes.error ?? closedRes.error)?.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.", headers);
  }

  const openedRows = openedRes.data ?? [];
  const closedRows = closedRes.data ?? [];
  // A full page means there is more behind it. Reporting it is the difference
  // between a feed and a sample, and it costs nothing.
  const openedMore = openedRows.length === limit;
  const closedMore = closedRows.length === limit;
  const lastOpened = openedRows[openedRows.length - 1] as { first_seen?: string; id?: string } | undefined;
  const lastClosed = closedRows[closedRows.length - 1] as { closed_at?: string; event_id?: number } | undefined;

  return json({
    apiVersion: API_VERSION,
    since: sinceIso,
    opened: openedRows,
    closed: closedRows.map((c) => ({
      ...c,
      // Named, not left as a bare boolean: `superseded` means the posting was
      // re-listed under a new id rather than genuinely closing, and a consumer
      // counting "roles filled" must not count those.
      outcome: (c as { superseded?: boolean }).superseded ? "relisted" : "closed",
    })),
    page: {
      limit,
      openedReturned: openedRows.length,
      closedReturned: closedRows.length,
      opened: {
        hasMore: openedMore,
        nextCursor: openedMore && lastOpened?.first_seen && lastOpened?.id
          ? encodeCursor(lastOpened.first_seen, String(lastOpened.id))
          : null,
      },
      closed: {
        hasMore: closedMore,
        nextCursor: closedMore && lastClosed?.closed_at && lastClosed?.event_id != null
          ? encodeCursor(lastClosed.closed_at, String(lastClosed.event_id))
          : null,
      },
    },
    closureHistoryDays: maxDays,
    note: "opened = first seen in the employer's feed since `since`. closed = gone from it. outcome distinguishes a genuine close from a re-list under a new id. Both lists are ordered OLDEST FIRST and page independently: follow page.opened.nextCursor as ?opened_cursor= and page.closed.nextCursor as ?closed_cursor= until hasMore is false.",
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

/**
 * /v1/companies — SEARCHABLE AND PAGEABLE, because company_token is the join key.
 *
 * company_token is what every other endpoint filters by, and it was only
 * discoverable by reading the top 100 employers by posting count. With ~23,400
 * companies on the board that left over 99% of the key space undiscoverable: a
 * customer who wanted one specific employer had no way to find its token, and a
 * customer who wanted all of them had no way to walk the list.
 *
 * Both are answered in memory. The handler already reads the whole facet in one
 * row, so filtering by name and paging it are array operations that cost nothing
 * extra — no new query, no new index, no new collection.
 */
async function companies(client: SupabaseClient, url: URL, headers: Record<string, string>) {
  const bad = rejectUnknownParams(url, COMPANIES_PARAMS, headers);
  if (bad) return bad;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), MAX_LIMIT);
  const term = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  const cursorRaw = (url.searchParams.get("cursor") ?? "").trim();
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) {
    return fail(400, "bad_cursor", "That cursor is not one we issued. Start from the first page and follow page.nextCursor.", headers);
  }
  // Served from the board's own cached facet — the same numbers the site shows,
  // rather than a second count that would drift from it.
  const { data, error } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle();
  if (error) {
    console.error("[PUBLIC-API] /v1/companies failed:", error.message?.slice(0, 160));
    return fail(500, "query_failed", "The query could not be completed.", headers);
  }
  const v = (data?.v ?? {}) as { companiesFacet?: Array<{ token?: string; name?: string; count?: number }> };
  const facet = Array.isArray(v.companiesFacet) ? v.companiesFacet : [];
  // Sorted by TOKEN when paging, by size otherwise. A cursor needs a total,
  // stable order and posting counts move between refreshes; the token does not.
  const matched = facet
    .filter((c) => !term || String(c.name ?? "").toLowerCase().includes(term) || String(c.token ?? "").toLowerCase().includes(term))
    .slice()
    .sort((a, b) => (cursorRaw || term)
      ? String(a.token ?? "").localeCompare(String(b.token ?? ""))
      : (b.count ?? 0) - (a.count ?? 0));
  const startAt = cursor ? matched.findIndex((c) => String(c.token ?? "") > cursor.id) : 0;
  const window = startAt < 0 ? [] : matched.slice(startAt, startAt + limit);
  const more = startAt >= 0 && startAt + limit < matched.length;
  const lastTok = window.length ? String(window[window.length - 1].token ?? "") : "";
  return json({
    apiVersion: API_VERSION,
    data: window
      .map((c) => ({ company_token: c.token ?? null, company: c.name ?? null, open_postings: c.count ?? 0 })),
    page: {
      limit,
      returned: window.length,
      matched: matched.length,
      hasMore: more,
      // `ep` is unused for this cursor — the order key is the token alone — but
      // the shape is shared with the other endpoints' cursors on purpose, so
      // one decoder validates all of them.
      nextCursor: more && lastTok ? encodeCursor("token", lastTok) : null,
    },
    // The figure's age is published rather than implied. This facet refreshes
    // at the end of a rotation pass, so it is minutes-to-hours old by design.
    asOf: data?.updated_at ?? null,
    basis: "cached facet, refreshed at the end of each rotation pass",
  }, 200, headers);
}

async function stats(client: SupabaseClient, headers: Record<string, string>) {
  // TWO READS, because the two numbers live in two places and a customer cannot
  // reproduce what the product publishes from only one of them. The lifecycle
  // block below is the closure log — the part of this dataset a scraper-based
  // competitor structurally cannot have — and until now it was on the website
  // and absent from the paid API.
  const [{ data }, cacheRes] = await Promise.all([
    client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
    client.rpc("get_stats_cache"),
  ]);
  const v = (data?.v ?? {}) as {
    total?: number;
    coverage?: { open?: number; tracked?: number; openAt?: string };
    companiesFacet?: unknown[];
    refreshedAt?: string;
  };
  // `v.total` IS NOT THE LIVE COUNT, and publishing it as one overstated the
  // API by ~150,000 postings (707,247 against 556,306 servable). Its own
  // comment in job-board calls it inflated — "includes just-pruned orphans
  // until the next pass recomputes". The board's page learned this and
  // publishes coverage.open, an exact count of rows a caller can actually
  // reach; the API was still quoting the raw number.
  //
  // Both figures are now published under names that say which is which, the
  // same split the jobs page makes: livePostings is what /v1/jobs can return,
  // trackedPostings is the corpus including postings since withdrawn.
  const cache = (cacheRes.data ?? null) as { ghost_stats?: Record<string, unknown> } | null;
  const ghost = cache?.ghost_stats ?? null;
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const open = typeof v.coverage?.open === "number" ? v.coverage.open : null;
  const tracked = typeof v.coverage?.tracked === "number" ? v.coverage.tracked : null;
  return json({
    apiVersion: API_VERSION,
    data: {
      // Null rather than a fallback to v.total: a wrong number with a confident
      // name is worse than an absent one, and this endpoint just proved it.
      livePostings: open,
      trackedPostings: tracked,
      companies: Array.isArray(v.companiesFacet) ? v.companiesFacet.length : null,
      freshnessWindowDays: FRESH_WINDOW_DAYS,
      // THE CLOSURE LOG, PUBLISHED. Every figure here is the one the site shows,
      // read from the same cache, so an API customer and a reader of the page
      // can arrive at the same numbers — which is the whole claim the product
      // makes about its data. Each is null rather than guessed when absent.
      lifecycle: ghost
        ? {
            closuresLogged90d: num(ghost.closed_90d),
            medianDaysOpen: num(ghost.median_days_open),
            medianDaysToClose: num(ghost.median_days_to_close),
            observedDays: num(ghost.observed_days),
            statedPostDateCoveragePct: num(ghost.posted_coverage_pct),
            companiesTracked: num(ghost.total_companies),
            asOf: typeof ghost.computed_at === "string" ? ghost.computed_at : null,
          }
        : null,
    },
    asOf: v.coverage?.openAt ?? v.refreshedAt ?? data?.updated_at ?? null,
    basis: "livePostings is an exact count of postings /v1/jobs can return (live, inside the 30-day window), recounted every ~15 minutes. trackedPostings includes postings the employer has since withdrawn.",
  }, 200, headers);
}
