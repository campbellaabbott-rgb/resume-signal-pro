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
// An agent's search is not a candidate's search. Both land in the same demand
// log; only this header tells them apart. See _shared/search-caller.ts.
import { searchCallerHeader } from "../_shared/search-caller.ts";
import { computeFit, resumeRoleTerms } from "../_shared/fit-score.ts";
import { applyServingFences, parseCountries } from "../_shared/mandate-reach.ts";
import {
  ENTITLEMENT_COLUMNS,
  mayApply,
  normalizeEmail,
  passIsLive,
  rowIsEntitled,
  type PassRow,
  type SubscriberRow,
} from "../_shared/agent-entitlement.ts";
// The pass's vocabulary — its tier string and product identity — read from
// the one module that spells them. No number from that module is needed
// here: every figure key_status reports about a pass comes off the pass row
// api_key_check already read, never off a constant.
import { PASS_TIER } from "../_shared/pass.ts";
// "Is this key paid" and "may this key score a résumé" are two questions,
// answered by one shared module so public-api and this server cannot
// disagree; a live pass is fit-capable and NOT paid (see key-tier.ts).
import { hasFitAccess, isPaidKeyTier } from "../_shared/key-tier.ts";
// OAuth for the hosts that hold only a token (claude.ai, ChatGPT): the token
// is verified by the module, its subject mapped to the account's one live
// key, and that key is metered by the same api_key_check a pasted key is.
// The sign-in challenge and the metadata document are built there too; this
// file only decides WHEN each is answered.
import {
  OAUTH_SCOPE,
  bearerChallenge,
  isProtectedResourceMetadataPath,
  looksLikeApiKey,
  oauthVia,
  protectedResourceResponse,
  subToKeyHash,
  unauthorized,
  verifyOAuthBearer,
} from "./oauth.ts";

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
// 09-04.3: copy only — search_jobs no longer spells a corpus figure (the
// board outgrew it; board_stats carries the live totals) and board_stats
// describes its second figure as the count of boards its runner returns.
// 09-04.4: employer_hiring_record and employer_growth — the closure ledger's
// per-board record and the board's own growth verdict, each one existing RPC
// translated through the service client and metered like every other tool.
// The same version also opens the unkeyed read tier (ANON_TOOLS below, metered
// in mcp_anon_rate, never in rate_limits), adds the search/fetch aliases in
// the fixed shape ChatGPT's research connector calls, declares an outputSchema
// on every tool, and rewrites initialize.instructions to name the four tiers.
// 09-04.5: the Agent Pass (a live pass answers as its own tier through
// api_key_check; request_application consumes through one RPC; key_status
// reports the pass off its row) and OAuth for the hosts that hold only a
// token: the protected-resource metadata on GET, a sign-in challenge for a
// keyed tool called with no credential, a verified token mapped to the
// account's key so it meters through the same check, and per-tool
// securitySchemes on tools/list for the hosts that read them.
// 09-04.6: the attach menu. Three prompts (prompts/list, prompts/get) whose
// bodies are functions of the registry; three static resources
// (resources/list, resources/read) — a guide derived from the registry, the
// board's statistics, this key's status — plus a per-card resource_link on
// search results that resources/read resolves; serverInfo gains a title,
// the human page and an icon; the opening of initialize.instructions says
// what the server is and what to call first (it opened with the rate caps)
// and states that a /jobs?job=<id> link's id is the argument the detail
// tools take; and, for a host that reads its sign-in cue out of a result's
// _meta rather than the transport, the same challenge in band (a GUESS at
// ChatGPT's behaviour, labelled so at the site).
const SERVER_INFO = {
  name: "resumebooster-job-board",
  version: "2026-09-04.6",
  // 2025-11-25 Implementation fields, additive: a display name, the human
  // page, and an icon a host may show beside the connector.
  title: "Resume Booster job board",
  websiteUrl: "https://resumebooster.work/agents",
  icons: [{ src: "https://resumebooster.work/icons/icon-192.png", mimeType: "image/png", sizes: ["192x192"] }],
};
const DOCS_URL = SERVER_INFO.websiteUrl;
/** Where a free key is minted — the page every refusal in this file points at. */
const MINT_URL = "https://resumebooster.work/data-api";
/** Where a pass is bought, signed in — the fix every pass refusal names. */
const PASS_URL = "https://resumebooster.work/agents/pass";
/** A posting's address on the site: the board opens ?job= in its detail panel (Jobs.tsx jobHref). */
const SITE_JOB_URL = (id: string) => `https://resumebooster.work/jobs?job=${encodeURIComponent(id)}`;

// ── The unkeyed read tier ───────────────────────────────────────────────────
//
// Measured 2026-09-15: a keyless tools/call answered 200 + isError, which
// Claude passes to the model as a tool failure and moves on — no prompt, no
// card. claude.ai, Claude Desktop and ChatGPT all offer a no-auth connect path
// and none of their dialogs has a field for a bearer key, so for every user of
// those hosts the first thing this server did was refuse. These four tools
// answer with no key at all; everything else, called with no credential,
// answers the sign-in challenge the OAuth module builds — the response a
// host turns into its Connect card — now that an authorization server
// stands behind it. A key in the slot is still checked and metered exactly
// as before.
//
// Why FOUR: board_stats is a cache read and the honest first answer; search
// is the thing every board sells; `search` and `fetch` are the same two
// runners under the names ChatGPT's research connector requires. Nothing in
// this set touches a key's row, an account, or the paid scorer.
const ANON_TOOLS: readonly string[] = ["board_stats", "search_jobs", "search", "fetch"];
/** Rows an unkeyed search may return — a page of the board, not a dump of it. */
const ANON_SEARCH_LIMIT = 10;
/**
 * Rows a keyed search may return per page, and ids check_jobs_open answers
 * in one call. Each is read here by the runner that clamps to it, the
 * schema that declares it, the unkeyed note and the instructions that name
 * it — one constant per cap, never typed twice (the guard renders the
 * instructions with these and the mirror pins them cross-runtime).
 */
const KEYED_SEARCH_LIMIT = 60;
const CHECK_JOBS_OPEN_MAX = 200;
// TWO CAPS, AND WHAT EACH ONE ACTUALLY BOUNDS. The address cap bounds one
// caller — to the extent the address is the platform's word and not the
// caller's (see callerAddress: a header no proxy appended is the caller's own
// claim, and a caller who can rotate it has a fresh allowance per value; the
// global cap is then the only bound against a script). For claude.ai and
// ChatGPT, whose users all arrive from a handful of shared egress addresses,
// the address cap is NOT per user: it is a per-host allowance of the cap
// times that host's egress addresses per day, and the second user of the day
// behind one address can still meet the wall. Neither cap fixes that; a
// signed-in user on those hosts is metered by their own key row instead
// (the OAuth path below), and the unkeyed remainder is accepted as is. The
// global cap bounds one thing only: what the unkeyed tier can cost the board
// in a day, whoever spends it. Both are counted by mcp_anon_check (migration
// 20260915100000) in its own table; NEVER through check_rate_limit or
// rate_limits, the budget that once 429'd résumé upload and checkout when
// board traffic fed it. The address is never stored: the bucket is a 16-hex
// prefix of its SHA-256.
const ANON_GLOBAL_CAP_PER_DAY = 2000;
const ANON_IP_CAP_PER_DAY = 25;
/**
 * What a free key raises the daily allowance to. key_status reads a key's
 * quota off the api_key_check decision, which api_key_issue set at minting
 * from its own c_quota constant (migration 20260826214700); an unkeyed call
 * has no decision to read, so this is that constant's mirror, pinned to the
 * migration by src/test/a-first-call-with-no-key-gets-an-answer-not-a-wall.
 */
const FREE_KEY_DAILY_QUOTA = 1000;

/** Field names mirror mcp_anon_check's OUT parameters (20260915100000). */
type AnonDecision = { allowed: boolean; global_used: number; ip_used: number; ip_cap: number; global_cap: number };

/**
 * The caller's address as the PLATFORM saw it, never as the caller wrote it.
 * cf-connecting-ip is set by the edge in front of this runtime and cannot be
 * supplied from outside it; failing that, the LAST hop of x-forwarded-for is
 * the one the nearest proxy appended, while the first hop is whatever the
 * caller put there (a forged leading entry is pushed left, not trusted).
 * "unknown" when neither header exists — every such caller then shares one
 * bucket, which is the honest reading of an address we were never told.
 */
function callerAddress(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = String(headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || "unknown";
}

// EXPOSED, OR THEY MIGHT AS WELL NOT BE SENT — same lesson public-api learned:
// a browser-side MCP client cannot read rate headers absent from
// Access-Control-Expose-Headers.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers":
    "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-Quota-Limit, X-Quota-Remaining, X-Unkeyed-Remaining",
};

