// CONNECT YOUR AGENT — an MCP server over the board.
//
//   POST /  JSON-RPC 2.0, MCP Streamable HTTP transport, STATELESS.
//
// Why this exists as its own function rather than more routes on public-api:
// MCP is a different contract (JSON-RPC methods, tool schemas, agent-shaped
// results) with a different consumer (a person's AI agent, not their code),
// and the apply tools can act on an ACCOUNT — powers /v1 must never grow.
//
// What it deliberately reuses, so nothing here is a second implementation:
//   - AUTH + METERING: the same rb_live_ keys, hashed and checked through
//     api_key_check — every tool call meters into api_rate/api_quota/api_usage
//     under a "/mcp/<tool>" endpoint bucket, same limits, same headers story.
//   - SEARCH: tools call the job-board function itself (internal POST), so an
//     agent gets the SAME ranked search, rescue tiers and honest disclosures
//     the site gets — total or countUnavailable, ignoredFilters, excludedTerms,
//     intentFilters, didYouMean. A second search engine here would disagree
//     with the first, and the sweep that closed this week's findings is the
//     argument for never writing one.
//   - APPLY: requesting an application routes through the existing apply
//     pipeline with every gate intact — account-linked key, paid entitlement,
//     mandate, honesty classifier, sendable-vendor boundary. The MCP layer is
//     a translator, never a bypass: an agent can do at most what its owner
//     could do signed in.
//
// STATELESS transport on purpose: no Mcp-Session-Id, no SSE stream, every
// request self-contained — an edge isolate has no session affinity to offer,
// and the tools are all request/response shaped. GET returns 405 (spec-legal
// for servers that don't offer a stream).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import { computeFit, resumeRoleTerms } from "../_shared/fit-score.ts";
import { applyServingFences, parseCountries } from "../_shared/mandate-reach.ts";
import {
  ENTITLEMENT_COLUMNS,
  normalizeEmail,
  rowIsEntitled,
  type SubscriberRow,
} from "../_shared/agent-entitlement.ts";

// One version, honestly. Advertising 2025-03-26 / 2024-11-05 — whose specs
// REQUIRE receivers to accept JSON-RPC batches — while this stateless server
// rejects batches was a conformance lie. All the clients we document
// (Claude Code, Claude Desktop, Cursor) speak 2025-06-18, which removed
// batching. A client that only speaks an older revision still gets a clean
// negotiation: we answer initialize with this version and it decides.
const MCP_PROTOCOL_VERSIONS = ["2025-06-18"];
const SERVER_INFO = { name: "resumebooster-job-board", version: "2026-09-04.1" }; // 08-29.2: debug_search tool; .3: search filter parity (department, pay ceiling/basis/stated, maxYears, vendor); 09-04.1: fit_resume paid-gated like POST /v1/fit, per-key scorer bucket, honest scorer 429
const DOCS_URL = "https://resumebooster.work/agents";

// EXPOSED, OR THEY MIGHT AS WELL NOT BE SENT — same lesson public-api learned:
// a browser-side MCP client cannot read rate headers absent from
// Access-Control-Expose-Headers.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers":
    "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-Quota-Limit, X-Quota-Remaining",
};

// Field names mirror api_key_check's OUT parameters, which were RENAMED in
// 20260826161200 after the 42702 outage — see that migration before touching.
type Decision = {
  is_allowed: boolean; deny_reason: string; api_key_id: string | null; key_tier: string | null;
  rate_limit: number; rate_used: number; quota_limit: number; quota_used: number;
};

const db = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

/** Seconds until the daily quota resets (midnight UTC) — the honest Retry-After. */
function secondsToMidnightUtc(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

// ── JSON-RPC plumbing ───────────────────────────────────────────────────────

type RpcReq = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Tool results carry data as JSON text — the shape every MCP client renders. */
const toolOk = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const toolErr = (message: string, fix?: string) => ({
  content: [{ type: "text", text: JSON.stringify(fix ? { error: message, fix } : { error: message }) }],
  isError: true,
});

/**
 * The scorer refused for the day. Its own class so the dispatcher can answer
 * with an honest limit line and a Retry-After instead of the generic
 * "internal error, try again shortly" — which told an agent to retry a call
 * that could not succeed for up to 24 hours.
 */
class ScorerLimited extends Error {
  constructor(public readonly limit: number | null) {
    super("scorer daily allowance reached");
  }
}

// ── The board, called as itself ─────────────────────────────────────────────

/**
 * Internal POST to the job-board function. The anon key is the right
 * credential: this is the public serving path, and the MCP layer must never
 * hold more search power than the site does.
 */
async function board(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((out as { error?: string }).error ?? `board returned ${res.status}`));
  return out as Record<string, unknown>;
}

