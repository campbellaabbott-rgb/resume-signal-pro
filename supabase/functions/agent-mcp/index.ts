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
//
// WHAT THE SERVER KNEW AND DID NOT SAY (2026-09-04 audit, closed here):
//   - the pay it had ALREADY parsed. Cards carried the employer's prose
//     ("$120k-$140k DOE") while the structured columns the same row was
//     selected by — annual floor/ceiling, period, currency, band, min years —
//     were dropped in translation, so an agent had to re-parse the sentence
//     the board had already parsed to sort a shortlist by money.
//   - the key's own limits. Rate and quota travelled only as HTTP headers,
//     which an MCP client never shows a model, and apply-readiness could be
//     discovered only by attempting an application and reading the refusal.
//     key_status answers both in band.
//   - which calls are safe. With no annotations a client must treat every
//     tool as potentially destructive and ask its human before board_stats.
//     Exactly one tool here is not read-only, and now it is the only one that
//     says so.
//   - the shape of its own answers. outputSchema (2025-06-18) plus the
//     structuredContent every result now carries lets a client parse rows
//     instead of guessing at JSON-in-text.
//   - that one question can cover many ids. get_job is one posting per metered
//     call against a 1,000/day quota; re-verifying a shortlist of twenty spent
//     twenty. check_jobs_open and get_jobs spend one.

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
// 08-29.2: debug_search tool; .3: search filter parity (department, pay
// ceiling/basis/stated, maxYears, vendor); 09-04.1: fit_resume paid-gated like
// POST /v1/fit, per-key scorer bucket, honest scorer 429; 09-04.2: structured
// pay/experience/department on every card, outputSchema + structuredContent,
// tool annotations, key_status, check_jobs_open + get_jobs, and the last four
// board filters (experience, companies, postedAfter, includeUnstatedPay).
const SERVER_INFO = { name: "resumebooster-job-board", version: "2026-09-04.2" };
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

/**
 * Seconds until the rate window resets.
 *
 * api_key_check counts into `date_trunc('minute', now())`, so the window is
 * the CURRENT CLOCK MINUTE, not a rolling sixty seconds — a key that spent its
 * minute at :59.5 is clear half a second later. The deny path still answers
 * Retry-After: 60 (a safe ceiling for a client that must simply wait), but
 * key_status reports the real number, because reporting 60 there would be a
 * guess dressed as a fact.
 */
function secondsToNextMinute(): number {
  return Math.max(1, 60 - new Date().getUTCSeconds());
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

/**
 * Tool results carry data as JSON text — the shape every MCP client renders —
 * AND as `structuredContent`, which is the half a tool's outputSchema is about.
 *
 * BOTH, deliberately. 2025-06-18 lets a tool declare the shape of its result
 * and a client validate the structured half against it; the same revision says
 * a tool returning structured content SHOULD still return the serialised JSON
 * as text, because a client that only knows about content blocks would
 * otherwise render an empty result. Sending one without the other is either a
 * schema nothing satisfies or a payload nothing can check.
 *
 * Attached only for a plain object: structuredContent is an object in the
 * schema, and every tool here answers with one.
 */
const toolOk = (data: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 1) }],
  ...(data && typeof data === "object" && !Array.isArray(data)
    ? { structuredContent: data as Record<string, unknown> }
    : {}),
});
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

/**
 * THE STRUCTURED FIELDS THE ROW ALREADY CARRIES.
 *
 * Every one of these is a real column the board selected the row BY — the
 * search takes salaryMin/salaryMax/payBasis/maxYears/experience filters
 * against them — and every one was dropped on the way out, leaving an agent
 * the employer's prose ("$120k–$140k DOE, 5+ years") to re-parse in order to
 * answer the question the database had already answered. A surface that can
 * filter on a number and will not return it makes its own filters
 * unverifiable: an agent cannot check that salaryMin bound, or sort a
 * shortlist by pay, without asking the board again one job at a time.
 *
 * Named exactly as job-board's rowToJob names them, not translated: a second
 * vocabulary for the same column is how two surfaces start disagreeing.
 *
 * ABSENT, NOT NULL, when the posting does not state one — the compact-card
 * rule the disclosure flags already follow. Absence is stated in the
 * outputSchema so it cannot be read as zero: ~87% of the board states no pay
 * and ~71% no years, and a card full of nulls would be most of the payload.
 */
const CARD_STRUCTURED_FIELDS = [
  "salaryMinAnnual", "salaryMaxAnnual", "salaryPeriod", "salaryCurrency",
  "experienceBand", "minYears", "department",
] as const;

/** The compact card an agent needs — not the 40-field row the site renders. */
function compactJob(j: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: j.id, title: j.title, company: j.company, location: j.location,
    country: j.country, workMode: j.workMode, employmentType: j.employmentType,
    category: j.category, salary: j.salary, postedAt: j.postedAt, applyUrl: j.applyUrl,
    // The employer handle, because `companies` scopes a search by it and an
    // agent has nowhere else to learn one. /v1 has always emitted it as
    // company_token; the board calls it `token`.
    companyToken: j.token ?? null,
    agentReady: SENDABLE_VENDORS.includes(String(j.source ?? "")),
  };
  for (const k of CARD_STRUCTURED_FIELDS) {
    if (j[k] !== undefined && j[k] !== null) out[k] = j[k];
  }
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