// Field names mirror api_key_check's OUT parameters, which were RENAMED in
// 20260826161200 after the 42702 outage — see that migration before touching.
// The two pass columns were appended in 20260917120000: while an open pass
// exists on an /mcp/ endpoint the row answers key_tier = the pass tier and
// the pass's own limits; pass_ends_at is NULL until the pass is activated
// (which the first allowed call other than key_status does, in SQL).
type Decision = {
  is_allowed: boolean; deny_reason: string; api_key_id: string | null; key_tier: string | null;
  rate_limit: number; rate_used: number; quota_limit: number; quota_used: number;
  pass_ends_at?: string | null; pass_apps_left?: number | null;
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

/**
 * The caller's arguments cannot be answered as sent — too many tokens, none at
 * all. Its own class so the dispatcher can hand back the message and the fix
 * in band, instead of the generic "internal error, try again shortly" that
 * would tell an agent to retry a call that cannot succeed until it is changed.
 */
class ToolArgumentError extends Error {
  constructor(message: string, public readonly fix: string) {
    super(message);
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon, ...searchCallerHeader("mcp") },
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
  limit: { type: "number", description: `Rows per page, 1-${KEYED_SEARCH_LIMIT}. Default 20.` },
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
 * human before each call — including board_stats, which reads a cache. All but
 * one of the tools here only read; saying so is what lets an agent search,
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

// ── The moat, as two read tools ─────────────────────────────────────────────
//
// The search every board offers was the only thing this server sold. The one
// asset no other board can serve is the lifecycle record — postings observed
// opening AND coming down on the employer's own board, logged since 2026-07-14
// — and it reaches clients only through SECURITY DEFINER aggregates that
// already exist. Both tools below translate one such RPC one-to-one through
// the service client: no second derivation, no new SQL, no direct ledger read.
//
// A token may be asked about in a batch, and a batch is one metered call. The
// cap is the same order as get_jobs: the RPCs seek per token into the closure
// ledger and the daily snapshot series, and a list past it is refused with the
// count named rather than silently trimmed.
const EMPLOYER_TOKENS_MAX = 20;

/**
 * THE GROWTH BARS, MIRRORED FROM THE MIGRATION THAT JUDGES THEM.
 *
 * get_company_growth owns the verdict; these numbers exist here so the tool's
 * description can SAY what the verdict measures, and for nothing else — no
 * runner compares a row against them. They are pinned to the migration's own
 * bar CTE by src/test/the-bars-an-agent-is-told-are-the-bars-the-verdict-uses
 * (mirror constant + cross-runtime test, the claim-drift lesson: copy goes
 * false when the thing it describes moves runtimes). Jobs.tsx carries the same
 * mirror for the site's copy, pinned by its own guard.
 */
const GROWTH_BARS = {
  windowDays: 7,
  minBaselineServed: 10,
  minNetAdd: 4,
  minRate: 0.25,
  minTenureDays: 21,
} as const;

/**
 * WHY A GROWTH READING IS UNKNOWN — the migration's own vocabulary, in the
 * order its CASE tests them. Pinned to the migration's arms by the same guard.
 * An unknown is a fact about our instrument, never about the employer, and it
 * always carries one of these; the two readings that ARE about the employer
 * (grew, no-growth) carry null.
 */
const GROWTH_UNKNOWN_REASONS = [
  "excluded", "series_stale", "no_series", "too_new", "series_gap", "too_small",
  "pool_replaced", "not_in_ledger", "windowed_read", "failed_read", "ledger_gap",
] as const;

/** The closure window get_company_hiring_health counts over, and the cap on tracking_days. */
const HIRING_RECORD_WINDOW_DAYS = 90;

/**
 * WHAT THE RECORD IS AND IS NOT, in the words the site uses for the same half
 * of its "Actively hiring" basis (src/i18n/locales/en.json, keys
 * jobsPage.hiringBasis3 and jobsPage.hiringBadgeTip3) — copied, not rewritten,
 * so an agent and a person reading the site are told the same thing about the
 * same ledger. Never a hire: a filled role, a cancelled one and a withdrawn one
 * look identical from here.
 */
const HIRING_RECORD_BASIS =
  `A record of one BOARD (a vendor tenant), never summed across an employer's boards, and never a headcount. ` +
  `closed_${HIRING_RECORD_WINDOW_DAYS}d counts postings we watched come off this board in the last ${HIRING_RECORD_WINDOW_DAYS} days ` +
  `on a board read to the end — in one visit or across a provable full lap — excluding re-lists (an identical title still live within a day, counted separately in ` +
  `superseded_${HIRING_RECORD_WINDOW_DAYS}d, which is a floor), excluding takedowns the collector marked as its own ` +
  `collection failure, and excluding takedowns first observable on a big board's first laps. A takedown is not a hire ` +
  `— a filled role, a cancelled one and a withdrawn one look identical from here. tracking_days is how long we have ` +
  `watched THIS board (capped at ${HIRING_RECORD_WINDOW_DAYS}), not the age of the ledger. median_days_open and ` +
  `median_days_to_close are measured from the employer's own stated posting dates only, and both are LOWER BOUNDS: ` +
  `serving stops at 30 days, so no closure can be observed later than that, and neither is a typical time-to-fill. ` +
  `The site's "Actively hiring" chip is judged from a stricter read of the same ledger and this tool does not ` +
  `reproduce that judgement; these figures are the record itself.`;

const HIRING_RECORD_UNKNOWN = {
  no_record:
    "This board holds no open posting, no closure and no feed check for this token — either it is not a token this " +
    "board carries (take companyToken from job cards or search_jobs), or nothing has been observed yet.",
  no_closures_observed:
    "Not one closure-ledger entry for this board in the window. On a board we do read in full, it means nothing came " +
    "down while we watched; on a board bigger than one visit can read, no closure is observable to us until we complete " +
    "a provable full pass and then watch a role go after it. The two cannot be told apart from here — so this is " +
    "unknown, not a verdict about the employer.",
} as const;

const HIRING_RECORD_ROW_SCHEMA = {
  type: "object",
  properties: {
    company_token: { type: "string" },
    record: {
      type: "string", enum: ["observed", "unknown"],
      description: "observed: the ledger holds at least one closure for this board in the window, so the figures speak. unknown: it holds none, with unknown_reason saying why that is not a finding.",
    },
    unknown_reason: { type: ["string", "null"], enum: [...Object.keys(HIRING_RECORD_UNKNOWN), null] },
    open_roles: { type: "integer", description: "Postings served from this board right now, under the same two serving rules as search." },
    [`closed_${HIRING_RECORD_WINDOW_DAYS}d`]: { type: "integer", description: "Watched takedowns in the window, re-lists excluded. Never a count of hires." },
    [`superseded_${HIRING_RECORD_WINDOW_DAYS}d`]: { type: "integer", description: "Re-lists in the window — a FLOOR, one logged per title per day." },
    median_days_open: { type: ["number", "null"], description: "Median age of the roles served now, from the employer's stated dates only. Null when none carry one." },
    median_days_to_close: { type: ["number", "null"], description: "Median stated-date-to-takedown over the window's dated closures. A lower bound; null when no closure carries a date." },
    tracking_days: { type: ["integer", "null"], description: "Days this board has been watched, capped." },
    feed_total: { type: ["integer", "null"], description: "What the employer's feed advertised at the last verification. Null when never verified." },
    basis: { type: "string" },
    note: { type: "string", description: "Present on an unknown row: what the absence means and does not mean." },
  },
  required: ["company_token", "record", "basis"],
  additionalProperties: true,
};

const GROWTH_ROW_SCHEMA = {
  type: "object",
  properties: {
    company_token: { type: "string" },
    verdict: {
      type: "string", enum: ["grew", "no-growth", "unknown"],
      description: "The board's own judgement, passed through untouched. unknown is NOT no-growth: it is a reading we could not take, and unknown_reason says why.",
    },
    unknown_reason: {
      type: ["string", "null"], enum: [...GROWTH_UNKNOWN_REASONS, null],
      description: "Null for grew and no-growth. Otherwise the gate that refused, in the migration's own words.",
    },
    window_days: { type: "integer" },
    baseline_day: { type: ["string", "null"], description: "Our observation date at the window's start." },
    baseline_served: { type: ["integer", "null"], description: "Roles served on this board on baseline_day." },
    latest_day: { type: ["string", "null"], description: "Our latest observation date." },
    latest_served: { type: ["integer", "null"] },
    net: { type: ["integer", "null"], description: "latest_served minus baseline_served: roles opened net of roles that came down. Not a headcount." },
    rate: { type: ["number", "null"], description: "net over baseline_served. Null when the baseline is zero or unread." },
    days_observed: { type: "integer" },
    days_expected: { type: "integer" },
    ledger_days_expected: { type: "integer" },
    board_days_ok: { type: "integer", description: "Days in the read-quality ledger whose read of this board was whole." },
    board_days_bad: { type: "integer" },
    first_snapshot_day: { type: ["string", "null"] },
    tenure_days: { type: ["integer", "null"], description: "Days between the board's first daily observation and the window's start." },
    tenure_censored: { type: ["boolean", "null"], description: "True when the board is as old as the series itself, so its real tenure is longer than we can say." },
    untracked_departures: { type: ["integer", "null"], description: "OUR removals over the window — never counted as the employer shrinking." },
    removed_departures: { type: ["integer", "null"] },
    observed_arrivals: { type: ["integer", "null"] },
  },
  required: ["company_token", "verdict", "unknown_reason"],
  additionalProperties: true,
};

const TOOLS = [
  {
    name: "search_jobs",
    title: "Search jobs",
    description:
      "Search the live job board (postings pulled directly from employers' own hiring systems, 30-day freshness cap; board_stats carries the live totals). " +
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
    description:
      "Full detail for one job id (from search_jobs), including the complete description text and when the employer's feed last confirmed it open. " +
      "A resumebooster.work/jobs?job=<id> link's id is this argument (and fetch's, check_apply_support's and request_application's). " +
      "For several ids at once, use get_jobs — it costs ONE call against the daily quota instead of one per posting.",
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
      `Are these postings still on the board? Answers up to ${CHECK_JOBS_OPEN_MAX} ids in one call — the tool for re-verifying a saved shortlist ` +
      "before acting on it, instead of spending a metered get_job per posting. Returns open:{id:boolean} plus the closed ids, " +
      "and names the basis of the answer: it reads the board's index (a closed posting is one the employer's feed stopped " +
      "listing), not the employer's site at this instant, and it is a weaker test than get_job's — read `basis` before " +
      "reporting a posting as live to a person.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, maxItems: CHECK_JOBS_OPEN_MAX, description: `Job ids from search_jobs. Up to ${CHECK_JOBS_OPEN_MAX} per call; anything past that is named in notChecked rather than silently dropped.` },
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
    outputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        agentReady: { type: "boolean", description: "True when the posting's hiring system is one the apply agent can submit to." },
        vendor: { type: ["string", "null"], description: "The hiring-system prefix of the id, e.g. 'greenhouse'. Null when the id carries none." },
        applyUrl: { type: "string", description: "The employer's own apply page. ABSENT when the board could not read the posting." },
        requirements: { type: "array", items: { type: "string" }, description: "What applying through the agent needs — or, on a non-supported system, the one line saying the human applies at applyUrl." },
      },
      required: ["jobId", "agentReady", "vendor", "requirements"],
      additionalProperties: true,
    },
  },
  {
    name: "request_application",
    title: "Request an application",
    description:
      "Ask the board's apply agent to submit an application to this job on behalf of the key's owner. " +
      "Requires an account-linked key (mint one at " + DOCS_URL + "), an active Agent plan OR a live pass (bought signed-in at " + PASS_URL + "), and a standing mandate — " +
      "key_status says whether this key has all three before you spend a call finding out, and on a pass how many applications and how much time are left. " +
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
    outputSchema: {
      // A UNION, and the schema says so: the runner answers one of three
      // shapes, and `accepted` is the one key every branch carries.
      type: "object",
      properties: {
        accepted: { type: "boolean", description: "False when a gate refused; true when the request is in the agent's queue (or already was)." },
        refusedBy: { type: "string", description: "Refused only: the gate — key, jobId, mandate, resume, plan (no Agent plan and no live pass), pass (the pass has no applications left or its clock ended), posting, scope-country, scope-category, scope-age, scope-salary." },
        error: { type: "string", description: "Refused only: what the gate said." },
        fix: { type: "string", description: "Refused only: what would change the answer." },
        alreadyQueued: { type: "boolean", description: "Accepted only: this job was already in the queue — nothing duplicated, and on a pass nothing spent." },
        passApplicationsLeft: { type: ["integer", "null"], description: "Accepted on a pass: applications left on it after this one. Null when a subscription funded the request." },
        queueStatus: { type: "string", description: "With alreadyQueued: the existing row's status." },
        jobId: { type: "string" },
        title: { type: "string" },
        company: { type: "string" },
        fitPct: { type: ["number", "null"], description: "Keyword fit of the résumé on file to this posting, 0-100; null when the posting has no text to score." },
        warning: { type: "string", description: "Accepted but flagged: below the release floor, or a system the agent prepares for rather than submits to." },
        whatHappensNext: { type: "string" },
        note: { type: "string" },
      },
      required: ["accepted"],
      oneOf: [
        { required: ["accepted", "refusedBy", "error", "fix"] },
        { required: ["accepted", "alreadyQueued"] },
        { required: ["accepted", "jobId", "fitPct", "whatHappensNext"] },
      ],
      additionalProperties: true,
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
    outputSchema: {
      // A UNION: a key with no account answers {error, fix} in band rather
      // than throwing, and an account answers its two lists plus the legend.
      type: "object",
      properties: {
        queued: {
          type: "array",
          items: {
            type: "object",
            properties: { postingId: { type: "string" }, title: { type: "string" }, company: { type: "string" }, status: { type: "string" } },
            required: ["postingId", "status"],
            additionalProperties: true,
          },
          description: "Requests waiting for the hourly preparer, newest first.",
        },
        applications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              postingId: { type: "string" }, title: { type: "string" }, company: { type: "string" }, vendor: { type: "string" },
              status: { type: "string" },
              notReleasedBecause: { type: "string", description: "Present when release was refused: the gate, named." },
              needsHumanFor: { type: "array", items: { type: "string" }, description: "Present when blocked: the kinds of answer the classifier would not invent." },
              submittedAt: { type: "string" }, submittedVia: { type: "string" },
            },
            required: ["postingId", "status"],
            additionalProperties: true,
          },
          description: "Prepared packets and their outcome, newest first.",
        },
        statusKey: { type: "object", additionalProperties: { type: "string" }, description: "What each status word means." },
        error: { type: "string", description: "Only when this key is not linked to an account." },
        fix: { type: "string" },
      },
      oneOf: [
        { required: ["queued", "applications", "statusKey"] },
        { required: ["error", "fix"] },
      ],
      additionalProperties: true,
    },
  },
  {
    name: "fit_resume",
    title: "Score a résumé against the board",
    description:
      "PAID — needs a paid API key, exactly like POST /v1/fit on the data API, or a live pass on the key's account; a free key gets an in-band refusal with the upgrade link. " +
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
    description:
      "Live board statistics from cache (cheap to call): servable and tracked posting totals, the count of company job boards with open roles (boards, not employers — one employer can run several), the category set, freshness stamp. " +
      "Answers with no key too, with a withKey block saying what a free key adds.",
    annotations: READS_THE_BOARD,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        servablePostings: { type: ["integer", "null"], description: "Postings the board serves right now: not withdrawn, dated within the freshness window. Null when the pass did not compute it." },
        trackedPostings: { type: ["integer", "null"], description: "Every posting the board holds, including ones outside the serving rules." },
        openCompanyBoards: { type: ["integer", "null"], description: "Company job boards with at least one servable posting. BOARDS, not employers — read openCompanyBoardsBasis." },
        openCompanyBoardsBasis: { type: "string" },
        categories: { type: "array", items: { type: "string" }, description: "The category slugs search_jobs accepts." },
        freshnessWindowDays: { type: "integer" },
        refreshedAt: { type: ["string", "null"], description: "When the cache these figures come from was last written." },
        note: { type: "string" },
        withKey: {
          type: "object",
          properties: {
            mintUrl: { type: "string" },
            dailyCalls: { type: "integer", description: "Calls a day on a free key." },
            adds: { type: "string", description: "What a free key opens beyond the unkeyed tools." },
          },
          required: ["mintUrl", "dailyCalls", "adds"],
          description: "Present on an unkeyed call: where a free key comes from and what it adds.",
        },
      },
      required: ["servablePostings", "openCompanyBoards", "openCompanyBoardsBasis", "categories", "freshnessWindowDays"],
      additionalProperties: true,
    },
  },
  {
    name: "employer_hiring_record",
    title: "An employer's hiring record on this board",
    description:
      "The closure ledger no other board keeps, per employer: one row per companyToken with open_roles now, " +
      `closed_${HIRING_RECORD_WINDOW_DAYS}d (postings we watched come off this board in the last ${HIRING_RECORD_WINDOW_DAYS} days, re-lists excluded), ` +
      `superseded_${HIRING_RECORD_WINDOW_DAYS}d (the re-lists, a floor), the two medians from the employer's own stated dates (lower bounds), ` +
      `tracking_days (how long we have watched THIS board, capped at ${HIRING_RECORD_WINDOW_DAYS}) and feed_total (what its feed advertised at the last check). ` +
      "What it is NOT: A takedown is not a hire — a filled role, a cancelled one and a withdrawn one look identical from here — " +
      "and it is a record of one BOARD, never summed across an employer's boards, never a headcount. A board with no closure " +
      "observed answers record:'unknown' with the reason, never a verdict about the employer: on a board bigger than one visit " +
      "can read, no closure is observable to us until we complete a provable full pass and then watch a role go after it, " +
      "so silence there is about our instrument. " +
      `Up to ${EMPLOYER_TOKENS_MAX} tokens per call; every row carries its basis. Pair with employer_growth for the other half of what the site calls "Actively hiring".`,
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: {
        companyTokens: {
          type: "array", items: { type: "string" }, minItems: 1, maxItems: EMPLOYER_TOKENS_MAX,
          description: `companyToken values from job cards or search_jobs (a vendor tenant, e.g. 'acme' or 'gici~wd5~Careers'). Up to ${EMPLOYER_TOKENS_MAX}; more is refused with the count named.`,
        },
      },
      required: ["companyTokens"],
    },
    outputSchema: {
      type: "object",
      properties: {
        employers: { type: "array", items: HIRING_RECORD_ROW_SCHEMA, description: "One row per token asked, in the order asked. A token the board does not carry still answers, as unknown." },
        asked: { type: "integer" },
        window_days: { type: "integer" },
        basis: { type: "string" },
      },
      required: ["employers", "basis"],
      additionalProperties: true,
    },
  },
  {
    name: "employer_growth",
    title: "Did this employer's board grow?",
    description:
      "Whether an employer's board served more roles than it did a week earlier, judged by the board itself from our own " +
      `daily observation: one row per companyToken, roles served on the latest day against ${GROWTH_BARS.windowDays} days earlier. ` +
      "Three verdicts, passed through untouched — grew, no-growth, unknown — and unknown ALWAYS carries unknown_reason " +
      "(a feed bigger than one visit can read, a board too new or too small for a rate, a gap in our own series, a pool " +
      "that was replaced rather than grown…): an unknown is a reading we could not take, never a no. The bars the verdict " +
      `uses: at least ${GROWTH_BARS.minBaselineServed} roles served at the window's start; then BOTH at least ${GROWTH_BARS.minNetAdd} more roles ` +
      `AND at least ${Math.round(GROWTH_BARS.minRate * 100)}% more, on a board tracked for at least ${GROWTH_BARS.minTenureDays} days, ` +
      "with every read in the window whole. Per BOARD (a vendor tenant), never summed across an employer's boards; more " +
      "roles served is roles opened net of roles that came down — not a headcount and not a hire. " +
      `Up to ${EMPLOYER_TOKENS_MAX} tokens per call. This tool never ranks employers, and no list of growing employers exists here or anywhere on the board.`,
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: {
        companyTokens: {
          type: "array", items: { type: "string" }, minItems: 1, maxItems: EMPLOYER_TOKENS_MAX,
          description: `companyToken values from job cards or search_jobs. Up to ${EMPLOYER_TOKENS_MAX}; more is refused with the count named.`,
        },
      },
      required: ["companyTokens"],
    },
    outputSchema: {
      type: "object",
      properties: {
        employers: { type: "array", items: GROWTH_ROW_SCHEMA, description: "One row per token asked, in the order asked. A token with no daily series answers unknown with its reason." },
        asked: { type: "integer" },
        bars: {
          type: "object",
          properties: {
            window_days: { type: "integer" }, min_baseline_served: { type: "integer" }, min_net_add: { type: "integer" },
            min_rate: { type: "number" }, min_tenure_days: { type: "integer" },
          },
          required: ["window_days", "min_baseline_served", "min_net_add", "min_rate", "min_tenure_days"],
          description: "What the verdict measured against — for reading a row, never for re-judging one.",
        },
        basis: { type: "string" },
      },
      required: ["employers", "bars", "basis"],
      additionalProperties: true,
    },
  },
  {
    name: "key_status",
    title: "This key's limits and powers",
    description:
      "What THIS key is and what it may do — tier, requests left this minute, calls left today (both including this call), " +
      "whether the paid tools (fit_resume, and engine=ranked on the data API) are available on it, whether the apply " +
      "tools would work: account link, Agent plan or live pass, mandate, résumé on file, with any blocker named — " +
      "and, on a pass, when the clock ends and how many applications are left (a pass starts at the first call other than this one). " +
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
            fit_resume: { type: "boolean", description: "Paid tiers and a live pass, exactly as POST /v1/fit plus the pass." },
            rankedEngine: { type: "boolean", description: "/v1/jobs?engine=ranked on the data API, same key. Paid tiers only — never the pass." },
            request_application: { type: "boolean", description: "True only when every apply gate below already passes." },
          },
          required: ["fit_resume", "rankedEngine", "request_application"],
          additionalProperties: true,
        },
        pass: {
          type: "object",
          description: "The account's pass, if any. Every figure is read off the pass row; nothing here is a constant.",
          properties: {
            state: { type: "string", enum: ["none", "unactivated", "live", "closed"] },
            endsAt: { type: ["string", "null"], description: "When the clock ends. Null until the pass starts." },
            endsInSeconds: { type: ["integer", "null"] },
            applicationsLeft: { type: ["integer", "null"] },
            applicationsTotal: { type: ["integer", "null"] },
            startsOn: { type: "string" },
            buy: { type: "string", description: "Where a pass is bought, signed in." },
          },
          required: ["state", "startsOn", "buy"],
          additionalProperties: true,
        },
        apply: {
          type: "object",
          properties: {
            ready: { type: "boolean" },
            accountLinked: { type: "boolean" },
            planActive: { type: "boolean", description: "An active Agent plan OR a live pass — either funds a new request." },
            subscribed: { type: "boolean", description: "An active Agent plan specifically." },
            passLive: { type: "boolean", description: "A live pass with an application left, specifically." },
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
      required: ["key", "rate", "quota", "features", "pass", "apply"],
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
    outputSchema: {
      type: "object",
      properties: {
        decision: {
          type: "object", additionalProperties: true,
          description: "The board's own explain trace for this query: parsed terms, filters applied or ignored and why, route, retriever and ranking regime. Its keys are the board's and change as the board's decisions do.",
        },
        outcome: {
          type: "object",
          properties: {
            rowsServed: { type: "integer" },
            topTitles: { type: "array", items: { type: ["string", "null"] }, description: "The first five titles served, for a glance at ranking." },
            ...DISCLOSURE_SCHEMA,
            phaseMs: { type: ["object", "null"], additionalProperties: true, description: "Per-phase timings when the board reports them." },
            tookMs: { type: ["number", "null"] },
            rankedFellBack: { type: ["boolean", "null"], description: "True when the ranked path failed and the run fell back." },
          },
          required: ["rowsServed", "topTitles", "phaseMs", "tookMs", "rankedFellBack"],
          additionalProperties: true,
        },
      },
      required: ["decision", "outcome"],
      additionalProperties: true,
    },
  },
  // ── ChatGPT's research connector calls exactly two names ────────────────
  // Deep research and company knowledge in ChatGPT call tools named `search`
  // and `fetch` in a fixed shape and nothing else. Both below are the same
  // runners as search_jobs and get_job under those names — wrappers, never a
  // second reader — and they answer with no key like the tools they wrap.
  {
    name: "search",
    title: "Search (alias of search_jobs, in ChatGPT's research shape)",
    description:
      "An ALIAS of search_jobs in the fixed shape ChatGPT's deep-research and company-knowledge connectors call: " +
      "one query string in, {results:[{id,title,url}]} out. Every result's id is the job id fetch and every other tool take; " +
      "url is the employer's own apply page when the board holds one, else the posting's page on the site. " +
      `Same board, same ranking, same limit as an unkeyed search_jobs (${ANON_SEARCH_LIMIT} rows); the disclosures ride beside the results. ` +
      "Any other client should call search_jobs, which takes every filter.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Free text — title, skills, a place, exclusions with a leading minus." } },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "The job id — pass it to fetch, get_job, check_jobs_open." },
              title: { type: "string", description: "Title and employer, one line." },
              url: { type: "string" },
            },
            required: ["id", "title", "url"],
            additionalProperties: true,
          },
        },
        note: { type: "string" },
        ...DISCLOSURE_SCHEMA,
      },
      required: ["results"],
      additionalProperties: true,
    },
  },
  {
    name: "fetch",
    title: "Fetch (alias of get_job, in ChatGPT's research shape)",
    description:
      "An ALIAS of get_job in the fixed shape ChatGPT's deep-research and company-knowledge connectors call: " +
      "one id in (from search), {id,title,text,url,metadata} out. text is the posting's full description; metadata carries the " +
      "job card's structured fields (pay, experience, location, workMode, postedAt, companyToken, agentReady). A dead id answers " +
      "with what the board knows — a watched closure, an aged-out stub, or not found — in text and metadata, never a stale card. " +
      "Any other client should call get_job.",
    annotations: READS_THE_BOARD,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "A job id from search." } },
      required: ["id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: ["string", "null"], description: "Null when there is no posting to return; read metadata.closed / agedOut / notFound." },
        text: { type: "string", description: "The description, or the board's one-line reason when there is none." },
        url: { type: "string" },
        metadata: { type: "object", additionalProperties: true, description: "The compact job card without the description; on a dead id, the board's closed/agedOut/notFound record." },
        note: { type: "string" },
      },
      required: ["id", "title", "text", "url", "metadata"],
      additionalProperties: true,
    },
  },
];