/** The compact card an agent needs — not the 40-field row the site renders. */
function compactJob(j: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: j.id, title: j.title, company: j.company, location: j.location,
    country: j.country, workMode: j.workMode, employmentType: j.employmentType,
    category: j.category, salary: j.salary, postedAt: j.postedAt, applyUrl: j.applyUrl,
    agentReady: SENDABLE_VENDORS.includes(String(j.source ?? "")),
  };
  if (j.closeMatch) out.closeMatch = true;
  if (j.semanticMatch) out.semanticMatch = true;
  if (j.recheckedAt) out.recheckedAt = j.recheckedAt;
  // Staffing-agency disclosure (2026-08-31 charter: carried, badged, opt-out
  // by filter). Emitted only when true, the compact-card rule — but an agent
  // relaying jobs to a person inherits the disclosure duty, so it must not
  // be dropped here the way salaryStatedOnly must not be swallowed.
  if (j.agency === true) out.agency = true;
  return out;
}

/** Every honesty field the board published, passed through under one roof. */
function disclosures(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (
    const k of [
      "total", "countUnavailable", "totalAtLeast", "countCapped", "hasMore", "nextOffset",
      "ignoredFilters", "excludedTerms", "intentFilters", "aliases", "didYouMean",
      "droppedTerms", "locationSplit", "coverage", "fuzzyExtra", "semanticExtra",
      "locationExpandedFrom", "locationSearched", "maxAgeClampedTo", "searchRoute",
      // salaryStatedOnly is ROW-SELECTING, not cosmetic: a pay-sorted search
      // drops the ~87% of the board with no stated pay. An agent that isn't
      // told that reads a filtered page as the whole market — the exact
      // disclosure the site shows and the MCP layer must never swallow.
      "salaryStatedOnly",
      // Row-selecting for the same reason: the agency opt-out hides disclosed
      // inventory, and an agent must be able to say the market view excludes it.
      "agenciesExcluded",
    ]
  ) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out;
}

// ── Tools ───────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_jobs",
    description:
      "Search the live job board (700k+ postings pulled directly from employers' own hiring systems, 30-day freshness cap). " +
      "Returns compact job cards plus the board's honesty disclosures: exact totals when knowable (countUnavailable otherwise), " +
      "filters it could not honour (ignoredFilters), words it read as filters (intentFilters), and spelling suggestions. " +
      "Set agentReadyOnly=true to see only jobs the apply agent can submit to directly.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms. Supports exclusions: 'engineer -senior'." },
        location: { type: "string", description: "City/state/metro, e.g. 'texas', 'NYC', 'berlin'." },
        country: { type: "string", description: "ISO-2 codes, comma-separated, max 5. E.g. 'US,GB'." },
        remote: { type: "boolean", description: "Only remote-friendly roles." },
        workMode: { type: "string", description: "Comma list of: remote, hybrid, onsite." },
        employmentType: { type: "string", description: "Comma list of: full_time, part_time, contract, temporary, internship." },
        category: { type: "string", description: "Comma list of category slugs (see board_stats for the live set), max 3." },
        department: { type: "string", description: "Substring match on the employer's own department/team text." },
        maxAgeDays: { type: "number", description: "Only postings from the last N days (1-30)." },
        salaryMin: { type: "number", description: "Annual USD-equivalent salary floor. Note: only ~13% of postings state pay." },
        salaryMax: { type: "number", description: "Annual USD-equivalent salary ceiling." },
        hasStatedPay: { type: "boolean", description: "Only postings that state a salary (excludes the ~87% that don't)." },
        payBasis: { type: "string", enum: ["hourly", "salaried"], description: "Restrict to hourly or salaried pay." },
        maxYears: { type: "number", description: "Only roles asking for at most N years of experience." },
        vendor: { type: "string", description: "Comma list of hiring-system vendors (greenhouse, lever, ashby, …), max 8." },
        excludeAgencies: { type: "boolean", description: "Hide postings from staffing/recruiting agencies (their job cards carry agency:true). Agencies are served by default; this is an opt-in narrowing." },
        agentReadyOnly: { type: "boolean", description: "Only jobs the apply agent can submit to on the user's behalf." },
        sort: { type: "string", enum: ["relevance", "newest", "salary"], description: "Default relevance." },
        limit: { type: "number", description: "Rows per page, 1-60. Default 20." },
        offset: { type: "number", description: "Paging offset — pass back the previous response's nextOffset." },
      },
    },
  },
  {
    name: "get_job",
    description: "Full detail for one job id (from search_jobs), including the complete description text and when the employer's feed last confirmed it open.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The job id, e.g. 'greenhouse:acme:12345'." } },
      required: ["id"],
    },
  },
  {
    name: "check_apply_support",
    description:
      "Whether the apply agent can submit an application for this job on the user's behalf, and what that requires. " +
      "Jobs on non-supported systems still return their direct applyUrl for the human to use.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "request_application",
    description:
      "Ask the board's apply agent to submit an application to this job on behalf of the key's owner. " +
      "Requires an account-linked key (mint one at " + DOCS_URL + "), an active Agent plan, and a standing mandate. " +
      "Every application passes the same gates as the signed-in flow — including the honesty classifier: answers are drawn from the owner's own profile and never invented.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "The job id from search_jobs." },
        note: { type: "string", description: "Optional note stored with the request (not sent to the employer)." },
      },
      required: ["jobId"],
    },
  },
  {
    name: "application_status",
    description: "Status of applications the key owner's agent has requested — queued, submitted, refused (with the refusing gate named), or failed.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Most recent N, default 20, max 50." } },
    },
  },
  {
    name: "fit_resume",
    description:
      "PAID — needs a paid API key, exactly like POST /v1/fit on the data API; a free key gets an in-band refusal with the upgrade link. " +
      "Do what the site's résumé drop does, for an agent holding a CV: read the occupation out of resumeText, search the board " +
      "for it (or for `query` if given), and score up to 20 of the results against the résumé — keyword fit 0-100, plus the " +
      "matched and missing terms per job. A null fit means the posting has no stored description to score. Returns the terms " +
      "it read from the CV so the agent can pick a different one and call again with `query`.",
    inputSchema: {
      type: "object",
      properties: {
        resumeText: { type: "string", description: "The candidate's résumé as plain text (100+ characters)." },
        query: { type: "string", description: "Optional job title to search instead of the one read from the résumé." },
        location: { type: "string" }, country: { type: "string" }, remote: { type: "boolean" },
        limit: { type: "integer", description: "Jobs to score, 1-20 (default 20)." },
      },
      required: ["resumeText"],
    },
  },
  {
    name: "board_stats",
    description: "Live board statistics from cache (cheap to call): posting totals, employer count, category set, freshness stamp.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "debug_search",
    description:
      "Explain WHY a search returns what it does — the board's own decision trace merged with the run's outcome. " +
      "Shows the parsed query (terms, exclusions, intent-lifts, alias expansions), which filters were applied vs " +
      "IGNORED and why, the route and retriever chosen, the ranking regime (ranked/ring-merged/deep-page and the " +
      "seam), plus the real run's route, timings, count basis and any fallback. Use this when a search returns " +
      "surprising, empty, or mis-ranked results — it turns 'why?' into one call. Takes the SAME arguments as search_jobs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        location: { type: "string" },
        country: { type: "string" },
        remote: { type: "boolean" },
        workMode: { type: "string" },
        employmentType: { type: "string" },
        category: { type: "string" },
        maxAgeDays: { type: "number" },
        salaryMin: { type: "number" },
        excludeAgencies: { type: "boolean" },
        agentReadyOnly: { type: "boolean" },
        sort: { type: "string", enum: ["relevance", "newest", "salary"] },
        offset: { type: "number" },
      },
    },
  },
];