/**
 * The search arguments, declared ONCE.
 *
 * search_jobs and debug_search take the same arguments — debug_search's
 * description says so in as many words — and they had drifted anyway:
 * department, employmentType's siblings, maxYears, payBasis, hasStatedPay,
 * vendor and salaryMax were declared on one and not the other, while
 * searchBody, which BOTH call, has always read every one of them off the args.
 * So the debug tool silently accepted filters it did not advertise, and an
 * agent reading its schema could not reproduce the search it was debugging.
 * One object is the only spelling of "the same arguments" that cannot drift.
 */
const SEARCH_PROPERTIES = {
  query: { type: "string", description: "Search terms. Supports exclusions: 'engineer -senior'." },
  location: { type: "string", description: "City/state/metro, e.g. 'texas', 'NYC', 'berlin'." },
  country: { type: "string", description: "ISO-2 codes, comma-separated, max 5. E.g. 'US,GB'." },
  remote: { type: "boolean", description: "Only remote-friendly roles." },
  workMode: { type: "string", description: "Comma list of: remote, hybrid, onsite." },
  employmentType: { type: "string", description: "Comma list of: full_time, part_time, contract, temporary, internship." },
  category: { type: "string", description: "Comma list of category slugs (see board_stats for the live set), max 3." },
  department: { type: "string", description: "Substring match on the employer's own department/team text." },
  companies: {
    type: "string",
    description:
      "Scope to specific employers: a comma list of companyToken values from job cards (or from the site's employer pages). " +
      "An employer the board does not carry simply matches nothing; tokens the board drops are named in ignoredFilters.",
  },
  experience: {
    type: "string",
    description:
      "Comma list of seniority bands the POSTING asks for: entry, mid, senior, expert. " +
      "Rows whose band could not be read are excluded — use maxYears for the candidate's own side of the question.",
  },
  maxAgeDays: { type: "number", description: "Only postings from the last N days (1-30)." },
  postedAfter: {
    type: "string",
    description:
      "ISO-8601 instant; only postings the EMPLOYER dated after it. Undated rows fall out of this window " +
      "(unlike maxAgeDays, which falls back to when the board first saw a posting), so this is the strict form of 'new'.",
  },
  salaryMin: { type: "number", description: "Annual USD-equivalent salary floor. Note: only ~13% of postings state pay." },
  salaryMax: { type: "number", description: "Annual USD-equivalent salary ceiling." },
  includeUnstatedPay: {
    type: "boolean",
    description:
      "WIDENS an active salaryMin/salaryMax band to also admit postings that state no pay at all. " +
      "Inert with no band set (unpriced rows are already included). The response says salaryStatedOnly when a band is narrowing without it.",
  },
  hasStatedPay: { type: "boolean", description: "Only postings that state a salary (excludes the ~87% that don't)." },
  payBasis: { type: "string", enum: ["hourly", "salaried"], description: "Restrict to hourly or salaried pay." },
  maxYears: { type: "number", description: "Only roles asking for at most N years of experience." },
  vendor: { type: "string", description: "Comma list of hiring-system vendors (greenhouse, lever, ashby, …), max 8." },
  excludeAgencies: { type: "boolean", description: "Hide postings from staffing/recruiting agencies (their job cards carry agency:true). Agencies are served by default; this is an opt-in narrowing." },
  agentReadyOnly: { type: "boolean", description: "Only jobs the apply agent can submit to on the user's behalf." },
  sort: { type: "string", enum: ["relevance", "newest", "salary"], description: "Default relevance." },
  limit: { type: "number", description: "Rows per page, 1-60. Default 20." },
  offset: { type: "number", description: "Paging offset — pass back the previous response's nextOffset." },
};

/**
 * THE SHAPE OF A JOB CARD, declared so a client can check it.
 *
 * 2025-06-18 added outputSchema; a tool that declares one must return
 * structuredContent that satisfies it, which toolOk now always sends. Written
 * to be honest about ABSENCE rather than tidy: the structured pay and
 * experience fields are omitted on a posting that states none, and saying so
 * here is what stops "no salaryMinAnnual" from being read as "pays nothing".
 * additionalProperties stays open — the board adds honest fields (agency,
 * snippet, matchScope) faster than a frozen schema could follow, and a client
 * that rejected an unknown one would break on the board's next disclosure.
 */
const JOB_CARD_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "vendor:employer:externalId — the id every other tool takes." },
    title: { type: ["string", "null"] },
    company: { type: ["string", "null"] },
    companyToken: { type: ["string", "null"], description: "The employer handle; pass it back in search_jobs `companies`." },
    location: { type: ["string", "null"] },
    country: { type: ["string", "null"], description: "ISO-2." },
    workMode: { type: ["string", "null"], enum: ["remote", "hybrid", "onsite", null], description: "Stated or inferred from title/location; null when neither says." },
    employmentType: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    department: { type: "string", description: "The employer's own team name. ABSENT when the posting carries none." },
    salary: { type: ["string", "null"], description: "The employer's own pay text, verbatim and unparsed." },
    salaryMinAnnual: { type: "number", description: "Annual USD-equivalent floor, parsed by the board. ABSENT when the posting states no pay — absence is not zero." },
    salaryMaxAnnual: { type: "number", description: "Annual USD-equivalent ceiling. ABSENT when unstated." },
    salaryPeriod: { type: "string", description: "The period the employer stated: hour, month, year. ABSENT when unstated (~89% of the board)." },
    salaryCurrency: { type: "string", description: "ISO-4217, as stated. ABSENT when unstated." },
    experienceBand: { type: "string", enum: ["entry", "mid", "senior", "expert"], description: "ABSENT when the posting's seniority could not be read." },
    minYears: { type: "integer", description: "Years of experience the posting asks for. ABSENT when it names none (~71%)." },
    postedAt: { type: ["string", "null"], description: "The employer's own date, ISO-8601. Null when the feed carries none — never the date we first saw it." },
    applyUrl: { type: ["string", "null"] },
    agentReady: { type: "boolean", description: "True when request_application can submit to this hiring system." },
    agency: { type: "boolean", description: "Present and true when the posting comes from a staffing/recruiting agency." },
    recheckedAt: { type: "string", description: "When the employer's feed was last fetched and still carried this employer's board." },
  },
  required: ["id", "agentReady"],
  additionalProperties: true,
};