/**
 * THE TIERS, DERIVED FROM THE REGISTRY rather than typed into a sentence:
 * initialize.instructions and board_stats' withKey block name what a free key
 * opens, and a list typed there would be the six-tools page again. The paid
 * and account sets are the two gates callTool applies (hasFitAccess; a runner
 * that refuses a key with no owner) — pinned to the page's mirror, which is
 * pinned to that dispatch, by the guards named in src/config/mcp-tools.ts.
 */
const PAID_TOOLS: readonly string[] = ["fit_resume"];
const ACCOUNT_TOOLS: readonly string[] = ["request_application", "application_status"];
const KEY_ONLY_READ_TOOLS: readonly string[] = TOOLS.map((t) => t.name)
  .filter((n) => !ANON_TOOLS.includes(n) && !PAID_TOOLS.includes(n) && !ACCOUNT_TOOLS.includes(n));

/**
 * A registered tool's name, or a thrown error. The prompts, the guide and the
 * opening of initialize.instructions reach a tool's name ONLY through this,
 * so none of them can spell a tool the registry does not hold — a name typed
 * into prose is a second list, and the second list is the one that drifts.
 * Thrown at module load for the static texts and at the first request for
 * the bodies built per call; src/test guards read the same call sites.
 */
const tool = (name: string): string => {
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`an unregistered tool is named: ${name}`);
  return name;
};

// ── Prompts: three entry points, every tool name read off the registry ─────
//
// Surfaced by claude.ai's attach menu, Claude Code's slash list and Cursor's
// panel; ChatGPT has no prompt UI. Three, not four: the fourth the lanes
// proposed was a per-field list of growing employers, the leaderboard shape
// employer_growth's own description refuses. Every body is a FUNCTION of the
// registry at request time — a name reaches a body only through tool() — and
// names gates, never prices. The résumé prompt STARTS with the unkeyed path,
// so a caller with no key gets a result rather than a sign-in dead end, and
// names the verification step as the one that needs a key. resume_text is
// optional because Claude Code splits slash-command arguments on whitespace
// and a CV cannot travel that way; the body asks for it in the conversation.
//
// prompts/list and prompts/get are free and unmetered, with or without a
// credential — discovery must not spend a real call, and a body is a
// function of the registry, not of the caller's key. Neither reaches
// api_key_check or mcp_anon_check, so no api_usage row and no pass clock
// can come of reading one (the adoption reader's prompt family therefore
// reads zero by construction).
type PromptArgs = Record<string, string>;
type Prompt = {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  body: (args: PromptArgs) => string;
};