/** The board `list` body for a tool's args — one mapping, shared by search and debug. */
function searchBody(args: Record<string, unknown>): Record<string, unknown> {
  const limit = Math.max(1, Math.min(60, Number(args.limit ?? 20) || 20));
  return {
    action: "list", limit, includeFacets: false,
    ...(args.query ? { q: String(args.query) } : {}),
    ...(args.location ? { location: String(args.location) } : {}),
    ...(args.country ? { country: String(args.country) } : {}),
    ...(args.remote === true ? { remote: true } : {}),
    ...(args.workMode ? { workMode: String(args.workMode) } : {}),
    ...(args.employmentType ? { employmentType: String(args.employmentType) } : {}),
    ...(args.category ? { category: String(args.category) } : {}),
    ...(args.department ? { department: String(args.department) } : {}),
    ...(args.maxAgeDays ? { maxAgeDays: Number(args.maxAgeDays) } : {}),
    ...(args.salaryMin ? { salaryFloor: Number(args.salaryMin) } : {}),
    ...(args.salaryMax ? { salaryCeiling: Number(args.salaryMax) } : {}),
    ...(args.hasStatedPay === true ? { hasStatedPay: true } : {}),
    ...(args.payBasis === "hourly" || args.payBasis === "salaried" ? { payBasis: String(args.payBasis) } : {}),
    ...(args.maxYears ? { maxYears: Number(args.maxYears) } : {}),
    ...(args.vendor ? { vendor: String(args.vendor) } : {}),
    ...(args.excludeAgencies === true ? { excludeAgencies: true } : {}),
    ...(args.agentReadyOnly === true ? { sendableOnly: true } : {}),
    ...(args.sort === "newest" ? { sort: "newest" } : args.sort === "salary" ? { sort: "salary" } : {}),
    ...(args.offset ? { offset: Number(args.offset) } : {}),
  };
}

async function runSearchJobs(args: Record<string, unknown>): Promise<unknown> {
  const r = await board(searchBody(args));
  const jobs = (Array.isArray(r.jobs) ? r.jobs : []) as Array<Record<string, unknown>>;
  return { jobs: jobs.map(compactJob), ...disclosures(r) };
}

async function runDebugSearch(args: Record<string, unknown>): Promise<unknown> {
  const base = searchBody(args);
  // Decision (no SQL) and outcome (the real run) in parallel — the board's own
  // trace plus what actually happened, so an agent sees BOTH why the board
  // decided and what it then served.
  const [decision, outcome] = await Promise.all([
    board({ ...base, explain: true }),
    board(base),
  ]);
  const out = outcome as Record<string, unknown>;
  const jobs = (Array.isArray(out.jobs) ? out.jobs : []) as Array<Record<string, unknown>>;
  return {
    decision,
    outcome: {
      rowsServed: jobs.length,
      topTitles: jobs.slice(0, 5).map((j) => j.title),
      ...disclosures(out),
      phaseMs: out.phaseMs ?? null,
      tookMs: out.tookMs ?? null,
      rankedFellBack: out.rankedFellBack ?? null,
    },
  };
}