/** Everything the board publishes about the search itself, passed through. */
const DISCLOSURE_SCHEMA = {
  total: { type: ["integer", "null"], description: "Exact match count. ABSENT with countUnavailable:true when the board refuses to guess." },
  countUnavailable: { type: "boolean", description: "The board could not count this query exactly — do not report a total." },
  hasMore: { type: "boolean" },
  nextOffset: { type: "integer", description: "Pass back as `offset` for the next page." },
  ignoredFilters: { type: "array", items: { type: "string" }, description: "Filters the board could NOT apply. Results answer a wider question than was asked." },
  excludedTerms: { type: "array", items: { type: "string" } },
  intentFilters: { type: "array", items: { type: "string" }, description: "Words read out of the query as filters." },
  didYouMean: { type: "string" },
  salaryStatedOnly: { type: "boolean", description: "Row-selecting: this page excludes the ~87% of postings with no stated pay." },
  agenciesExcluded: { type: "boolean", description: "Row-selecting: disclosed agency inventory is hidden from this page." },
};

/**
 * TOOL ANNOTATIONS (2025-06-18).
 *
 * Without them a client has to assume the worst of every tool and ask its
 * human before each call — including board_stats, which reads a cache. Nine of
 * the eleven tools here only read; saying so is what lets an agent search,
 * page and verify without interrupting anyone, and what makes the ONE
 * interruption (request_application) mean something.
 *
 * openWorldHint is true wherever the answer comes from the live board — an
 * open, changing world of employers' feeds — and false only for key_status,
 * which reads this key's own record and nothing else.
 *
 * readOnlyHint is about the CALLER'S world. A detail read can cause the board
 * to store a description it just fetched; that is our own cache warming, not a
 * change to anything the caller has, and it is not what the hint is asking.
 */