const PROMPTS: readonly Prompt[] = [
  {
    name: "find_roles_for_my_cv",
    title: "Find roles that fit my CV",
    description:
      "Read the occupation out of a CV, search the live board, then verify the shortlist is still open (needs a key or sign-in for that step).",
    arguments: [
      { name: "resume_text", description: "The CV as plain text; leave empty in a slash command and paste it in the conversation.", required: false },
      { name: "location", description: "City, state, country or 'remote'.", required: false },
    ],
    body: (a) =>
      `1) If no CV text is in this conversation, ask for it — never invent one. ` +
      `2) Read the most recent job title out of the CV and call ${tool("search_jobs")} with query = that title, ` +
      `location = ${a.location ? `"${a.location}"` : "the place the CV or the person names (omit it if neither does)"}, limit = ${ANON_SEARCH_LIMIT}, and show the cards — this step needs no key. ` +
      `3) To verify the shortlist is still open call ${tool("check_jobs_open")} with the ids — that step needs a key or a sign-in; if this connection has neither, say so and stop. ` +
      `4) Answer as a table: title, employer, location, pay only when the card states it (salaryMinAnnual/salaryMaxAnnual, never re-read from prose), agentReady; ` +
      `then relay the board's own disclosures — ignoredFilters (a filter it could not apply) and countUnavailable (it refused to guess a total). ` +
      `Never request an application without an explicit yes per job.` +
      (a.resume_text ? `\n\nCV:\n${a.resume_text}` : ""),
  },
  {
    name: "apply_to_my_shortlist",
    title: "Apply to my shortlist",
    description:
      `${tool("key_status")} first (plan or pass, mandate, résumé on file, applications left), then one ${tool("request_application")} per job id after the person confirms each.`,
    arguments: [
      { name: "job_ids", description: `Comma-separated job ids from ${tool("search_jobs")}.`, required: true },
    ],
    body: (a) =>
      `1) Call ${tool("key_status")} first: it says whether this connection may apply at all — an account-linked key, an Agent plan or a live pass, ` +
      `a standing mandate, a résumé on file — and, on a pass, how many applications are left. If any gate in apply.blockers is closed, name it and stop; ` +
      `never call ${tool("request_application")} to find out. ` +
      `2) For each of these ids — ${a.job_ids || "(none given: ask for them)"} — call ${tool("check_apply_support")}; where the hiring system is one the agent cannot submit to, ` +
      `give the person the applyUrl instead. ` +
      `3) Read the remaining cards with ${tool("get_jobs")} (up to ${GET_JOBS_MAX} ids per call) and ask for an explicit yes for EACH job. ` +
      `4) Only after a yes, call ${tool("request_application")} with that jobId, and report accepted, alreadyQueued or refusedBy exactly as answered. ` +
      `Never apply without a yes per job, and never invent an answer to an employer's question: the pipeline draws every answer from the owner's own profile.`,
  },
  {
    name: "what_can_my_key_do",
    title: "What can this connection do right now",
    description:
      `One call to ${tool("key_status")}, explained: tier, calls left, whether ${tool("fit_resume")} and the apply tools would answer, and what would change the answer.`,
    arguments: [],
    body: () =>
      `Call ${tool("key_status")} once and explain the answer in plain words: the tier; requests left this minute and calls left today (both include that call); ` +
      `whether ${tool("fit_resume")} would answer (features.fit_resume) and whether the apply tools would (features.request_application, with every entry of apply.blockers named); ` +
      `on a pass, when its clock ends and how many applications remain — or that it has not started yet (it starts at the first call other than ${tool("key_status")}). ` +
      `Then say what would change each closed answer, as the response's own fix and upgrade fields put it — name the gate, never a price. ` +
      `If the call answers a sign-in challenge instead, this connection holds no key: say that the unkeyed tools (${ANON_TOOLS.join(", ")}) still answer, and stop.`,
  },
];

/** The prompts/get answer: one user message, the body rendered for these arguments. */
function promptMessages(p: Prompt, args: PromptArgs): { description: string; messages: { role: "user"; content: { type: "text"; text: string } }[] } {
  return { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.body(args) } }] };
}

// ── Resources: the static pair, this key, and a card's own link ────────────
//
// Surfaced by claude.ai's attach menu and Claude Code's @-mention list
// (listed resources only — no host documents surfacing templates, so none is
// declared). Three static URIs: the guide, derived from the registry at
// request time; the board's statistics, the board_stats runner's payload;
// and this key's status, the key_status runner's payload. Search results
// additionally carry one resource_link per card — a URI a host MAY render as
// an attachable object, and which resources/read resolves to the posting's
// detail — with no copy anywhere claiming a host does render it.
//
// resources/list is free and unmetered. resources/read follows the gate of
// the tool it wraps: the guide and the statistics answer with no credential
// (the statistics through the unkeyed tier, counted exactly as an unkeyed
// board_stats call; the guide free, it is documentation), the key's status
// and a card's link need one. A keyed read is metered through the one
// api_key_check call under the resource family (RESOURCE_ENDPOINT).
const RESOURCE_SCHEME = "resumebooster://";
const GUIDE_URI = `${RESOURCE_SCHEME}guide`;
const BOARD_STATS_URI = `${RESOURCE_SCHEME}board/stats`;
const MY_KEY_URI = `${RESOURCE_SCHEME}me/key`;
/** A posting's URI: the id every other tool takes, under the scheme. */
const JOB_URI_PREFIX = `${RESOURCE_SCHEME}job/`;
const jobUri = (id: string) => `${JOB_URI_PREFIX}${id}`;

type Resource = { uri: string; name: string; title: string; mimeType: string; description: string; keyed: boolean };
const RESOURCES: readonly Resource[] = [
  {
    uri: GUIDE_URI, name: "guide", title: "How this board answers an agent", mimeType: "text/markdown", keyed: false,
    description: "The tiers, which tools answer unkeyed, how to verify a shortlist cheaply, what the closure ledger can and cannot say. Derived from the tool registry at request time.",
  },
  {
    uri: BOARD_STATS_URI, name: "board-stats", title: "Board statistics (live cache)", mimeType: "application/json", keyed: false,
    description: `Same payload as ${tool("board_stats")}.`,
  },
  {
    uri: MY_KEY_URI, name: "my-key", title: "This key's limits and powers", mimeType: "application/json", keyed: true,
    description: `Same payload as ${tool("key_status")}: tier, calls left, which tools would answer, and the pass if the account holds one. Needs a key or a sign-in.`,
  },
];

/**
 * A card's resource_link: the posting under its own URI, named as a person
 * would read it. Appended to the content of search_jobs and get_jobs beside
 * the JSON text — the structured half is untouched, so a client validating
 * structuredContent against the outputSchema sees exactly what it did.
 */
const cardLink = (card: Record<string, unknown>) => ({
  type: "resource_link",
  uri: jobUri(String(card.id ?? "")),
  name: `${String(card.title ?? "(untitled)")} — ${String(card.company ?? "(employer not stated)")}`,
  mimeType: "application/json",
});
const withCardLinks = (result: Record<string, unknown>, cards: unknown): Record<string, unknown> => ({
  ...result,
  content: [...(result.content as unknown[]), ...(Array.isArray(cards) ? cards : []).map((c) => cardLink(c as Record<string, unknown>))],
});

/** The resources/read answer: one contents entry, text or JSON. */
const contentsOf = (uri: string, mimeType: string, data: unknown) => ({
  contents: [{ uri, mimeType, text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }],
});

/**
 * The guide, as markdown, from the same constants the tools and the
 * instructions read: no tier, cap, count or name in it is typed.
 */