async function runGetJob(args: Record<string, unknown>): Promise<unknown> {
  const id = String(args.id ?? "");
  if (!id) throw new Error("id is required");
  const r = await board({ action: "detail", id });
  if (r.error) throw new Error(String(r.error));
  // The board answers a dead deep link with what it KNOWS — a watched closure
  // or an aged-out stub — rather than a bare 404. Pass that honesty through.
  if (!r.job) {
    if (r.closed) return { job: null, closed: r.closed, note: "This posting closed — the board watched it come down from the employer's feed." };
    if (r.agedOut) return { job: null, agedOut: r.agedOut, note: "Past the board's 30-day freshness cap." };
    throw new Error("Posting not found (it may have closed).");
  }
  const j = r.job as Record<string, unknown>;
  const desc = String(r.description ?? j.description ?? "");
  return {
    ...compactJob(j),
    // Bounded: an agent context does not want a 200KB scraped page. The cap is
    // generous enough for every honest description.
    description: desc.length > 24_000 ? desc.slice(0, 24_000) + "\n[truncated]" : desc,
  };
}

/**
 * The résumé drop, as a tool. Scoring goes to job-fit — its own isolate — and
 * never to job-board, which shares a worker pool with the ingest and answered
 * 546 to readers on 2026-09-03 for exactly that reason.
 *
 * The scorer's daily bucket is THIS KEY'S. job-fit keys its allowance on
 * x-forwarded-for, and an edge-to-edge fetch carries the runtime's own egress
 * address, so every MCP agent (and every /v1/fit customer) drew from one
 * 120/day row. The call names its bucket (x-rb-bucket: key:<id>) under the
 * service-role bearer job-fit requires before trusting the name, and a 429
 * surfaces as ScorerLimited so the dispatcher can say so honestly.
 */
async function runFitResume(args: Record<string, unknown>, apiKeyId: string): Promise<unknown> {
  const resumeText = typeof args.resumeText === "string" ? args.resumeText.slice(0, 50000) : "";
  if (resumeText.trim().length < 100) throw new Error("resumeText must be at least 100 characters");
  const terms = resumeRoleTerms(resumeText, 4);
  const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : (terms[0] ?? "");
  if (!query) {
    return { terms, query: null, jobs: [], note: "No occupation the scanner recognises appears in this résumé — pass `query` with a job title." };
  }
  const limit = Math.max(1, Math.min(20, Number(args.limit ?? 20) || 20));
  const r = await board(searchBody({ ...args, query, limit }));
  const jobs = (Array.isArray(r.jobs) ? r.jobs : []) as Array<Record<string, unknown>>;
  const ids = jobs.map((j) => String(j.id)).slice(0, 20);
  let fits: Record<string, number | null> = {}, matched: Record<string, string[]> = {}, missing: Record<string, string[]> = {};
  if (ids.length) {
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/job-fit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", apikey: anon,
        Authorization: `Bearer ${service}`,
        ...(apiKeyId ? { "x-rb-bucket": `key:${apiKeyId}` } : {}),
      },
      body: JSON.stringify({ action: "fit-batch", resumeText, ids }),
      signal: AbortSignal.timeout(30_000),
    });
    const f = await res.json().catch(() => ({}));
    if (res.status === 429) throw new ScorerLimited(typeof f?.limit === "number" ? f.limit : null);
    if (!res.ok || !f?.fits) throw new Error(String(f?.error ?? `scorer answered ${res.status}`));
    fits = f.fits; matched = f.matched ?? {}; missing = f.missing ?? {};
  }
  return {
    terms, query,
    jobs: jobs.map((j) => ({ ...compactJob(j), fit: fits[String(j.id)] ?? null, matched: matched[String(j.id)] ?? [], missing: missing[String(j.id)] ?? [] })),
    ...disclosures(r),
  };
}

async function runBoardStats(): Promise<unknown> {
  const r = await board({ action: "list", limit: 1, includeFacets: true });
  return {
    servablePostings: r.totalAllCompanies ?? null,
    trackedPostings: r.trackedTotal ?? null,
    employers: r.companiesCount ?? null,
    categories: r.categories && typeof r.categories === "object" ? Object.keys(r.categories as object) : [],
    freshnessWindowDays: 30,
    refreshedAt: r.refreshedAt ?? null,
    note: "Postings come from employers' own hiring-system feeds; nothing is scraped from aggregators.",
  };
}

async function runCheckApplySupport(client: SupabaseClient, args: Record<string, unknown>): Promise<unknown> {
  const id = String(args.id ?? "");
  const source = id.split(":")[0] ?? "";
  const agentReady = SENDABLE_VENDORS.includes(source);
  const r = await board({ action: "detail", id }).catch(() => null);
  const applyUrl = r ? String((r.job as Record<string, unknown> | undefined)?.applyUrl ?? r.applyUrl ?? "") : "";
  return {
    jobId: id,
    agentReady,
    vendor: source || null,
    ...(applyUrl ? { applyUrl } : {}),
    requirements: agentReady
      ? applyRequirements()
      : [`This employer's hiring system (${source || "unknown"}) is not in the agent-submittable set — the human applies at applyUrl.`],
  };
}