const READS_THE_BOARD = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const READS_THE_KEY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "search_jobs",
    title: "Search jobs",
    description:
      "Search the live job board (700k+ postings pulled directly from employers' own hiring systems, 30-day freshness cap). " +
      "Returns compact job cards — including the board's own parsed pay (salaryMinAnnual/salaryMaxAnnual/salaryPeriod), " +
      "experience band and minYears, so pay and seniority never have to be re-read out of prose — plus the board's honesty " +
      "disclosures: exact totals when knowable (countUnavailable otherwise), filters it could not honour (ignoredFilters), " +
      "words it read as filters (intentFilters), and spelling suggestions. " +
      "Set agentReadyOnly=true to see only jobs the apply agent can submit to directly.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: SEARCH_PROPERTIES,
    },
    outputSchema: {
      type: "object",
      properties: { jobs: { type: "array", items: JOB_CARD_SCHEMA }, ...DISCLOSURE_SCHEMA },
      required: ["jobs"],
      additionalProperties: true,
    },
  },
  {
    name: "get_job",
    title: "Get one job",
    description: "Full detail for one job id (from search_jobs), including the complete description text and when the employer's feed last confirmed it open. For several ids at once, use get_jobs — it costs ONE call against the daily quota instead of one per posting.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The job id, e.g. 'greenhouse:acme:12345'." } },
      required: ["id"],
    },
    outputSchema: {
      // NOTHING IS REQUIRED, and that is the honest schema: a dead deep link
      // answers with what the board KNOWS — a watched closure, or an aged-out
      // stub — rather than with a card, and a schema that demanded card fields
      // would make the board's best answer look like a malformed one.
      type: "object",
      properties: {
        ...JOB_CARD_SCHEMA.properties,
        description: { type: "string", description: "The posting's full text, truncated at 24,000 characters with a [truncated] marker." },
        job: { type: "null", description: "Present and null when there is no posting to return; read `closed` / `agedOut` / `notFound` beside it." },
        closed: { type: "object", additionalProperties: true, description: "The board watched this posting come down: title, company, closedAt." },
        agedOut: { type: "object", additionalProperties: true, description: "Past the 30-day freshness cap." },
        notFound: { type: "boolean", description: "No posting with this id — never on this board, or gone long enough that nothing is remembered." },
        note: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "get_jobs",
    title: "Get several jobs",
    description:
      "Full detail for up to 10 job ids in ONE call — the shortlist form of get_job. Each id answers with a card plus its " +
      "description; ids that closed, aged out or were never on this board come back in `unavailable` with the reason named, " +
      "so one dead id never costs you the other nine. Set includeDescription=false for cards and freshness only (much smaller, " +
      "and no vendor fetch).",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array", items: { type: "string" }, maxItems: 10,
          description: "Job ids from search_jobs. Up to 10 per call — each one is a separate detail read that may fetch the employer's page.",
        },
        includeDescription: { type: "boolean", description: "Default true. Descriptions are capped at 8,000 characters here; call get_job for the whole text of one." },
      },
      required: ["ids"],
    },
    outputSchema: {
      type: "object",
      properties: {
        jobs: { type: "array", items: JOB_CARD_SCHEMA },
        unavailable: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              reason: { type: "string", enum: ["closed", "agedOut", "notFound", "error"] },
              closed: { type: "object", additionalProperties: true },
              agedOut: { type: "object", additionalProperties: true },
            },
            required: ["id", "reason"],
            additionalProperties: true,
          },
        },
        requested: { type: "integer" },
        returned: { type: "integer" },
        notFetched: { type: "array", items: { type: "string" }, description: "Ids past the per-call cap — sent, not read. Call again with these." },
      },
      required: ["jobs", "unavailable"],
      additionalProperties: true,
    },
  },
  {
    name: "check_jobs_open",
    title: "Check which jobs are still open",
    description:
      "Are these postings still on the board? Answers up to 200 ids in one call — the tool for re-verifying a saved shortlist " +
      "before acting on it, instead of spending a metered get_job per posting. Returns open:{id:boolean} plus the closed ids, " +
      "and names the basis of the answer: it reads the board's index (a closed posting is one the employer's feed stopped " +
      "listing), not the employer's site at this instant, and it is a weaker test than get_job's — read `basis` before " +
      "reporting a posting as live to a person.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, maxItems: 200, description: "Job ids from search_jobs. Up to 200 per call; anything past that is named in notChecked rather than silently dropped." },
      },
      required: ["ids"],
    },
    outputSchema: {
      type: "object",
      properties: {
        open: { type: "object", additionalProperties: { type: "boolean" }, description: "One entry per id checked." },
        closed: { type: "array", items: { type: "string" }, description: "The ids that are no longer on the board." },
        checked: { type: "integer" },
        openCount: { type: "integer" },
        closedCount: { type: "integer" },
        notChecked: { type: "array", items: { type: "string" } },
        basis: { type: "string", description: "What 'open' means in this answer." },
      },
      required: ["open", "basis"],
      additionalProperties: true,
    },
  },
  {
    name: "check_apply_support",
    title: "Check apply support",
    description:
      "Whether the apply agent can submit an application for this job on the user's behalf, and what that requires. " +
      "Jobs on non-supported systems still return their direct applyUrl for the human to use. " +
      "For whether THIS KEY may apply at all, call key_status — this tool answers about the job, not the key.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "request_application",
    title: "Request an application",
    description:
      "Ask the board's apply agent to submit an application to this job on behalf of the key's owner. " +
      "Requires an account-linked key (mint one at " + DOCS_URL + "), an active Agent plan, and a standing mandate — " +
      "key_status says whether this key has all three before you spend a call finding out. " +
      "Every application passes the same gates as the signed-in flow — including the honesty classifier: answers are drawn from the owner's own profile and never invented.",
    annotations: {
      // THE ONE TOOL HERE THAT ACTS, and the annotations say so plainly.
      readOnlyHint: false,
      // Not because anything is deleted — the queue write is an upsert that
      // overwrites nothing — but because of what it can lead to: an
      // application in front of an employer, which no one can recall. A client
      // reads this hint to decide whether to ask its human first, and for this
      // call the answer is yes.
      destructiveHint: true,
      // Asking twice for the same job does not apply twice: the queue upsert is
      // onConflict(user_id,posting_id) with ignoreDuplicates, and the second
      // call answers alreadyQueued. An agent retrying a timeout is safe.
      idempotentHint: true,
      openWorldHint: true,
    },
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
    title: "Application status",
    description: "Status of applications the key owner's agent has requested — queued, submitted, refused (with the refusing gate named), or failed.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Most recent N, default 20, max 50." } },
    },
  },
  {
    name: "fit_resume",
    title: "Score a résumé against the board",
    description:
      "PAID — needs a paid API key, exactly like POST /v1/fit on the data API; a free key gets an in-band refusal with the upgrade link. " +
      "Do what the site's résumé drop does, for an agent holding a CV: read the occupation out of resumeText, search the board " +
      "for it (or for `query` if given), and score up to 20 of the results against the résumé — keyword fit 0-100, plus the " +
      "matched and missing terms per job. A null fit means the posting has no stored description to score. Returns the terms " +
      "it read from the CV so the agent can pick a different one and call again with `query`.",
    // Scoring changes nothing an agent owns; it does spend this key's daily
    // scorer allowance, which the description and the 429 line both name.
    annotations: READS_THE_BOARD,
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
    outputSchema: {
      type: "object",
      properties: {
        terms: { type: "array", items: { type: "string" }, description: "The occupations read out of the résumé, best first." },
        query: { type: ["string", "null"], description: "What was actually searched. Null when no occupation was recognised." },
        jobs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ...JOB_CARD_SCHEMA.properties,
              fit: { type: ["number", "null"], description: "Keyword fit 0-100. NULL means the posting has no stored description to score — not a poor match." },
              matched: { type: "array", items: { type: "string" } },
              missing: { type: "array", items: { type: "string" } },
            },
            required: ["id", "agentReady"],
            additionalProperties: true,
          },
        },
        note: { type: "string" },
        ...DISCLOSURE_SCHEMA,
      },
      required: ["terms", "jobs"],
      additionalProperties: true,
    },
  },
  {
    name: "board_stats",
    title: "Board statistics",
    description: "Live board statistics from cache (cheap to call): posting totals, employer count, category set, freshness stamp.",
    annotations: READS_THE_BOARD,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "key_status",
    title: "This key's limits and powers",
    description:
      "What THIS key is and what it may do — tier, requests left this minute, calls left today (both including this call), " +
      "whether the paid tools (fit_resume, and engine=ranked on the data API) are available on it, and whether the apply " +
      "tools would work: account link, Agent plan, mandate, résumé on file, with any blocker named. " +
      "None of this was askable before: rate and quota travelled only in HTTP headers an MCP client never surfaces, and " +
      "apply-readiness could only be discovered by attempting an application and reading the refusal. " +
      "Call it first in a session, and after a 'quota' or 'rate' refusal.",
    annotations: READS_THE_KEY,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        key: {
          type: "object",
          properties: {
            tier: { type: "string" },
            paid: { type: "boolean" },
            accountLinked: { type: "boolean", description: "False for a plain data-API key; the apply tools need a key minted while signed in." },
            id: { type: ["string", "null"], description: "The key's row id — not the key itself, which the server never holds." },
          },
          required: ["tier", "paid", "accountLinked"],
          additionalProperties: true,
        },
        rate: {
          type: "object",
          properties: {
            limit: { type: "integer" }, used: { type: "integer" }, remaining: { type: "integer" },
            window: { type: "string" }, resetsInSeconds: { type: "integer" },
          },
          required: ["limit", "remaining"],
          additionalProperties: true,
        },
        quota: {
          type: "object",
          properties: {
            limit: { type: "integer" }, used: { type: "integer" }, remaining: { type: "integer" },
            window: { type: "string" }, resetsInSeconds: { type: "integer" },
          },
          required: ["limit", "remaining"],
          additionalProperties: true,
        },
        features: {
          type: "object",
          properties: {
            fit_resume: { type: "boolean", description: "Paid tiers only, exactly as POST /v1/fit." },
            rankedEngine: { type: "boolean", description: "/v1/jobs?engine=ranked on the data API, same key. Paid tiers only." },
            request_application: { type: "boolean", description: "True only when every apply gate below already passes." },
          },
          required: ["fit_resume", "rankedEngine", "request_application"],
          additionalProperties: true,
        },
        apply: {
          type: "object",
          properties: {
            ready: { type: "boolean" },
            accountLinked: { type: "boolean" },
            planActive: { type: "boolean" },
            mandateActive: { type: "boolean" },
            resumeOnFile: { type: "boolean" },
            pausedUntil: { type: "string" },
            blockers: { type: "array", items: { type: "string" }, description: "Empty when ready. Each entry is the refusal request_application would give." },
            requirements: { type: "array", items: { type: "string" } },
            note: { type: "string" },
          },
          required: ["ready", "blockers"],
          additionalProperties: true,
        },
        counted: { type: "string" },
        docs: { type: "string" },
      },
      required: ["key", "rate", "quota", "features", "apply"],
      additionalProperties: true,
    },
  },
  {
    name: "debug_search",
    title: "Explain a search",
    description:
      "Explain WHY a search returns what it does — the board's own decision trace merged with the run's outcome. " +
      "Shows the parsed query (terms, exclusions, intent-lifts, alias expansions), which filters were applied vs " +
      "IGNORED and why, the route and retriever chosen, the ranking regime (ranked/ring-merged/deep-page and the " +
      "seam), plus the real run's route, timings, count basis and any fallback. Use this when a search returns " +
      "surprising, empty, or mis-ranked results — it turns 'why?' into one call. Takes the SAME arguments as search_jobs.",
    annotations: READS_THE_BOARD,
    // Literally the same object search_jobs declares — see SEARCH_PROPERTIES.
    // "Takes the SAME arguments as search_jobs" is now a fact about the code
    // rather than a promise in a sentence.
    inputSchema: {
      type: "object",
      properties: SEARCH_PROPERTIES,
    },
  },
];