function guideText(): string {
  const by = (names: readonly string[]) => names.map((n) => `\`${n}\``).join(", ");
  return [
    `# How this board answers an agent`,
    ``,
    `Live job search over employers' own hiring feeds (${DOCS_URL}). Streamable HTTP, POST only, stateless. Nothing is scraped from aggregators; postings come from the employer's own hiring system and leave when its feed stops listing them.`,
    ``,
    `## Four tiers`,
    ``,
    `- **No key.** ${by(ANON_TOOLS)} answer with no Authorization header at all: search capped at ${ANON_SEARCH_LIMIT} rows, ${ANON_IP_CAP_PER_DAY} calls a day per address and ${ANON_GLOBAL_CAP_PER_DAY} a day across every unkeyed caller; every answer says how many are left. \`${tool("search")}\` and \`${tool("fetch")}\` are \`${tool("search_jobs")}\` and \`${tool("get_job")}\` under the names ChatGPT's research connector calls.`,
    `- **Free key, no account** (${MINT_URL}): ${FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} calls a day, every filter, and every other read tool — ${by(KEY_ONLY_READ_TOOLS)}.`,
    `- **Paid key:** ${by(PAID_TOOLS)}, exactly like POST /v1/fit on the data API.`,
    `- **Account-linked key** (${DOCS_URL}) with an Agent plan or a live pass (${PASS_URL}) and a standing mandate: ${by(ACCOUNT_TOOLS)}. A pass also opens the paid scorer.`,
    ``,
    `## Call order`,
    ``,
    `1. \`${tool("board_stats")}\` — cheap, unkeyed, and it says what a key adds.`,
    `2. On a keyed session, \`${tool("key_status")}\` — tier, calls left, which tools would answer, every apply blocker named. Nothing has to be discovered by refusal.`,
    `3. \`${tool("search_jobs")}\`; then verify a shortlist with \`${tool("check_jobs_open")}\` (many ids, one call) and read it with \`${tool("get_jobs")}\` (${GET_JOBS_MAX} ids a call) rather than one \`${tool("get_job")}\` each — the quota counts calls, not ids.`,
    `4. A resumebooster.work/jobs?job=<id> link's id is the argument to \`${tool("get_job")}\`, \`${tool("fetch")}\`, \`${tool("check_apply_support")}\` and \`${tool("request_application")}\`; the same id is the tail of a card's \`${JOB_URI_PREFIX}<id>\` resource link.`,
    ``,
    `## What the answers mean`,
    ``,
    `- \`countUnavailable\` means the board refuses to guess a total; \`ignoredFilters\` names any filter it could not apply — the results answer a wider question than was asked.`,
    `- Pay and seniority arrive parsed (\`salaryMinAnnual\`, \`salaryMaxAnnual\`, \`experienceBand\`, \`minYears\`) and are ABSENT when the posting states none: absence is not zero.`,
    `- \`agentReady\` is true when \`${tool("request_application")}\` can submit to that hiring system; every application passes the same gates as the signed-in flow, and answers are never invented.`,
    ``,
    `## The ledger`,
    ``,
    `This board watches postings come down. \`${tool("employer_hiring_record")}\` and \`${tool("employer_growth")}\` carry that record per employer board — a takedown is a takedown, never an outcome (the board cannot tell why a role came down), one board is never summed with another, and an unknown always names its reason. No list of growing employers exists here or anywhere on the board.`,
    ``,
    `## Prompts and resources`,
    ``,
    `Prompts: ${PROMPTS.map((p) => `\`${p.name}\``).join(", ")}. Resources: ${RESOURCES.map((r) => `\`${r.uri}\``).join(", ")}. Listing either is free; reading one follows the gate of the tool it wraps.`,
  ].join("\n");
}

// ── What a keyed discovery read is metered as ───────────────────────────────
//
// api_usage's endpoint is free text. A keyed tool call meters as the MCP
// prefix plus the tool name (the one api_key_check call in the dispatcher);
// a keyed prompt read and a keyed resource read meter under their own
// families so the adoption reader (agent_adoption_metrics) can tell the
// three apart. Each family is spelled once, as a full endpoint, and the name
// the key check receives is that endpoint less the shared prefix — the
// check itself spells the prefix. Neither family starts a pass: the
// activation clause in api_key_check exempts both (migration
// 20260917230000), because reading the guide or a prompt is looking, and a
// pass starts at the first call that does something.
const MCP_ENDPOINT_PREFIX = "/mcp/";
const RESOURCE_ENDPOINT = (name: string) => `/mcp/resource/${name}`;
const meteredNameOf = (endpoint: string) => endpoint.slice(MCP_ENDPOINT_PREFIX.length);

/**
 * A prompts/get or resources/read, resolved: what it is, what it meters as,
 * and — for a resource — the gate it inherits. A prompt has no endpoint:
 * it is never metered, with or without a credential (discovery does not
 * spend a real call), so it never reaches the key check. Null for any other
 * method; an `error` for a name or URI this server does not hold.
 */
type Read =
  | { kind: "prompt"; prompt: Prompt }
  | { kind: "resource"; resource: Resource; endpoint: string; keyed: boolean }
  | { kind: "job"; id: string; uri: string; endpoint: string; keyed: true }
  | { kind: "error"; code: number; message: string };
type MeteredRead = Exclude<Read, { kind: "prompt" } | { kind: "error" }>;
function readOf(method: string | undefined, params: Record<string, unknown>): Read | null {
  if (method === "prompts/get") {
    const name = String(params.name ?? "");
    const prompt = PROMPTS.find((p) => p.name === name);
    if (!prompt) return { kind: "error", code: -32602, message: `unknown prompt: ${name}` };
    return { kind: "prompt", prompt };
  }
  if (method === "resources/read") {
    const uri = String(params.uri ?? "");
    const resource = RESOURCES.find((r) => r.uri === uri);
    if (resource) return { kind: "resource", resource, endpoint: RESOURCE_ENDPOINT(resource.name), keyed: resource.keyed };
    if (uri.startsWith(JOB_URI_PREFIX) && uri.length > JOB_URI_PREFIX.length) {
      return { kind: "job", id: uri.slice(JOB_URI_PREFIX.length), uri, endpoint: RESOURCE_ENDPOINT("job"), keyed: true };
    }
    return { kind: "error", code: -32002, message: `unknown resource: ${uri}` };
  }
  return null;
}

/**
 * A tool result, re-shaped as a resources/read answer: the structured half
 * becomes the JSON text under the resource's URI; an in-band tool refusal
 * becomes the JSON-RPC error a read must answer with (a read has no
 * isError shape of its own).
 */
function asContents(rpcId: unknown, uri: string, mimeType: string, rpc: unknown): unknown {
  const r = rpc as { result?: { structuredContent?: unknown; isError?: boolean; content?: { text?: string }[] }; error?: unknown };
  if (r.error) return rpc;
  if (r.result?.isError) return rpcError(rpcId, -32000, String(r.result.content?.[0]?.text ?? "refused"));
  return rpcResult(rpcId, contentsOf(uri, mimeType, r.result?.structuredContent ?? {}));
}

/**
 * A keyed refusal (rate, quota, revoked, unknown key) on a discovery read:
 * the same words the tool refusal carries, as the JSON-RPC error a read
 * answers with, and the same headers.
 */
const readRefused = (rpcId: unknown, message: string, fix: string, headers: Record<string, string>) =>
  json(rpcError(rpcId, -32000, `${message} ${fix}`), 200, headers);

/**
 * A runner failure behind a resources/read, on either tier: an argument the
 * caller can change (a blank job id) is named as such; anything else is the
 * generic internal line the tool path gives, the detail kept server-side.
 * Always a JSON-RPC error with a body and the CORS headers — a read that
 * threw out of the handler answered a bare 500 with neither.
 */
function readFailed(rpcId: unknown, read: MeteredRead, e: unknown, headers: Record<string, string>): Response {
  const what = read.kind === "job" ? "job" : read.resource.name;
  if (e instanceof ToolArgumentError) return readRefused(rpcId, e.message, e.fix, headers);
  console.error(`[AGENT-MCP] resource ${what} failed:`, String((e as Error)?.message ?? e).slice(0, 300));
  return json(rpcError(rpcId, -32603, `The ${what} resource hit an internal error. Try again shortly.`), 200, headers);
}

// ── The ChatGPT-shaped sign-in hedge — a GUESS, labelled ───────────────────
//
// OpenAI documents BOTH a transport-level challenge with the WWW-Authenticate
// header and, for the tool-level "Mixed" UI, the same challenge string inside
// a tool result's `_meta["mcp/www_authenticate"]` on a 200 with isError. Which
// of the two a Mixed connector reacts to at the transport level is
// undocumented, and no ChatGPT run can exist while the authorization server
// is off. So: the HTTP challenge stays for everyone, and ONLY a caller whose
// tools/call carries an `openai/`-prefixed key in params._meta (the marker
// ChatGPT stamps on its calls) gets the in-band form instead — the exact
// challenge string the OAuth module builds for the header, so the two can
// never say different things. GUESS: that ChatGPT reads the in-band form on
// a transport-level call. The log line is the measurement.
const OPENAI_META_PREFIX = "openai/";
const hedgeInBand = (params: Record<string, unknown>): boolean => {
  const meta = params._meta;
  return !!meta && typeof meta === "object" && Object.keys(meta as object).some((k) => k.startsWith(OPENAI_META_PREFIX));
};
/** The caller's own `openai/subject` from _meta, when it is a non-empty string; logged hashed, never a key to anything. */
const openaiSubjectOf = (params: Record<string, unknown>): string => {
  const meta = params._meta;
  const v = meta && typeof meta === "object" ? (meta as Record<string, unknown>)[`${OPENAI_META_PREFIX}subject`] : undefined;
  return typeof v === "string" ? v.trim() : "";
};
function inBandChallenge(toolName: string) {
  console.log(`[AGENT-MCP] oauth challenge via _meta on ${toolName}`);
  return {
    ...toolErr("Sign in to use this tool.", `Connect this server through its sign-in, or send a key as Authorization: Bearer <key> (${MINT_URL}).`),
    _meta: { "mcp/www_authenticate": [bearerChallenge()] },
  };
}

/** prompts/get arguments: strings only, as the spec shapes them; anything else is dropped rather than rendered. */
function promptArgsOf(params: Record<string, unknown>): PromptArgs {
  const raw = params.arguments;
  const out: PromptArgs = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * A credentialed resources/read, after the key check allowed and metered
 * it: each resource is the runner of the tool it wraps, under
 * the resource's own URI and mime type. Never a second reader: the guide is
 * built from the registry, the statistics and the posting come from the
 * board runners (a posting in the fetch alias's document shape, the same one
 * the unkeyed read answers), the key's status from the decision this call
 * was allowed by.
 */
async function answerRead(client: SupabaseClient, read: MeteredRead, d: Decision): Promise<unknown> {
  switch (read.kind) {
    case "job": return contentsOf(read.uri, "application/json", await runFetchAlias({ id: read.id }));
    case "resource": {
      const r = read.resource;
      if (r.uri === GUIDE_URI) return contentsOf(r.uri, r.mimeType, guideText());
      if (r.uri === BOARD_STATS_URI) return contentsOf(r.uri, r.mimeType, await runBoardStats());
      if (r.uri === MY_KEY_URI) return contentsOf(r.uri, r.mimeType, await runKeyStatus(client, d));
      throw new Error(`no runner for resource ${r.uri}`);
    }
    default: throw new Error("unreachable read");
  }
}

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
  const limit = Math.max(1, Math.min(KEYED_SEARCH_LIMIT, Number(args.limit ?? 20) || 20));
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
  if (!asked.length) throw new Error(`ids is required — an array of job ids from search_jobs (up to ${CHECK_JOBS_OPEN_MAX}).`);
  const ids = asked.slice(0, CHECK_JOBS_OPEN_MAX);
  const notChecked = asked.slice(CHECK_JOBS_OPEN_MAX);
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
    ...(notChecked.length ? { notChecked, note: `Only the first ${CHECK_JOBS_OPEN_MAX} ids were checked — send the rest in another call.` } : {}),
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

// ── The two names ChatGPT's research connector calls ────────────────────────
//
// Wrappers over runSearchJobs and runGetJob — the board is read by the same
// two calls, through the same anon-key POST, and nothing here holds a second
// reader. Only the SHAPE is ChatGPT's.

/** One line for a research listing: the title and the employer. */
const aliasTitle = (card: Record<string, unknown>): string =>
  [card.title, card.company].filter((x) => typeof x === "string" && x).join(" — ") || String(card.id ?? "");
/** The employer's own apply page when the board holds one, else the posting's page on the site. */
const aliasUrl = (card: Record<string, unknown>): string =>
  typeof card.applyUrl === "string" && card.applyUrl ? card.applyUrl : SITE_JOB_URL(String(card.id ?? ""));

async function runSearchAlias(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    throw new ToolArgumentError("search needs a query string.", "Send {query: 'what you are looking for'}; every other filter lives on search_jobs.");
  }
  // The unkeyed page size on every call, keyed or not: this shape exists for
  // a research listing, and a client that wants sixty rows and filters has
  // search_jobs.
  const r = await runSearchJobs({ query, limit: ANON_SEARCH_LIMIT }) as Record<string, unknown>;
  const { jobs, ...disclosed } = r;
  const cards = (Array.isArray(jobs) ? jobs : []) as Array<Record<string, unknown>>;
  return {
    results: cards.map((c) => ({ id: String(c.id ?? ""), title: aliasTitle(c), url: aliasUrl(c) })),
    ...disclosed,
  };
}

async function runFetchAlias(args: Record<string, unknown>): Promise<unknown> {
  const id = String(args.id ?? "").trim();
  if (!id) throw new ToolArgumentError("fetch needs an id.", "Pass the id of a search result.");
  const r = await runGetJob({ id }) as Record<string, unknown>;
  if (r.job === null) {
    // A dead id: get_job's own honesty (closed / agedOut / notFound, with its
    // note) becomes the text and the metadata, so a research client is told
    // the posting came down rather than handed an empty page.
    const { note, fix, job: _none, ...record } = r;
    return {
      id,
      title: null,
      text: String(note ?? "No posting with that id."),
      url: SITE_JOB_URL(id),
      metadata: { ...record, ...(typeof fix === "string" ? { fix } : {}) },
    };
  }
  const { description, ...card } = r;
  return {
    id,
    title: typeof card.title === "string" ? card.title : null,
    text: String(description ?? ""),
    url: aliasUrl(card),
    metadata: card,
  };
}

async function runBoardStats(): Promise<unknown> {
  const r = await board({ action: "list", limit: 1, includeFacets: true });
  return {
    servablePostings: r.totalAllCompanies ?? null,
    trackedPostings: r.trackedTotal ?? null,
    // WAS `employers: r.companiesCount`, one line under a serving-filtered
    // numerator — the same unfiltered-denominator pairing fixed on /jobs, both
    // heroes and /v1/stats. companiesCount is the length of the UNFILTERED
    // company_token grouping (left unfiltered because the orphan prune DELETES
    // by it), so it counts boards whose every posting has been withdrawn or has
    // aged past the 30-day window, while servablePostings above counts only
    // postings that pass both. An agent reading the two together got a ratio
    // neither number supports, and it disagreed with /v1/stats' `companies`
    // for the same board at the same instant.
    //
    // Renamed as well as re-sourced: a company_token is a BOARD, and one
    // employer can run several (PwC ships five Workday sub-sites), so this was
    // never a count of employers. Null — never companiesCount — when the pass
    // did not compute it: an agent gets no number rather than a wrong one.
    openCompanyBoards: r.companiesOpenCount ?? null,
    openCompanyBoardsBasis:
      "Distinct company job boards with at least one open posting, under the same two rules as servablePostings (not withdrawn, dated within the last 30 days). A count of BOARDS, not of employers: an employer running several boards is counted once per board, so this is a floor on the number of employers.",
    categories: r.categories && typeof r.categories === "object" ? Object.keys(r.categories as object) : [],
    freshnessWindowDays: 30,
    refreshedAt: r.refreshedAt ?? null,
    note: "Postings come from employers' own hiring-system feeds; nothing is scraped from aggregators.",
  };
}

/**
 * The token list both employer tools take: an array (or a comma list — agents
 * type them), trimmed, de-duplicated, order kept, and REFUSED past the cap
 * rather than trimmed. A silently shortened list is an employer the agent
 * believes it asked about.
 */
function employerTokensArg(args: Record<string, unknown>, tool: string): string[] {
  const tokens = [...new Set(companyTokens(args.companyTokens))];
  if (!tokens.length) {
    throw new ToolArgumentError(
      `${tool} needs companyTokens — an array of companyToken values from job cards (up to ${EMPLOYER_TOKENS_MAX}).`,
      "Take companyToken off any search_jobs card, or from the site's employer pages.",
    );
  }
  if (tokens.length > EMPLOYER_TOKENS_MAX) {
    throw new ToolArgumentError(
      `${tool} takes at most ${EMPLOYER_TOKENS_MAX} companyTokens per call; ${tokens.length} were sent.`,
      `Split the list — each call is one metered request, so ${tokens.length} tokens is ${Math.ceil(tokens.length / EMPLOYER_TOKENS_MAX)} calls, not ${tokens.length}.`,
    );
  }
  return tokens;
}

/**
 * ONE RPC, ONE ROW PER TOKEN, NOTHING RE-DERIVED.
 *
 * get_company_hiring_health answers with a row for every token asked (it
 * unnests the list and LEFT JOINs everything else), so a token this board has
 * never seen comes back zero and null — and a row is therefore not evidence.
 * Evidence is a closure-ledger entry. The `record` field says which of the two
 * a row is, and `unknown` is never rendered as a finding about the employer:
 * on a board bigger than one visit can read, no closure is observable until a
 * provable full pass completes and a role then goes, and the silence of a
 * board still short of that pass must not be published as its own.
 *
 * The RPC's column names are kept verbatim (its own header explains each), so
 * this surface and the site's employer pages cannot start disagreeing about
 * what a number is called.
 */
async function runEmployerHiringRecord(client: SupabaseClient, args: Record<string, unknown>): Promise<unknown> {
  const tokens = employerTokensArg(args, "employer_hiring_record");
  const { data, error } = await client.rpc("get_company_hiring_health", { p_tokens: tokens });
  if (error) throw new Error(`get_company_hiring_health: ${error.message}`);
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) rows.set(String(r.company_token), r);
  const closedCol = `closed_${HIRING_RECORD_WINDOW_DAYS}d`;
  const supersededCol = `superseded_${HIRING_RECORD_WINDOW_DAYS}d`;
  const employers = tokens.map((tok) => {
    const r = rows.get(tok);
    // The RPC answers every token by construction; a missing row is a fault in
    // the read, not a fact about the employer, and is thrown rather than filled.
    if (!r) throw new Error(`get_company_hiring_health answered no row for ${tok}`);
    const closed = Number(r[closedCol] ?? 0);
    const superseded = Number(r[supersededCol] ?? 0);
    const openRoles = Number(r.open_roles ?? 0);
    const nothingAtAll = openRoles === 0 && closed + superseded === 0 && Number(r.tracking_days ?? 0) === 0 && r.feed_total == null;
    const unknownReason = nothingAtAll ? "no_record" : closed + superseded === 0 ? "no_closures_observed" : null;
    return {
      ...r,
      record: unknownReason ? "unknown" : "observed",
      unknown_reason: unknownReason,
      basis: HIRING_RECORD_BASIS,
      ...(unknownReason ? { note: HIRING_RECORD_UNKNOWN[unknownReason] } : {}),
    };
  });
  return { employers, asked: tokens.length, window_days: HIRING_RECORD_WINDOW_DAYS, basis: HIRING_RECORD_BASIS };
}

/**
 * THE RPC OWNS THE VERDICT. Every row is get_company_growth's own answer with
 * verdict and unknown_reason exactly as it wrote them — three states, and the
 * third one is not a no. Nothing here compares net or rate against a bar; the
 * bars travel beside the rows so an agent can read them, and the description
 * names them from the same constant so it cannot describe a different test.
 * The RPC answers a row for every token (a token with no daily series is
 * unknown/no_series), so a missing row is a fault in the read and is thrown.
 */
async function runEmployerGrowth(client: SupabaseClient, args: Record<string, unknown>): Promise<unknown> {
  const tokens = employerTokensArg(args, "employer_growth");
  const { data, error } = await client.rpc("get_company_growth", { p_tokens: tokens });
  if (error) throw new Error(`get_company_growth: ${error.message}`);
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) rows.set(String(r.company_token), r);
  const employers = tokens.map((tok) => {
    const r = rows.get(tok);
    if (!r) throw new Error(`get_company_growth answered no row for ${tok}`);
    return { ...r, verdict: r.verdict, unknown_reason: r.unknown_reason ?? null };
  });
  return {
    employers,
    asked: tokens.length,
    bars: {
      window_days: GROWTH_BARS.windowDays,
      min_baseline_served: GROWTH_BARS.minBaselineServed,
      min_net_add: GROWTH_BARS.minNetAdd,
      min_rate: GROWTH_BARS.minRate,
      min_tenure_days: GROWTH_BARS.minTenureDays,
    },
    basis:
      "Per BOARD (a vendor tenant), from our own daily observation of roles served, latest day against the window's start, " +
      "on days we read the board in full — never summed across an employer's boards. More roles served is roles opened net " +
      "of roles that came down: not a headcount, not a hire. unknown carries its reason and is a reading we could not take, " +
      "never a no. The verdict is the board's own and is passed through untouched; the bars beside it are what it measured " +
      "against, for reading a row and never for re-judging one. Employers are never ranked by this.",
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
    "An active Agent plan OR a live pass on the account (a pass is bought signed-in at " + PASS_URL + "; its clock starts at the first call other than key_status).",
    "An active mandate (Account → set up your agent) with a resume on file.",
  ];
}

/**
 * THE ACCOUNT'S OPEN PASS, if any — the row api_key_check reads for the
 * overlay, read once more here for the apply gates and key_status. The
 * columns are exactly what passIsLive judges plus what key_status reports;
 * every number an agent hears about its pass is one of these, never a
 * constant. Nothing is written: the readers' lazy close has already run
 * inside api_key_check on the call that got us here.
 */
type OpenPassRow = PassRow & { shelf_expires_at?: string | null; activated_via?: string | null };
async function openPassOf(client: SupabaseClient, userId: string): Promise<OpenPassRow | null> {
  const { data } = await client.from("agent_passes")
    .select("activated_at, expires_at, closed_at, shelf_expires_at, applications_total, applications_used, activated_via")
    .eq("user_id", userId).is("closed_at", null).maybeSingle();
  return (data as OpenPassRow | null) ?? null;
}

/** What key_status says about the pass: state and figures off the row, the fix off one constant URL. */
function describePass(p: OpenPassRow | null, now: number = Date.now()): Record<string, unknown> {
  const startsOn = "your first call other than key_status";
  if (!p) return { state: "none", endsAt: null, endsInSeconds: null, applicationsLeft: null, applicationsTotal: null, startsOn, buy: PASS_URL };
  const total = Number(p.applications_total ?? 0);
  const used = Number(p.applications_used ?? 0);
  const left = Math.max(0, total - used);
  if (!p.activated_at) {
    return {
      state: "unactivated", endsAt: null, endsInSeconds: null,
      applicationsLeft: left, applicationsTotal: total,
      ...(p.shelf_expires_at ? { expiresUnusedOn: p.shelf_expires_at } : {}),
      startsOn, buy: PASS_URL,
    };
  }
  const ends = p.expires_at ? Date.parse(p.expires_at) : NaN;
  const running = Number.isFinite(ends) && ends > now;
  return {
    state: running ? "live" : "closed",
    endsAt: p.expires_at ?? null,
    endsInSeconds: running ? Math.floor((ends - now) / 1000) : 0,
    applicationsLeft: left, applicationsTotal: total,
    ...(p.activated_via ? { activatedVia: p.activated_via } : {}),
    startsOn, buy: PASS_URL,
  };
}

/** Why an activated pass no longer funds a request: no applications left, or the clock ended. */
function passBlockerReason(p: PassRow): string {
  const left = Number(p.applications_total ?? 0) - Number(p.applications_used ?? 0);
  const ends = p.expires_at ? Date.parse(p.expires_at) : NaN;
  if (Number.isFinite(ends) && ends <= Date.now()) return "ended";
  if (left <= 0) return "no applications left";
  return "closed";
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
async function applyReadiness(
  client: SupabaseClient,
  userId: string | null,
  passRow?: OpenPassRow | null,
): Promise<Record<string, unknown>> {
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
  // Two ways to be allowed, asked separately so the answer can name which one
  // holds — and combined by the same predicate the seam refuses on.
  const subscribed = rowIsEntitled(subRow as SubscriberRow | null);
  const pass = passRow === undefined ? await openPassOf(client, userId) : passRow;
  const passLive = passIsLive(pass);
  // An open pass that has not started is reported as funding, because the
  // request_application call that would spend it is itself the first call
  // that starts it (api_key_check activates on the allowed path, in SQL,
  // before the tool runs). key_status does not start it, and says so.
  const passUnstarted = !!pass && !pass.activated_at && !pass.closed_at &&
    Number(pass.applications_total ?? 0) - Number(pass.applications_used ?? 0) > 0;
  const planActive = mayApply(subRow as SubscriberRow | null, pass) || passUnstarted;

  const blockers: string[] = [];
  if (!m) blockers.push("No agent mandate on this account — set your agent up in Account.");
  else if (m.active !== true) blockers.push("Your agent is switched off.");
  else if (pausedUntil) blockers.push(`Your agent is paused until ${pausedUntil}.`);
  if (!resumeOnFile) blockers.push("No resume on file — the agent refuses to apply blind.");
  if (!planActive) {
    blockers.push(pass && !subscribed
      ? `The pass on this account has ${passBlockerReason(pass)} — buy another at ${PASS_URL} when its clock ends, or subscribe to the Agent plan.`
      : `No live pass and no Agent plan — buy a pass at ${PASS_URL} or subscribe at https://resumebooster.work/agent.`);
  }

  return {
    ready: blockers.length === 0,
    accountLinked: true,
    planActive, subscribed, passLive, mandateActive, resumeOnFile,
    ...(passUnstarted ? { passStartsOnFirstCall: true } : {}),
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
    .select("active, paused_until, resume_text, apply_mode, daily_count, countries, category, include_uncategorised, max_age_days, salary_min, last_prepare_kick_at")
    .eq("user_id", userId).maybeSingle();
  if (!mandate) {
    return refuse("mandate", "No agent mandate on this account.", "Set up your agent in Account — that is where you authorize what it may do and hand it your details.");
  }
  const m = mandate as {
    active?: boolean; paused_until?: string | null; resume_text?: string | null; apply_mode?: string;
    countries?: string | null; category?: string | null; include_uncategorised?: boolean | null;
    max_age_days?: number | null; salary_min?: number | null; last_prepare_kick_at?: string | null;
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

  // TWO WAYS TO BE ALLOWED. The subscription, by the ACCOUNT's address, is
  // asked first and wins: consumption never draws on a pass while a plan is
  // live. Otherwise the pass — activated, not closed, clock running, an
  // application left — funds THIS request, and the enqueue RPC below spends
  // one of its applications in the same statement that writes the row. The
  // pipeline re-checks the subscription at preparation and again at claim,
  // and for a pass-funded row asks only "was this row paid for" (pass_id).
  const { data: userRes } = await client.auth.admin.getUserById(userId);
  const email = normalizeEmail(userRes?.user?.email ?? "");
  const { data: subRow } = await client.from("agent_subscribers")
    .select(ENTITLEMENT_COLUMNS).eq("email", email).maybeSingle();
  const subscribed = rowIsEntitled(subRow as SubscriberRow | null);
  const pass = subscribed ? null : await openPassOf(client, userId);
  if (!mayApply(subRow as SubscriberRow | null, pass)) {
    if (pass) {
      return refuse("pass",
        `The pass on this account has ${passBlockerReason(pass)}.`,
        pass.expires_at && Date.parse(pass.expires_at) > Date.now()
          ? `No applications left on this pass — ${Math.max(1, Math.round((Date.parse(pass.expires_at) - Date.now()) / 3_600_000))} hours remain for search and scoring. Buy another at ${PASS_URL} when the clock ends.`
          : `Buy a pass at ${PASS_URL}, or subscribe at https://resumebooster.work/agent — search tools keep working without either.`);
    }
    return refuse("plan", "The apply agent needs an active Agent plan or a live pass.", `Buy a pass at ${PASS_URL} or subscribe at https://resumebooster.work/agent — search tools keep working without either.`);
  }
  const passFunded = !subscribed;

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

  // The pre-read for the alreadyQueued note (the existing row's status). Not
  // the duplicate guard: that is the RPC's ON CONFLICT, which is what makes a
  // duplicate cost nothing on a pass — a race between two identical requests
  // ends with one row and one application spent.
  const { data: existing } = await client.from("agent_queue")
    .select("status").eq("user_id", userId).eq("posting_id", jobId).maybeSingle();
  if (existing) {
    return { accepted: true, alreadyQueued: true, queueStatus: (existing as { status?: string }).status, note: "This job was already in your agent's queue — nothing duplicated." };
  }

  // fit_pct must be populated: decideRelease refuses fit-unknown on null and
  // fit-below-floor under 55 (apply-agent MIN_FIT_PCT). Computing it here
  // means the requester learns the outlook NOW instead of a silent non-release.
  const fit = computeFit(`${String(p.title ?? "")} ${String(p.description ?? "")}`, resume);

  // user_id and posting_id travel as the RPC's own parameters, never inside
  // the row, so the row can only land on the account this key acts for.
  const row = {
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
  // THE ONE STATEMENT THAT ACCEPTS AND PAYS. agent_queue_enqueue inserts the
  // row ON CONFLICT (user_id, posting_id) DO NOTHING and, when the pass funds
  // it, increments the pass's applications_used on the same locked row —
  // together, or not at all. A duplicate answers already_queued and spends
  // nothing; an exhausted or ended pass answers with nothing written. Never
  // a counter beside the write: the refuter proved that over-consumes on a
  // duplicate race.
  const { data: enq, error: enqErr } = await client
    .rpc("agent_queue_enqueue", { p_user_id: userId, p_posting_id: jobId, p_row: row, p_pass_funded: passFunded })
    .maybeSingle();
  if (enqErr) throw new Error(`queue write failed: ${enqErr.message}`);
  const e = (enq ?? null) as { enqueued_ok?: boolean; enqueue_reason?: string; queued_row_id?: number | null; pass_apps_left?: number | null } | null;
  if (!e?.enqueued_ok) {
    const reason = e?.enqueue_reason ?? "unknown";
    console.log(`[AGENT-MCP] request_application refused by the enqueue RPC: ${reason}`);
    if (reason === "pass_exhausted") {
      return refuse("pass", "No applications left on this pass.", `Search and scoring keep working until the clock ends; buy another pass at ${PASS_URL} after that.`);
    }
    if (reason === "pass_not_live") {
      return refuse("pass", "The pass on this account is not live.", `Buy a pass at ${PASS_URL}, or subscribe at https://resumebooster.work/agent.`);
    }
    throw new Error(`queue write refused: ${reason}`);
  }
  if (e.enqueue_reason === "already_queued") {
    return { accepted: true, alreadyQueued: true, note: "This job was already in your agent's queue — nothing duplicated, nothing spent." };
  }

  // THE HEAD START, BOUND TO THE RIGHT EVENT THIS TIME. The preparer runs at
  // :23; a pass buyer whose request lands at :24 would otherwise wait an
  // hour of a six-hour clock. Kick it now, throttled per mandate through the
  // same column the on-save trigger uses, and never fatal: the cron remains
  // the floor, this only removes waiting.
  if (passFunded) {
    const last = m.last_prepare_kick_at ? Date.parse(m.last_prepare_kick_at) : NaN;
    if (!Number.isFinite(last) || last < Date.now() - 5 * 60_000) {
      try {
        await client.from("agent_mandates").update({ last_prepare_kick_at: new Date().toISOString() }).eq("user_id", userId);
        const { data: kicked, error: kickErr } = await client.rpc("agent_prepare_now");
        console.log(`[AGENT-MCP] prepare kicked for a pass-funded request: ${kicked === true}${kickErr ? ` (${kickErr.message.slice(0, 120)})` : ""}`);
      } catch (kickE) {
        console.error(`[AGENT-MCP] prepare kick failed: ${String((kickE as Error)?.message ?? kickE).slice(0, 160)}`);
      }
    }
  }

  const vendor = parts[0];
  const agentReady = SENDABLE_VENDORS.includes(vendor);
  return {
    accepted: true,
    jobId,
    title: row.title,
    company: row.company,
    fitPct: fit.pct,
    passApplicationsLeft: passFunded ? (e.pass_apps_left ?? null) : null,
    ...(fit.pct !== null && fit.pct < 55 ? { warning: "Fit is below the 55% release floor — the packet will be prepared but refused release unless the resume covers more of this posting's terms." } : {}),
    ...(agentReady ? {} : { warning: `This employer's system (${vendor}) is not agent-submittable — the packet will be prepared for one-click manual sending instead.` }),
    whatHappensNext: m.apply_mode === "auto"
      ? "The preparer builds the application from your profile (answers are grounded — nothing is invented), then releases it within your daily cap and vendor allow-list. Track it with application_status."
      : "The application is prepared and waits in your morning queue for your review — you approve the actual send. Track it with application_status.",
    ...(passFunded ? { funding: "This request was paid for by your pass; it is honoured even if the clock ends before it is sent." } : {}),
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
  // Two questions, one shared module: "paid" opens the /v1 gates (ranked,
  // the long changes window) and stays false on a pass; "fit" opens
  // fit_resume and is true on a pass. The tier itself is the decision's —
  // api_key_check answers the pass tier while an open pass exists.
  const paid = isPaidKeyTier(d.key_tier);
  const fit = hasFitAccess(d.key_tier);
  const apiKeyId = d.api_key_id ?? "";
  const userId = apiKeyId ? await keyOwner(client, apiKeyId) : null;
  // The pass row, read once and shared with the readiness block; its state
  // and figures come off the row, its clock off the decision that allowed
  // this call (pass_ends_at is what api_key_check will enforce).
  const pass = userId ? await openPassOf(client, userId) : null;
  const apply = await applyReadiness(client, userId, pass);
  const passBlock = describePass(pass);
  if (d.pass_ends_at) passBlock.endsAt = d.pass_ends_at;
  if (typeof d.pass_apps_left === "number") passBlock.applicationsLeft = d.pass_apps_left;
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
      fit_resume: fit,
      rankedEngine: paid,
      request_application: apply.ready === true,
    },
    pass: passBlock,
    apply,
    counted: "These figures include this call — key_status is metered like every other tool.",
    // Where to go next: a pass-holder is not told to upgrade the key; a key
    // with neither pass nor plan is pointed at the pass first (the shortest
    // path to applying), the data-API page for a paid /v1 key.
    ...(paid ? {} : d.key_tier === PASS_TIER ? {} : {
      upgrade: apply.planActive === true ? "https://resumebooster.work/data-api" : PASS_URL,
    }),
    docs: DOCS_URL,
  };
}

/**
 * HOW THE PASS WAS ACTIVATED — the per-host adoption segment, written after
 * the fact. api_key_check starts the clock in SQL and cannot know the
 * transport; this stamps the row once (first writer wins, an already-stamped
 * row matches nothing) with the way the credential arrived and the client's
 * user agent, so "who buys a pass and from which host" is measurable rather
 * than guessed. Memoised per isolate so a live pass costs the two reads once,
 * not on every call; never fatal — a missing stamp is a missing metric, not a
 * refused tool. `via` is "key" here; the OAuth path passes "oauth:<client_id>".
 */
const activatedViaStamped = new Set<string>();
async function noteActivatedVia(client: SupabaseClient, d: Decision, via: string, userAgent: string): Promise<void> {
  if (d.key_tier !== PASS_TIER || !d.pass_ends_at || !d.api_key_id) return;
  // Keyed by the clock as well as the key: the same key carries the next
  // pass this account buys, and that one needs its own stamp.
  const memo = `${d.api_key_id}:${d.pass_ends_at}`;
  if (activatedViaStamped.has(memo)) return;
  activatedViaStamped.add(memo);
  try {
    const userId = await keyOwner(client, d.api_key_id);
    if (!userId) return;
    await client.from("agent_passes")
      .update({ activated_via: via, activated_user_agent: userAgent.slice(0, 200) })
      .eq("user_id", userId).is("closed_at", null).not("activated_at", "is", null).is("activated_via", null);
  } catch (e) {
    console.error(`[AGENT-MCP] activated_via stamp failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}

async function callTool(
  client: SupabaseClient,
  apiKeyId: string,
  tier: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "search_jobs": {
      const r = await runSearchJobs(args) as Record<string, unknown>;
      return withCardLinks(toolOk(r), r.jobs);
    }
    case "debug_search": return toolOk(await runDebugSearch(args));
    case "get_job": return toolOk(await runGetJob(args));
    case "get_jobs": {
      const r = await runGetJobs(args) as Record<string, unknown>;
      return withCardLinks(toolOk(r), r.jobs);
    }
    case "check_jobs_open": return toolOk(await runCheckJobsOpen(args));
    case "board_stats": return toolOk(await runBoardStats());
    case "employer_hiring_record": return toolOk(await runEmployerHiringRecord(client, args));
    case "employer_growth": return toolOk(await runEmployerGrowth(client, args));
    case "fit_resume": {
      // Gated exactly as POST /v1/fit is: the same feature was paid on the
      // API and free here, and the free path drained the paid customers'
      // shared scorer allowance. Refused in-band, before any search runs.
      if (!hasFitAccess(tier)) {
        return toolErr(
          "fit_resume is a paid feature — résumé-to-job fit scoring, the same feature as POST /v1/fit — open on a paid key or a live pass.",
          "Upgrade the key at https://resumebooster.work/data-api, or buy a pass at " + PASS_URL + " — the search tools keep working on a free key.",
        );
      }
      return toolOk(await runFitResume(args, apiKeyId));
    }
    case "check_apply_support": return toolOk(await runCheckApplySupport(client, args));
    case "request_application": return toolOk(await runRequestApplication(client, apiKeyId, args));
    case "application_status": return toolOk(await runApplicationStatus(client, apiKeyId, args));
    case "search": return toolOk(await runSearchAlias(args));
    case "fetch": return toolOk(await runFetchAlias(args));
    default: return null;
  }
}

/**
 * THE FIRST CALL WITH NO KEY GETS AN ANSWER, NOT A WALL.
 *
 * One of ANON_TOOLS, called with no Authorization header. The caller is
 * counted by mcp_anon_check under a hash of its first x-forwarded-for hop
 * and under the global bucket; both must be at or under their caps after
 * counting. A refusal is in band with the caps named and the mint URL — the
 * same shape every other refusal here takes — and a Retry-After that says
 * when the day turns. An answer is the tool's ordinary result with the search
 * limit clamped, plus a `note` saying how many unkeyed calls are left and
 * what a free key raises that to, and an `unkeyed` block with the same
 * figures as numbers. board_stats additionally carries `withKey`: where a key
 * comes from and what it adds, so the cheapest tool here is also the one
 * that explains the rest.
 *
 * Never metered through api_key_check's tables (there is no key) and never
 * through the cross-function rate budget (that starved résumé upload once).
 */
async function answerUnkeyed(
  client: SupabaseClient,
  req: Request,
  rpcId: unknown,
  toolName: string,
  args: Record<string, unknown>,
  params: Record<string, unknown> = {},
): Promise<{ rpc: unknown; headers: Record<string, string> }> {
  const ipHash = (await sha256Hex(callerAddress(req.headers))).slice(0, 16);
  // A ChatGPT caller stamps its user as `openai/subject` in _meta. It is
  // caller-written, so it is NEVER the allowance's key (the address bucket
  // stays the bound); it is logged beside the bucket, hashed to the same
  // 16-hex prefix, so the edge log can say how many distinct subjects share
  // one address per day — the measurement that decides whether the shared
  // egress wall is ever met by real users. Until the adoption reader carries
  // it, that count is a grep of this line.
  const subject = openaiSubjectOf(params);
  if (subject) console.log(`[AGENT-MCP] unkeyed subject ${(await sha256Hex(subject)).slice(0, 16)} on address ${ipHash} (${toolName})`);
  const { data, error } = await client
    .rpc("mcp_anon_check", { p_ip_hash: ipHash, p_global_cap: ANON_GLOBAL_CAP_PER_DAY, p_ip_cap: ANON_IP_CAP_PER_DAY })
    .maybeSingle();
  if (error || !data) {
    console.error("[AGENT-MCP] unkeyed allowance check failed:", error?.message?.slice(0, 160));
    return { rpc: rpcError(rpcId, -32603, "the unkeyed allowance is temporarily unavailable — retry shortly, or send a free key"), headers: {} };
  }
  const a = data as AnonDecision;
  const keyRaisesTo = FREE_KEY_DAILY_QUOTA.toLocaleString("en-US");
  if (!a.allowed) {
    const which = a.ip_used >= a.ip_cap
      ? `${a.ip_cap} unkeyed calls a day from one address`
      : `${a.global_cap} unkeyed calls a day across every caller`;
    return {
      rpc: rpcResult(rpcId, toolErr(
        `The unkeyed allowance is spent — ${which} (${a.ip_used} of ${a.ip_cap} from this address, ${a.global_used} of ${a.global_cap} overall today). It resets at midnight UTC.`,
        `Get a free key at ${MINT_URL} — ${keyRaisesTo} calls a day, no account — and send it as Authorization: Bearer <key>.`,
      )),
      headers: { "Retry-After": String(secondsToMidnightUtc()) },
    };
  }
  // The sentence names the address cap as its denominator, so its numerator
  // is the address figure; when the world is the tighter bucket that is said
  // in its own clause, and the header carries whichever binds first.
  const ipLeft = Math.max(0, a.ip_cap - a.ip_used);
  const globalLeft = Math.max(0, a.global_cap - a.global_used);
  const left = Math.min(ipLeft, globalLeft);
  const worldClause = globalLeft < ipLeft ? `; ${globalLeft} across every unkeyed caller` : "";
  const note = `unkeyed: ${ipLeft} of ${a.ip_cap} anonymous calls left today${worldClause}; a free key raises this to ${keyRaisesTo}`;
  const unkeyed = {
    callsLeftToday: ipLeft,
    ipCap: a.ip_cap,
    globalLeftToday: globalLeft,
    globalCap: a.global_cap,
    resetsInSeconds: secondsToMidnightUtc(),
    mintUrl: MINT_URL,
    keyRaisesTo: FREE_KEY_DAILY_QUOTA,
  };
  const clamped = { ...args, limit: Math.max(1, Math.min(ANON_SEARCH_LIMIT, Number(args.limit ?? ANON_SEARCH_LIMIT) || ANON_SEARCH_LIMIT)) };
  let out: Record<string, unknown>;
  switch (toolName) {
    case "search_jobs": out = { ...(await runSearchJobs(clamped) as Record<string, unknown>), note }; break;
    case "search": out = { ...(await runSearchAlias(clamped) as Record<string, unknown>), note }; break;
    case "fetch": out = { ...(await runFetchAlias(args) as Record<string, unknown>), note }; break;
    case "board_stats": {
      const stats = await runBoardStats() as Record<string, unknown>;
      out = {
        ...stats,
        note: `${note}. ${String(stats.note ?? "")}`.trim(),
        withKey: {
          mintUrl: MINT_URL,
          dailyCalls: FREE_KEY_DAILY_QUOTA,
          adds:
            `${keyRaisesTo} calls a day instead of ${a.ip_cap}, search_jobs pages up to ${KEYED_SEARCH_LIMIT} rows instead of ${ANON_SEARCH_LIMIT}, ` +
            `and every other read tool: ${KEY_ONLY_READ_TOOLS.join(", ")}. ${PAID_TOOLS.join(", ")} needs a paid key; ` +
            `${ACCOUNT_TOOLS.join(", ")} need a key minted while signed in (${DOCS_URL}).`,
        },
      };
      break;
    }
    default: return { rpc: rpcError(rpcId, -32602, `unknown tool: ${toolName}`), headers: {} };
  }
  return { rpc: rpcResult(rpcId, withCardLinks(toolOk({ ...out, unkeyed }), out.jobs)), headers: { "X-Unkeyed-Remaining": String(left) } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "GET") {
    // The protected-resource metadata — matched on the pathname AFTER the
    // runtime's function prefix is stripped, because the production pathname
    // carries the function name and a route compared to the raw pathname
    // passes every local check and matches nothing in prod
    // (project_edge_path_prefix).
    if (isProtectedResourceMetadataPath(new URL(req.url).pathname)) return protectedResourceResponse(cors);
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
      // Tools, prompts and resources, none of which changes while a session
      // lasts: this server is stateless and holds no stream to notify on,
      // so listChanged is false everywhere and subscribe is not offered.
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      serverInfo: SERVER_INFO,
      // ONE PARAGRAPH, every tool name read off the registry. It opens with
      // what the server is and what to call first — a host that shows only
      // the first few hundred characters shows that, not the rate caps —
      // then states what a job link's id is the argument to, then the four
      // tiers. The sentence on the ledger uses the site's own words for it:
      // a takedown is a takedown here, and nothing in this paragraph calls it
      // anything else. Kept under two kilobytes, which is where one host
      // truncates; the guard measures the rendered text.
      instructions:
        `Live job search over employers' own hiring feeds, for an agent. Call ${tool("board_stats")} first — it answers with no key and says what a key adds — then ${tool("search_jobs")}; on a keyed session call ${tool("key_status")} first, it says what the key may do so nothing is discovered by refusal. ` +
        `A resumebooster.work/jobs?job=<id> link's id is the argument to ${tool("get_job")}, ${tool("fetch")}, ${tool("check_apply_support")} and ${tool("request_application")}. ` +
        `Four tiers. No key: ${ANON_TOOLS.join(", ")} answer with no Authorization header at all — search capped at ${ANON_SEARCH_LIMIT} rows, ` +
        `${ANON_IP_CAP_PER_DAY} calls a day per address and ${ANON_GLOBAL_CAP_PER_DAY} a day across every unkeyed caller, each answer saying how many are left ` +
        "(search and fetch are search_jobs and get_job under the names ChatGPT's research connector calls). " +
        `Free key, no account (${MINT_URL}): ${FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} calls a day, search_jobs with every filter and up to ${KEYED_SEARCH_LIMIT} rows, ` +
        `and every other read tool — ${KEY_ONLY_READ_TOOLS.join(", ")}; verify a shortlist with check_jobs_open (${CHECK_JOBS_OPEN_MAX} ids per call) and read it with get_jobs (${GET_JOBS_MAX}) rather than one get_job each — the quota counts calls, not ids. ` +
        `Paid key: ${PAID_TOOLS.join(", ")}, exactly like POST /v1/fit. ` +
        `Account-linked key (${DOCS_URL}) with an Agent plan OR a live pass (bought signed-in at ${PASS_URL}) and a standing mandate: ${ACCOUNT_TOOLS.join(", ")} — ` +
        "a pass also opens the paid scorer; key_status reports the time and applications left on it (the pass starts at the first call other than key_status). " +
        "This board watches postings come down and can say which employers take roles down and leave them down — employer_hiring_record and employer_growth carry that record per employer, with every unknown named as unknown. " +
        "Counts are honest: countUnavailable means the board refuses to guess, and ignoredFilters names any filter it could not apply. " +
        `The guide: ${GUIDE_URI}.`,
    }));
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202, headers: cors });
  }
  if (method === "ping") return json(rpcResult(id, {}));
  // Per-tool security schemes, for the hosts that read them (ChatGPT's
  // "Mixed" connector auth keeps search and fetch answering before sign-in
  // only when each tool says so): an unkeyed tool answers with no auth or
  // with a token; every other tool with a token. Derived from ANON_TOOLS, so
  // the list a host reads and the gate the dispatcher applies are one set.
  // Mirrored into each tool's _meta as well, for the host that reads its
  // scheme there (the same hedge as the in-band challenge below).
  if (method === "tools/list") {
    const withToken = { type: "oauth2", scopes: [OAUTH_SCOPE] };
    const tools = TOOLS.map((t) => {
      const securitySchemes = ANON_TOOLS.includes(t.name) ? [{ type: "noauth" }, withToken] : [withToken];
      return { ...t, securitySchemes, _meta: { securitySchemes } };
    });
    return json(rpcResult(id, { tools }));
  }
  // The two listings: free, unmetered, one page each (no nextCursor).
  if (method === "prompts/list") {
    return json(rpcResult(id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) }));
  }
  if (method === "resources/list") {
    return json(rpcResult(id, { resources: RESOURCES.map(({ uri, name, title, mimeType, description }) => ({ uri, name, title, mimeType, description })) }));
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  // A pasted key by its prefix; anything else in the slot is an OAuth token.
  const raw = looksLikeApiKey(bearer) ? bearer : "";
  const client = db();

  // ── prompts/get: free for everyone ────────────────────────────────────────
  // A prompt body is a function of the registry and the arguments, never of
  // the caller's key, and discovery must not spend a real call: answered
  // here for every caller, keyed or not, before the credential is read and
  // through neither meter.
  const resolved = readOf(method, params);
  if (resolved?.kind === "error") return json(rpcError(id, resolved.code, resolved.message));
  if (resolved?.kind === "prompt") {
    return json(rpcResult(id, promptMessages(resolved.prompt, promptArgsOf(params))));
  }
  const read: MeteredRead | null = resolved;

  // ── resources/read with NO credential ─────────────────────────────────────
  // The guide is documentation and free. The statistics are the unkeyed
  // board_stats answer, counted as one — the same runner, the same
  // allowance, re-shaped as contents; a card's link is the unkeyed fetch
  // answer the same way (the document shape, on either tier). The key's
  // status has no unkeyed form and goes on to the gate below, which
  // challenges it exactly as it challenges the tool it wraps. A runner
  // failure here answers the JSON-RPC error a read must answer with (the
  // shape the metered path's catch gives the same failure), never a bare
  // 500 with no body and no CORS.
  if (read && !bearer) {
    try {
      if (read.kind === "resource" && read.resource.uri === GUIDE_URI) {
        return json(rpcResult(id, contentsOf(GUIDE_URI, read.resource.mimeType, guideText())));
      }
      if (read.kind === "resource" && read.resource.uri === BOARD_STATS_URI) {
        const { rpc, headers } = await answerUnkeyed(client, req, id, tool("board_stats"), {});
        return json(asContents(id, BOARD_STATS_URI, read.resource.mimeType, rpc), 200, headers);
      }
      if (read.kind === "job") {
        const { rpc, headers } = await answerUnkeyed(client, req, id, tool("fetch"), { id: read.id });
        return json(asContents(id, read.uri, "application/json", rpc), 200, headers);
      }
    } catch (e) {
      return readFailed(id, read, e, {});
    }
  }

  if (method !== "tools/call") {
    if (!read) {
      return isNotification
        ? new Response(null, { status: 202, headers: cors })
        : json(rpcError(id, -32601, `method not found: ${String(method)}`));
    }
  }

  // ── tools/call, and a credentialed resources/read: ────────────────────────
  // authenticated + metered per name. A read is metered under the resource
  // family's endpoint through the same check as a tool; `toolName` is the name the
  // check receives — a tool's own, or the read's endpoint less the prefix —
  // and the gate below reads it like any tool's: only the unkeyed set
  // answers with nothing in the slot.
  const toolName = read ? meteredNameOf(read.endpoint) : String((params as { name?: unknown }).name ?? "");
  const toolArgs = read ? {} : ((params as { arguments?: unknown }).arguments ?? {}) as Record<string, unknown>;
  if (!read && !TOOLS.some((t) => t.name === toolName)) {
    return json(rpcError(id, -32602, `unknown tool: ${toolName}`));
  }

  // A keyed tool with nothing in the slot answers the sign-in challenge —
  // the response a host turns into its Connect card, built in the OAuth
  // module and reached from here only. The unkeyed tools go on to answer.
  // The caller that reads its sign-in cue out of a result's _meta gets the
  // same challenge in band first (the hedge above, a GUESS); every other
  // caller gets the transport form.
  if (!bearer && !read && !ANON_TOOLS.includes(toolName) && hedgeInBand(params)) {
    return json(rpcResult(id, inBandChallenge(toolName)));
  }
  if (!bearer && !ANON_TOOLS.includes(toolName)) {
    return unauthorized(cors);
  }
  // An OAuth token: verified by the module (issuer, audience bound to this
  // server, the client_id a website session token never carries, a uuid
  // subject, expiry, signature), then mapped to the account's one live key
  // so the SAME api_key_check meters it — one row, one quota, one tier,
  // shared with a key the same person pasted elsewhere. A token that fails
  // on a keyed tool is challenged; on an unkeyed tool the call proceeds
  // unkeyed. The token itself goes no further than the verifier.
  let oauthSub: string | null = null;
  let oauthClient = "";
  let keyHash = "";
  if (bearer && !raw) {
    const verdict = await verifyOAuthBearer(bearer);
    if (!verdict.ok) {
      if (!read && !ANON_TOOLS.includes(toolName) && hedgeInBand(params)) {
        console.log(`[AGENT-MCP] oauth refused (${verdict.reason}) on ${toolName}`);
        return json(rpcResult(id, inBandChallenge(toolName)));
      }
      if (!ANON_TOOLS.includes(toolName)) {
        console.log(`[AGENT-MCP] oauth refused (${verdict.reason}) on ${toolName}`);
        return unauthorized(cors);
      }
    } else {
      oauthSub = verdict.sub;
      oauthClient = verdict.clientId;
      const mapped = await subToKeyHash(client, oauthSub);
      if (!mapped) {
        // The token was valid, so this is never a challenge: the account
        // could not be given a key (no email on it, or the mint refused).
        // A keyed tool is refused in band; an unkeyed tool goes on to
        // answer unkeyed, exactly as a refused token does above — the tier
        // the page promises always answers is never walled for a valid
        // token either.
        if (!ANON_TOOLS.includes(toolName)) {
          const [why, how] = ["Your account could not be given an agent key.", `Sign in at ${DOCS_URL} and mint one there, then reconnect.`];
          return read ? readRefused(id, why, how, {}) : json(rpcResult(id, toolErr(why, how)));
        }
        oauthSub = null;
        oauthClient = "";
      } else {
        keyHash = mapped.keyHash;
      }
    }
  } else if (raw) {
    keyHash = await sha256Hex(raw);
  }

  // Keyed (a pasted key or a mapped token): checked and metered per tool,
  // here. Unkeyed (one of ANON_TOOLS): `d` stays null and the call is
  // counted by mcp_anon_check inside the try below, before any runner runs —
  // so a call whose arguments are refused there was counted first, the same
  // order the keyed path keeps.
  let d: Decision | null = null;
  let rateHeaders: Record<string, string> = {};
  if (keyHash) {
    const { data: dec, error: decErr } = await client
      .rpc("api_key_check", { p_key_hash: keyHash, p_endpoint: `/mcp/${toolName}` })
      .maybeSingle();
    if (decErr) {
      console.error("[AGENT-MCP] key check failed:", decErr.message?.slice(0, 160));
      return json(rpcError(id, -32603, "key verification temporarily unavailable — retry shortly"));
    }
    d = (dec ?? null) as Decision | null;
    // Rate/quota headers are computed from whatever the check returned, so they
    // ride the DENY response too — that is the response a client most needs them
    // on. Retry-After is in Expose-Headers; a deny that omitted it advertised a
    // header it never sent.
    rateHeaders = d
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
      if (read) return readRefused(id, message, fix, { ...rateHeaders, ...retry });
      return json(rpcResult(id, toolErr(message, fix)), 200, { ...rateHeaders, ...retry });
    }
  }

  try {
    if (!d) {
      // No key, one of ANON_TOOLS: counted by mcp_anon_check first, then
      // answered with the unkeyed note. See answerUnkeyed.
      const { rpc, headers } = await answerUnkeyed(client, req, id, toolName, toolArgs, params);
      return json(rpc, 200, headers);
    }
    // A live pass on a key: record how it was activated, once — by the key
    // itself or by the OAuth client that minted the token. One helper for
    // both paths; first writer wins.
    await noteActivatedVia(client, d, oauthSub ? oauthVia(oauthClient) : "key", req.headers.get("user-agent") ?? "");
    // A credentialed read, metered above like a tool, answered in its own
    // shape: a prompt's messages, or a resource's contents from the runner
    // the resource wraps (the key's status reads `d`, as the tool does).
    if (read) return json(rpcResult(id, await answerRead(client, read, d)), 200, rateHeaders);
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
    // A read has no isError shape: a failed runner behind a resource answers
    // the JSON-RPC error a read must answer with (the same words, the same
    // headers), never a tool-shaped result.
    if (read) return readFailed(id, read, e, rateHeaders);
    if (e instanceof ToolArgumentError) {
      // The call as sent cannot be answered, and the agent can change it: say
      // what was wrong and what to send instead, in band, metered like any
      // other answered call.
      return json(rpcResult(id, toolErr(e.message, e.fix)), 200, rateHeaders);
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