// ── The apply seam ──────────────────────────────────────────────────────────
// Everything below acts on an ACCOUNT and therefore refuses account-less keys.
// The gates run in the same order the signed-in flow runs them, by calling the
// same pipeline — never a re-implementation.

/** The owner a key acts for, or null for the account-less free tier. */
async function keyOwner(client: SupabaseClient, apiKeyId: string): Promise<string | null> {
  const { data } = await client.from("api_keys").select("user_id").eq("id", apiKeyId).maybeSingle();
  const uid = (data as { user_id?: string | null } | null)?.user_id;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

function applyRequirements(): string[] {
  return [
    "An account-linked key (mint at " + DOCS_URL + " while signed in).",
    "An active Agent plan on the account.",
    "An active mandate (Account → set up your agent) with a resume on file.",
  ];
}

async function runRequestApplication(
  client: SupabaseClient,
  apiKeyId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const userId = await keyOwner(client, apiKeyId);
  if (!userId) {
    return {
      accepted: false,
      refusedBy: "key",
      error: "This key is not linked to an account, so it cannot act on one.",
      fix: `Sign in at ${DOCS_URL} and mint an agent key — read-only keys stay read-only by design.`,
    };
  }
  return await enqueueApplication(client, userId, String(args.jobId ?? ""), String(args.note ?? ""));
}

async function runApplicationStatus(
  client: SupabaseClient,
  apiKeyId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const userId = await keyOwner(client, apiKeyId);
  if (!userId) {
    return { error: "This key is not linked to an account.", fix: `Mint an agent key at ${DOCS_URL}.` };
  }
  const limit = Math.max(1, Math.min(50, Number(args.limit ?? 20) || 20));
  return await readApplicationStatus(client, userId, limit);
}

/**
 * THE ONE SEAM: a row in agent_queue with status "approved".
 *
 * Chosen deliberately over every alternative (an agent_submissions insert
 * would skip decideRelease and the table refuses client inserts for exactly
 * that reason; apply-broker sits downstream of preparation). From this seam
 * the request inherits, with zero bypass: mandate active + paused_until,
 * entitlement (checked at preparation AND again at claim), blocked companies,
 * employer cooldown, both duplicate checks, question classification, the
 * grounding gate that turns any unsupported answer into a blocker, all eleven
 * decideRelease refusals (vendor allow-list, fit floor, daily cap, review
 * mode, hold-first-N…), the DB triggers, the cancel window, and every
 * worker-side refusal including the CAPTCHA boundary.
 *
 * The checks below are NOT the gates — the pipeline re-runs its own. They
 * exist so a refusal arrives NOW with a named fix, instead of a packet
 * silently never releasing.
 */
async function enqueueApplication(
  client: SupabaseClient,
  userId: string,
  jobId: string,
  note: string,
): Promise<unknown> {
  const refuse = (refusedBy: string, error: string, fix: string) => ({ accepted: false, refusedBy, error, fix });

  // posting_id must be the board's vendor:tenant:id form — apply-agent derives
  // the vendor with split(":")[0], and a malformed id dies downstream as
  // vendor-not-allowed with no hint of why.
  const parts = jobId.split(":");
  if (parts.length < 3 || !parts[0] || !parts[1]) {
    return refuse("jobId", "That is not a job id from this board.", "Use the exact id returned by search_jobs, e.g. 'teamtailor:acme:12345'.");
  }

  const { data: mandate } = await client.from("agent_mandates")
    .select("active, paused_until, resume_text, apply_mode, daily_count, countries, category, include_uncategorised, max_age_days, salary_min")
    .eq("user_id", userId).maybeSingle();
  if (!mandate) {
    return refuse("mandate", "No agent mandate on this account.", "Set up your agent in Account — that is where you authorize what it may do and hand it your details.");
  }
  const m = mandate as {
    active?: boolean; paused_until?: string | null; resume_text?: string | null; apply_mode?: string;
    countries?: string | null; category?: string | null; include_uncategorised?: boolean | null;
    max_age_days?: number | null; salary_min?: number | null;
  };
  if (m.active !== true) {
    return refuse("mandate", "Your agent is switched off.", "Turn it on in Account — the off switch always wins, including over this tool.");
  }
  if (m.paused_until && Date.parse(m.paused_until) > Date.now()) {
    return refuse("mandate", `Your agent is paused until ${m.paused_until}.`, "Unpause it in Account, or wait.");
  }
  const resume = String(m.resume_text ?? "");
  if (resume.length < 100) {
    return refuse("resume", "No resume on file — the agent refuses to apply blind.", "Add your resume in Account → Apply profile.");
  }

  // Entitlement, by the ACCOUNT's address — for the error message; the
  // pipeline re-checks at preparation and again at claim.
  const { data: userRes } = await client.auth.admin.getUserById(userId);
  const email = normalizeEmail(userRes?.user?.email ?? "");
  const { data: subRow } = await client.from("agent_subscribers")
    .select(ENTITLEMENT_COLUMNS).eq("email", email).maybeSingle();
  if (!rowIsEntitled(subRow as SubscriberRow | null)) {
    return refuse("plan", "The apply agent needs an active Agent plan.", "Subscribe at https://resumebooster.work/agent — search tools keep working without it.");
  }

  // The posting, through the SAME serving fences selection uses — this is the
  // only moment the pipeline checks them, so the request must too.
  const { data: posting } = await applyServingFences(
    client.from("job_board_postings")
      .select("id,title,company,company_token,location,country,apply_url,salary,salary_min_annual,category,posted_at,description"),
  ).eq("id", jobId).maybeSingle();
  if (!posting) {
    return refuse("posting", "That posting is closed, aged out, or was never on the board.", "Its employer feed no longer lists it — search again for live matches.");
  }
  const p = posting as Record<string, unknown>;

  // THE MANDATE'S REACH FENCES — country, category, freshness, salary floor.
  //
  // These are NOT enforced by decideRelease; agent-runner binds them once, at
  // SELECTION, and nothing downstream re-checks (mandate-reach.ts's own header
  // says so). So a request entering at the agent_queue seam would otherwise
  // skip the very guardrails the owner set — an auto-mode account with
  // countries=DE could have its agent talked into a US warehouse job by a
  // prompt-injected job description. The scope the owner drew has to bind here
  // too. Evaluated in JS (not as query predicates) so the refusal can name the
  // fence that stopped it. Same definitions as the runner's binders.
  const wantCountries = parseCountries(m.countries);
  if (wantCountries.length && !wantCountries.includes(String(p.country ?? ""))) {
    return refuse("scope-country", `That job is in ${p.country || "an unlisted country"}; your agent is scoped to ${wantCountries.join(", ")}.`, "Widen your agent's countries in Account, or pick a job within scope.");
  }
  const wantCat = String(m.category ?? "");
  if (wantCat) {
    const cat = String(p.category ?? "");
    const catOk = wantCat === "other" ? cat === "other"
      : m.include_uncategorised === true ? (cat === wantCat || cat === "other")
      : cat === wantCat;
    if (!catOk) return refuse("scope-category", `That job's field (${cat || "unclassified"}) is outside your agent's field (${wantCat}).`, "Change your agent's field in Account, or pick a job within it.");
  }
  const maxAge = typeof m.max_age_days === "number" && m.max_age_days >= 1 ? Math.min(m.max_age_days, 60) : null;
  if (maxAge !== null) {
    const posted = p.posted_at ? Date.parse(String(p.posted_at)) : NaN;
    if (!Number.isFinite(posted) || posted < Date.now() - maxAge * 86_400_000) {
      return refuse("scope-age", `That posting is older than your agent's ${maxAge}-day freshness limit (or carries no date).`, "Raise the age limit in Account, or pick a newer posting.");
    }
  }
  if (typeof m.salary_min === "number" && m.salary_min > 0) {
    const floor = typeof p.salary_min_annual === "number" ? p.salary_min_annual : null;
    if (floor === null || floor < m.salary_min) {
      return refuse("scope-salary", `That job ${floor === null ? "states no salary" : `states ${floor}`}; your agent's floor is ${m.salary_min}.`, "Lower your agent's salary floor in Account, or pick a job that meets it.");
    }
  }

  const { data: existing } = await client.from("agent_queue")
    .select("status").eq("user_id", userId).eq("posting_id", jobId).maybeSingle();
  if (existing) {
    return { accepted: true, alreadyQueued: true, queueStatus: (existing as { status?: string }).status, note: "This job was already in your agent's queue — nothing duplicated." };
  }

  // fit_pct must be populated: decideRelease refuses fit-unknown on null and
  // fit-below-floor under 55 (apply-agent MIN_FIT_PCT). Computing it here
  // means the requester learns the outlook NOW instead of a silent non-release.
  const fit = computeFit(`${String(p.title ?? "")} ${String(p.description ?? "")}`, resume);

  const row = {
    user_id: userId,
    posting_id: jobId,
    title: String(p.title ?? "").slice(0, 300),
    company: String(p.company ?? ""),
    company_token: String(p.company_token ?? ""),
    location: String(p.location ?? ""),
    apply_url: String(p.apply_url ?? ""),
    salary: String(p.salary ?? ""),
    category: String(p.category ?? "other"),
    posted_at: p.posted_at ?? null,
    fit_pct: fit.pct,
    reasons: [{ k: "external-agent", label: note ? `Requested by your connected agent — ${note.slice(0, 140)}` : "Requested by your connected agent" }],
    // "approved": read by the hourly preparer in BOTH review and auto mode,
    // and the true statement — the user's own agent asked for this.
    status: "approved",
    search_id: null,
    search_label: "Connected agent",
  };
  const { error: insErr } = await client.from("agent_queue")
    .upsert([row], { onConflict: "user_id,posting_id", ignoreDuplicates: true });
  if (insErr) throw new Error(`queue write failed: ${insErr.message}`);

  const vendor = parts[0];
  const agentReady = SENDABLE_VENDORS.includes(vendor);
  return {
    accepted: true,
    jobId,
    title: row.title,
    company: row.company,
    fitPct: fit.pct,
    ...(fit.pct !== null && fit.pct < 55 ? { warning: "Fit is below the 55% release floor — the packet will be prepared but refused release unless the resume covers more of this posting's terms." } : {}),
    ...(agentReady ? {} : { warning: `This employer's system (${vendor}) is not agent-submittable — the packet will be prepared for one-click manual sending instead.` }),
    whatHappensNext: m.apply_mode === "auto"
      ? "The hourly preparer builds the application from your profile (answers are grounded — nothing is invented), then releases it within your daily cap and vendor allow-list. Track it with application_status."
      : "The application is prepared and waits in your morning queue for your review — you approve the actual send. Track it with application_status.",
  };
}

async function readApplicationStatus(client: SupabaseClient, userId: string, limit: number): Promise<unknown> {
  const { data: queued } = await client.from("agent_queue")
    .select("posting_id, title, company, status, created_at, decided_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  const { data: subs } = await client.from("agent_submissions")
    .select("posting_id, title, company, source, status, release_refusal, blockers, submitted_at, submitted_via, attempts, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  const compactSub = (s: Record<string, unknown>) => ({
    postingId: s.posting_id, title: s.title, company: s.company, vendor: s.source,
    status: s.status,
    ...(s.release_refusal ? { notReleasedBecause: s.release_refusal } : {}),
    ...(Array.isArray(s.blockers) && s.blockers.length
      ? { needsHumanFor: (s.blockers as Array<{ kind?: string }>).map((b) => b.kind ?? "unknown") }
      : {}),
    ...(s.submitted_at ? { submittedAt: s.submitted_at, submittedVia: s.submitted_via } : {}),
  });
  return {
    queued: (queued ?? []).map((q) => ({
      postingId: (q as Record<string, unknown>).posting_id,
      title: (q as Record<string, unknown>).title,
      company: (q as Record<string, unknown>).company,
      status: (q as Record<string, unknown>).status,
    })),
    applications: ((subs ?? []) as Array<Record<string, unknown>>).map(compactSub),
    statusKey: {
      preparing: "being assembled", ready: "prepared, awaiting release/claim",
      blocked: "needs the human first (see needsHumanFor)", submitted: "sent to the employer",
      failed: "preparation failed", stale: "posting closed before sending",
    },
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/** The same predicate public-api applies to engine=ranked and POST /v1/fit. */
const isPaidTier = (tier: string | null) => tier != null && tier !== "free" && tier !== "trial";

async function callTool(
  client: SupabaseClient,
  apiKeyId: string,
  tier: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "search_jobs": return toolOk(await runSearchJobs(args));
    case "debug_search": return toolOk(await runDebugSearch(args));
    case "get_job": return toolOk(await runGetJob(args));
    case "board_stats": return toolOk(await runBoardStats());
    case "fit_resume": {
      // Gated exactly as POST /v1/fit is: the same feature was paid on the
      // API and free here, and the free path drained the paid customers'
      // shared scorer allowance. Refused in-band, before any search runs.
      if (!isPaidTier(tier)) {
        return toolErr(
          "fit_resume is a paid feature — résumé-to-job fit scoring, the same feature as POST /v1/fit.",
          "Upgrade the key at https://resumebooster.work/data-api — the search tools keep working on a free key.",
        );
      }
      return toolOk(await runFitResume(args, apiKeyId));
    }
    case "check_apply_support": return toolOk(await runCheckApplySupport(client, args));
    case "request_application": return toolOk(await runRequestApplication(client, apiKeyId, args));
    case "application_status": return toolOk(await runApplicationStatus(client, apiKeyId, args));
    default: return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "GET") {
    // No SSE stream to offer — spec-legal for a stateless server. The body
    // says where the humans go.
    return json({ error: "This MCP endpoint is POST-only (stateless).", docs: DOCS_URL }, 405);
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let msg: RpcReq;
  try {
    msg = await req.json() as RpcReq;
  } catch {
    return json(rpcError(null, -32700, "parse error"), 400);
  }
  // Batches are removed in 2025-06-18 and rare before it; a stateless server
  // may decline them honestly rather than half-support them.
  if (Array.isArray(msg)) return json(rpcError(null, -32600, "batching not supported; send one message per request"), 400);

  const { id, method } = msg;
  // params may arrive as null (JSON-RPC allows it, and clients send it): a bare
  // `= {}` default only fills UNDEFINED, so `params.protocolVersion` on null
  // threw and the request fell out as a non-JSON-RPC HTTP 500. Coerce to an
  // object once, here.
  const params: Record<string, unknown> =
    msg.params && typeof msg.params === "object" && !Array.isArray(msg.params)
      ? msg.params as Record<string, unknown>
      : {};
  // A notification (no id) must NEVER receive a response — not even for
  // request-shaped methods a confused client sends as notifications, and
  // certainly not a metered tools/call. Decided before any method branch.
  const isNotification = id === undefined || id === null;
  if (isNotification && method !== "notifications/initialized" && method !== "notifications/cancelled") {
    return new Response(null, { status: 202, headers: cors });
  }

  // Discovery runs unauthenticated: an agent must be able to see what is here
  // before its human decides to mint a key.
  if (method === "initialize") {
    const asked = String((params as { protocolVersion?: unknown }).protocolVersion ?? "");
    // Negotiate to a version we support: echo the client's if we speak it,
    // else offer our own and let the client decide. We advertise ONLY
    // 2025-06-18 — advertising the older revisions while rejecting the
    // JSON-RPC batches those revisions require receivers to support was a
    // conformance lie.
    const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
    return json(rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        "Job search over employers' own hiring feeds. Read tools (search_jobs, get_job, board_stats, check_apply_support) " +
        "need any free API key from https://resumebooster.work/data-api. " +
        "fit_resume needs a paid key, like POST /v1/fit. The apply tools additionally need an " +
        "account-linked key, an Agent plan, and a standing mandate — see " + DOCS_URL + ". " +
        "Counts are honest: countUnavailable means the board refuses to guess.",
    }));
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202, headers: cors });
  }
  if (method === "ping") return json(rpcResult(id, {}));
  if (method === "tools/list") return json(rpcResult(id, { tools: TOOLS }));

  if (method !== "tools/call") {
    return isNotification
      ? new Response(null, { status: 202, headers: cors })
      : json(rpcError(id, -32601, `method not found: ${String(method)}`));
  }

  // ── tools/call: authenticated + metered per tool ──────────────────────────
  const toolName = String((params as { name?: unknown }).name ?? "");
  const toolArgs = ((params as { arguments?: unknown }).arguments ?? {}) as Record<string, unknown>;
  if (!TOOLS.some((t) => t.name === toolName)) {
    return json(rpcError(id, -32602, `unknown tool: ${toolName}`));
  }

  const auth = req.headers.get("authorization") ?? "";
  const raw = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!raw) {
    return json(rpcResult(id, toolErr(
      "No API key. Send it as: Authorization: Bearer <key>.",
      "Get a free key at https://resumebooster.work/data-api — search tools work with it immediately.",
    )));
  }

  const client = db();
  const { data: dec, error: decErr } = await client
    .rpc("api_key_check", { p_key_hash: await sha256Hex(raw), p_endpoint: `/mcp/${toolName}` })
    .maybeSingle();
  if (decErr) {
    console.error("[AGENT-MCP] key check failed:", decErr.message?.slice(0, 160));
    return json(rpcError(id, -32603, "key verification temporarily unavailable — retry shortly"));
  }
  const d = (dec ?? null) as Decision | null;
  // Rate/quota headers are computed from whatever the check returned, so they
  // ride the DENY response too — that is the response a client most needs them
  // on. Retry-After is in Expose-Headers; a deny that omitted it advertised a
  // header it never sent.
  const rateHeaders: Record<string, string> = d
    ? {
        "X-RateLimit-Limit": String(d.rate_limit),
        "X-RateLimit-Remaining": String(Math.max(0, d.rate_limit - d.rate_used)),
        "X-Quota-Limit": String(d.quota_limit),
        "X-Quota-Remaining": String(Math.max(0, d.quota_limit - d.quota_used)),
      }
    : {};
  if (!d || !d.is_allowed) {
    const reason = d?.deny_reason ?? "unknown_key";
    const friendly: Record<string, [string, string]> = {
      rate_limited: [`Over ${d?.rate_limit ?? 60} requests/minute.`, "Wait a minute, then continue."],
      quota_exceeded: [`Daily quota of ${d?.quota_limit ?? 1000} requests used.`, "Quota resets at midnight UTC."],
      revoked: ["This key has been revoked.", "Mint a new one at https://resumebooster.work/data-api."],
      unknown_key: ["That key is not recognised.", "Check for truncation; keys start with rb_live_."],
    };
    const [message, fix] = friendly[reason] ?? friendly.unknown_key;
    const retry: Record<string, string> = reason === "rate_limited"
      ? { "Retry-After": "60" }
      : reason === "quota_exceeded"
      ? { "Retry-After": String(secondsToMidnightUtc()) }
      : {};
    return json(rpcResult(id, toolErr(message, fix)), 200, { ...rateHeaders, ...retry });
  }

  try {
    const result = await callTool(client, d.api_key_id ?? "", d.key_tier, toolName, toolArgs);
    if (result === null) return json(rpcError(id, -32602, `unknown tool: ${toolName}`));
    return json(rpcResult(id, result), 200, rateHeaders);
  } catch (e) {
    if (e instanceof ScorerLimited) {
      // Not an internal error, and not retryable in a minute: the scorer's
      // 24h bucket for this key is spent. Say which limit, and when.
      return json(rpcResult(id, toolErr(
        `This key's daily fit-scoring allowance (${e.limit ?? 1000} calls) is used; it resets 24 hours after the first scored call.`,
        "Wait for the window, or keep using search_jobs meanwhile — the scorer does not meter it.",
      )), 200, { ...rateHeaders, "Retry-After": "3600" });
    }
    // A tool failure is a RESULT with isError, not a protocol error — agents
    // read it and adapt; a JSON-RPC error tears down some clients' sessions.
    // The DETAILED error stays server-side; the client gets a generic line, so
    // a Postgres constraint string or an internal URL never leaves in a tool
    // result. The tool-name suffix is enough for an agent to know which call to
    // retry or drop.
    console.error(`[AGENT-MCP] tool ${toolName} failed:`, String((e as Error)?.message ?? e).slice(0, 300));
    return json(rpcResult(id, toolErr(`The ${toolName} tool hit an internal error. Try again shortly.`)), 200, rateHeaders);
  }
});