/**
 * AN ARRAY, ALWAYS — the board reads `companies` with Array.isArray and pushes
 * a bare string straight into ignoredFilters. A comma list would therefore
 * arrive as an employer scope that never bound, and the caller would read a
 * whole-board total as that employer's. Agents type comma lists, so the split
 * happens here, once, on the way in. Not capped here: the board caps at the
 * number of employers it carries and NAMES the trim in ignoredFilters, which
 * disclosures() passes through — a second cap in this file would only be a
 * silent one.
 */
const companyTokens = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((c) => String(c ?? "").trim())
    .filter(Boolean);

/** The board `list` body for a tool's args — one mapping, shared by search and debug. */
function searchBody(args: Record<string, unknown>): Record<string, unknown> {
  const limit = Math.max(1, Math.min(60, Number(args.limit ?? 20) || 20));
  const companies = companyTokens(args.companies);
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
    ...(companies.length ? { companies } : {}),
    ...(args.experience ? { experience: String(args.experience) } : {}),
    ...(args.maxAgeDays ? { maxAgeDays: Number(args.maxAgeDays) } : {}),
    ...(args.postedAfter ? { postedAfter: String(args.postedAfter) } : {}),
    ...(args.salaryMin ? { salaryFloor: Number(args.salaryMin) } : {}),
    ...(args.salaryMax ? { salaryCeiling: Number(args.salaryMax) } : {}),
    // WIDENING, and literal true only — the board reads anything else as a
    // non-boolean and names it. Passed as its own flag rather than folded into
    // salaryFloor: it relaxes an active band, it does not move one.
    ...(args.includeUnstatedPay === true ? { includeUnstatedPay: true } : {}),
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

/**
 * One board `detail` read, translated — the shared half of get_job and
 * get_jobs. Missing is a RESULT here, not an exception: the batch tool has to
 * put a closed posting in its own list beside nine live ones, and a throw
 * would take the other nine with it.
 */
type DetailOutcome =
  | { ok: true; card: Record<string, unknown> }
  | { ok: false; id: string; reason: "closed" | "agedOut" | "notFound"; detail?: unknown };

async function detailOf(id: string, descCap: number, truncNote: string): Promise<DetailOutcome> {
  let r: Record<string, unknown>;
  try {
    r = await board({ action: "detail", id });
  } catch (e) {
    // AN ID THIS BOARD DOES NOT CARRY IS A FACT ABOUT THE ID, NOT A FAULT.
    // The board answers one whose vendor:employer prefix is not in its source
    // list with 404 "Unknown job id"; board() turns a non-2xx into a throw, and
    // the dispatcher turns any throw into "hit an internal error. Try again
    // shortly" — telling an agent to retry a call that can never succeed, which
    // is the same wrong instruction the scorer's 429 used to give. Classified
    // here; anything else still throws and is still logged server-side.
    if (/unknown job id/i.test(String((e as Error)?.message ?? ""))) return { ok: false, id, reason: "notFound" };
    throw e;
  }
  if (r.error) throw new Error(String(r.error));
  // The board answers a dead deep link with what it KNOWS — a watched closure
  // or an aged-out stub — rather than a bare 404. Pass that honesty through.
  if (!r.job) {
    if (r.closed) return { ok: false, id, reason: "closed", detail: r.closed };
    if (r.agedOut) return { ok: false, id, reason: "agedOut", detail: r.agedOut };
    return { ok: false, id, reason: "notFound" };
  }
  const j = r.job as Record<string, unknown>;
  const desc = String(r.description ?? j.description ?? "");
  return {
    ok: true,
    card: {
      ...compactJob(j),
      // Bounded: an agent context does not want a 200KB scraped page. The cap is
      // generous enough for every honest description.
      ...(descCap > 0 ? { description: desc.length > descCap ? desc.slice(0, descCap) + truncNote : desc } : {}),
    },
  };
}

async function runGetJob(args: Record<string, unknown>): Promise<unknown> {
  const id = String(args.id ?? "");
  if (!id) throw new Error("id is required");
  const out = await detailOf(id, 24_000, "\n[truncated]");
  if (out.ok) return out.card;
  // The exact answers this tool has always given, so no client that learned
  // the closed/agedOut shape has to learn a second one.
  if (out.reason === "closed") return { id, job: null, closed: out.detail, note: "This posting closed — the board watched it come down from the employer's feed." };
  if (out.reason === "agedOut") return { id, job: null, agedOut: out.detail, note: "Past the board's 30-day freshness cap." };
  // ANSWERED, NOT THROWN — the same treatment its two siblings above already
  // got. A throw here reached the agent as "the get_job tool hit an internal
  // error. Try again shortly", so a mistyped or long-dead id read as a server
  // fault and invited a retry that could not work. job:null is how this tool
  // has always said "no posting", and now it says it for all three reasons.
  return {
    id,
    job: null,
    notFound: true,
    note: "No posting with that id — it closed long enough ago that the board no longer holds it, or the id is not from this board.",
    fix: "Search again with search_jobs; ids look like 'greenhouse:acme:12345'.",
  };
}

/**
 * TEN IDS, AND THE NUMBER IS THE VENDOR FETCH, NOT THE ROWS.
 *
 * Each id is its own board `detail` call, and a posting whose description is
 * not stored yet costs a live fetch of the employer's page inside it — the one
 * unbounded cost on this path, and the reason this cap is nothing like
 * check_jobs_open's 200 (which is a single indexed id lookup with no vendor
 * round trip in it at all). Ten cold descriptions still fit inside the request
 * budget an MCP client allows, and the point is already won at ten: an agent
 * re-reading a shortlist spends ONE call of its 1,000/day instead of ten.
 *
 * Five at a time, not ten: job-board shares a worker pool with the ingest, and
 * this file's own scorer note records what over-parallelising it costs
 * (fit-batch at 60 ids failed 2 of 4 live calls with WORKER_RESOURCE_LIMIT
 * while 20 succeeded). Two waves of five is the same total work at a fifth of
 * the peak.
 */
const GET_JOBS_MAX = 10;
const GET_JOBS_CONCURRENCY = 5;

async function runGetJobs(args: Record<string, unknown>): Promise<unknown> {
  const asked = [...new Set(
    (Array.isArray(args.ids) ? args.ids : [args.ids])
      .map((x) => String(x ?? "").trim()).filter(Boolean),
  )];
  if (!asked.length) throw new Error("ids is required — an array of job ids from search_jobs (up to 10).");
  const ids = asked.slice(0, GET_JOBS_MAX);
  const notFetched = asked.slice(GET_JOBS_MAX);
  const includeDescription = args.includeDescription !== false;
  const jobs: Array<Record<string, unknown>> = [];
  const unavailable: Array<Record<string, unknown>> = [];

  for (let i = 0; i < ids.length; i += GET_JOBS_CONCURRENCY) {
    const wave = await Promise.all(ids.slice(i, i + GET_JOBS_CONCURRENCY).map(async (id) => {
      try {
        return await detailOf(
          id,
          includeDescription ? 8_000 : 0,
          "\n[truncated — call get_job with this id for the whole description]",
        );
      } catch (e) {
        // ONE BAD ID MUST NOT COST THE OTHER NINE. The detail stays
        // server-side, the same rule the dispatcher's catch follows; the agent
        // gets the id and a reason it can act on.
        console.error(`[AGENT-MCP] get_jobs detail failed for ${id}:`, String((e as Error)?.message ?? e).slice(0, 200));
        return { ok: false as const, id, reason: "error" as const };
      }
    }));
    for (const out of wave) {
      if (out.ok) jobs.push(out.card);
      else {
        unavailable.push({
          id: out.id,
          reason: out.reason,
          ...(out.reason === "closed" ? { closed: (out as { detail?: unknown }).detail } : {}),
          ...(out.reason === "agedOut" ? { agedOut: (out as { detail?: unknown }).detail } : {}),
          ...(out.reason === "notFound" ? { note: "Not a posting this board carries — check the id came from search_jobs." } : {}),
          ...(out.reason === "error" ? { note: "The board did not answer for this id. Retry it on its own with get_job." } : {}),
        });
      }
    }
  }
  return {
    requested: asked.length,
    returned: jobs.length,
    jobs,
    unavailable,
    // NAMED, NOT DROPPED. A silently truncated id list is a shortlist the
    // agent believes it verified.
    ...(notFetched.length
      ? { notFetched, note: `Only the first ${GET_JOBS_MAX} ids were read — send the rest in another call.` }
      : {}),
  };
}

/**
 * LIVENESS FOR A WHOLE SHORTLIST, IN ONE METERED CALL.
 *
 * The board already answers this for the site's saved-jobs tracker (`exists`,
 * up to 200 ids, one indexed primary-key lookup), so this tool is a
 * translation and not a new question. 200 is the board's own cap and is echoed
 * here rather than re-chosen.
 *
 * NOT the `verify` action, deliberately: that one probes each employer's
 * system live, is capped at 12 ids for that reason, and WRITES — it stamps
 * missing_since and can delete rows. A read-only tool must not carry a path
 * that prunes the corpus as a side effect of an agent checking its list, and
 * a tool annotated readOnlyHint would be lying if it did.
 *
 * The cost of that choice is stated in the answer's `basis`, in full, because
 * it is exactly the kind of gap that becomes a false claim. `exists` asks one
 * question — is there a row? — and that is WEAKER than the test the serving
 * path applies: a row inside the removal grace window (stamped missing, not
 * yet pruned) and a row past the 30-day freshness cap both still exist, and
 * get_job would decline to serve either. Reporting those as "open" without
 * saying so would be the board contradicting itself between two tools.
 */
async function runCheckJobsOpen(args: Record<string, unknown>): Promise<unknown> {
  const asked = [...new Set(
    (Array.isArray(args.ids) ? args.ids : [args.ids])
      .map((x) => String(x ?? "").trim()).filter(Boolean),
  )];
  if (!asked.length) throw new Error("ids is required — an array of job ids from search_jobs (up to 200).");
  const ids = asked.slice(0, 200);
  const notChecked = asked.slice(200);
  const r = await board({ action: "exists", ids });
  const raw = (r.open && typeof r.open === "object" ? r.open : {}) as Record<string, unknown>;
  const open: Record<string, boolean> = {};
  for (const id of ids) open[id] = raw[id] === true;
  const closed = ids.filter((id) => !open[id]);
  return {
    open,
    closed,
    checked: ids.length,
    openCount: ids.length - closed.length,
    closedCount: closed.length,
    ...(notChecked.length ? { notChecked, note: "Only the first 200 ids were checked — send the rest in another call." } : {}),
    basis:
      "Open means the board still holds a row for this posting — its employer's feed listed it at the last refresh and the " +
      "board has not confirmed it gone. It is not a live probe of the employer's site at this instant, and it is a WEAKER " +
      "test than the one search and get_job apply: a posting inside the removal grace window, or one past the board's 30-day " +
      "freshness cap, can still read open here while get_job declines to serve it. get_job on a single id is the closer look.",
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

/**
 * THE APPLY GATES, ASKED INSTEAD OF TRIPPED.
 *
 * Until this existed the only way to learn whether a key could apply was to
 * request an application and read which gate said no — a metered call whose
 * answer was always "no, and here is why", for a question ("may I?") that
 * should never have needed a side effect to ask.
 *
 * It re-checks nothing and enforces nothing: enqueueApplication still runs
 * every gate, and the pipeline behind it re-runs its own at preparation and
 * again at claim. This reads the same rows with the same shared predicates —
 * rowIsEntitled over ENTITLEMENT_COLUMNS, the 100-character resume floor —
 * precisely so a "ready" here cannot come to mean something different from a
 * "yes" there.
 *
 * Reports booleans and blockers, never the owner's data: no email, no resume
 * text, no plan identifiers leave this function.
 */
async function applyReadiness(client: SupabaseClient, userId: string | null): Promise<Record<string, unknown>> {
  const note =
    "Account-level readiness only. Each job is still checked against the mandate's own reach — countries, field, " +
    "freshness, salary floor — and request_application names the fence when one refuses.";
  if (!userId) {
    return {
      ready: false, accountLinked: false, planActive: false, mandateActive: false, resumeOnFile: false,
      blockers: ["This key is not linked to an account, so it cannot act on one."],
      requirements: applyRequirements(),
      note,
    };
  }
  const { data: mandate } = await client.from("agent_mandates")
    .select("active, paused_until, resume_text").eq("user_id", userId).maybeSingle();
  const m = mandate as { active?: boolean; paused_until?: string | null; resume_text?: string | null } | null;
  const pausedUntil = m?.paused_until && Date.parse(m.paused_until) > Date.now() ? m.paused_until : null;
  const mandateActive = m?.active === true && !pausedUntil;
  // The seam's own floor, not a second one: "a resume on file" has to mean the
  // same length there and here or this tool would promise a refusal.
  const resumeOnFile = String(m?.resume_text ?? "").length >= 100;

  const { data: userRes } = await client.auth.admin.getUserById(userId);
  const email = normalizeEmail(userRes?.user?.email ?? "");
  const { data: subRow } = await client.from("agent_subscribers")
    .select(ENTITLEMENT_COLUMNS).eq("email", email).maybeSingle();
  const planActive = rowIsEntitled(subRow as SubscriberRow | null);

  const blockers: string[] = [];
  if (!m) blockers.push("No agent mandate on this account — set your agent up in Account.");
  else if (m.active !== true) blockers.push("Your agent is switched off.");
  else if (pausedUntil) blockers.push(`Your agent is paused until ${pausedUntil}.`);
  if (!resumeOnFile) blockers.push("No resume on file — the agent refuses to apply blind.");
  if (!planActive) blockers.push("The apply agent needs an active Agent plan.");

  return {
    ready: blockers.length === 0,
    accountLinked: true,
    planActive, mandateActive, resumeOnFile,
    ...(pausedUntil ? { pausedUntil } : {}),
    blockers,
    ...(blockers.length ? { requirements: applyRequirements() } : {}),
    note,
  };
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

/**
 * WHAT THIS KEY IS AND WHAT IT MAY DO — the question the server could answer
 * for itself all along and had no way to say.
 *
 * Every number here comes from the SAME api_key_check decision the rate
 * headers are built from, so the two cannot disagree, and the row is not read
 * twice: `d` is the decision this very call was allowed by. api_key_check
 * counts before it answers (rate_used is post-increment, quota_used is
 * v_day_used + 1), so these figures include this call — which is why the
 * answer says so instead of leaving an agent to wonder whether to subtract 1.
 *
 * Served from the dispatcher rather than from callTool: it reports the
 * decision, and callTool is handed the key id and the tier, not the row. That
 * signature is pinned by the guard that closed the free-tier fit_resume hole,
 * and widening it to carry the whole decision through would loosen the pin for
 * a tool that does not need it.
 */
async function runKeyStatus(client: SupabaseClient, d: Decision): Promise<unknown> {
  const paid = isPaidTier(d.key_tier);
  const apiKeyId = d.api_key_id ?? "";
  const userId = apiKeyId ? await keyOwner(client, apiKeyId) : null;
  const apply = await applyReadiness(client, userId);
  return {
    key: {
      tier: d.key_tier ?? "free",
      paid,
      accountLinked: userId !== null,
      // The key's ROW id, which support can quote back. The key itself is only
      // ever held here as a SHA-256 hash and is never returned by anything.
      id: apiKeyId || null,
    },
    rate: {
      limit: d.rate_limit,
      used: d.rate_used,
      remaining: Math.max(0, d.rate_limit - d.rate_used),
      window: "the current UTC clock minute",
      resetsInSeconds: secondsToNextMinute(),
    },
    quota: {
      limit: d.quota_limit,
      used: d.quota_used,
      remaining: Math.max(0, d.quota_limit - d.quota_used),
      window: "one UTC day",
      resetsInSeconds: secondsToMidnightUtc(),
    },
    features: {
      fit_resume: paid,
      rankedEngine: paid,
      request_application: apply.ready === true,
    },
    apply,
    counted: "These figures include this call — key_status is metered like every other tool.",
    ...(paid ? {} : { upgrade: "https://resumebooster.work/data-api" }),
    docs: DOCS_URL,
  };
}

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
    case "get_jobs": return toolOk(await runGetJobs(args));
    case "check_jobs_open": return toolOk(await runCheckJobsOpen(args));
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
        "need any free API key from https://resumebooster.work/data-api" +
        " — and so do get_jobs, check_jobs_open, debug_search and key_status. " +
        "Call key_status first: it says what this key's tier, limits and powers are, so nothing has to be discovered by refusal. " +
        "Verify a shortlist with check_jobs_open (200 ids per call) and read it with get_jobs (10) rather than one get_job each — " +
        "the daily quota counts calls, not ids. " +
        "fit_resume needs a paid key, like POST /v1/fit. The apply tools additionally need an " +
        "account-linked key, an Agent plan, and a standing mandate — see " + DOCS_URL + ". " +
        "Counts are honest: countUnavailable means the board refuses to guess, and ignoredFilters names any filter it could not apply.",
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
    // key_status is answered HERE and not in callTool because what it reports
    // IS `d` — the decision this call was allowed by. See runKeyStatus.
    const result = toolName === "key_status"
      ? toolOk(await runKeyStatus(client, d))
      : await callTool(client, d.api_key_id ?? "", d.key_tier, toolName, toolArgs);
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
