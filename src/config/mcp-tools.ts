// THE MCP SERVER'S TOOL LIST, MIRRORED FOR EVERY SURFACE THAT DESCRIBES IT.
//
// The server that actually answers tools/list is supabase/functions/agent-mcp
// (Deno); this file is the frontend's copy of what it registers, one entry per
// tool. The /agents page renders its tool section and its "which key opens
// what" copy from this list, and the prerender bakes the crawler-facing copy
// from the same list, so neither can describe a tool the server does not have
// or miss one it does.
//
// A copy of a fact in another runtime is exactly the thing that goes stale
// without anyone noticing: the page said "six tools" for a server registering
// eleven. src/test/the-page-says-six-and-the-server-says-eleven.test.ts reads
// the Deno file and fails when this list differs from it in name, count, or
// tier — the same mirror-constant pattern src/config/products.ts uses for
// prices. Never spell the count anywhere; read MCP_TOOLS.length.
//
// `tier` is what the SERVER enforces, mirrored from its dispatch:
//   read  — any free data-API key; nothing about the caller's account.
//   paid  — the same paid-tier gate as POST /v1/fit.
//   apply — refuses a key that is not linked to an account.

export type McpToolTier = "read" | "paid" | "apply";

export interface McpTool {
  /** The `name` the server registers — the string an agent calls. */
  name: string;
  tier: McpToolTier;
  /** One sentence for a human reading the page. */
  body: string;
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "search_jobs",
    tier: "read",
    body: "Search the live board. Returns compact job cards with the board's own parsed pay and experience fields, plus its honesty disclosures: exact totals when knowable, filters it couldn't honour, words it read as filters, spelling suggestions.",
  },
  {
    name: "get_job",
    tier: "read",
    body: "Full detail for one job id, including the complete description text and when the employer's feed last confirmed it open. A dead id answers with what the board knows — a watched closure or an aged-out stub — never a stale card.",
  },
  {
    name: "get_jobs",
    tier: "read",
    body: "Up to 10 job ids in one call — the shortlist form of get_job. Ids that closed, aged out or were never here come back in `unavailable` with the reason named, so one dead id never costs the other nine.",
  },
  {
    name: "check_jobs_open",
    tier: "read",
    body: "Are these postings still on the board? Up to 200 ids per call, answered from the board's index rather than the employer's site at that instant — it names that basis so a shortlist is re-verified honestly.",
  },
  {
    name: "check_apply_support",
    tier: "read",
    body: "Whether the apply agent can submit to this job on your behalf, and what that requires. Non-supported jobs still return their direct apply URL for you to use.",
  },
  {
    name: "board_stats",
    tier: "read",
    body: "Live board statistics from cache: servable and tracked posting totals, the count of company job boards with open roles (boards, not employers — one employer can run several), the category set, and the freshness stamp.",
  },
  {
    name: "key_status",
    tier: "read",
    body: "What this key is and may do: tier, requests left this minute, calls left today, whether the paid tools are open on it, and whether the apply tools would work — with any blocker named, so nothing has to be discovered by refusal.",
  },
  {
    name: "debug_search",
    tier: "read",
    body: "Explain why a search returns what it does: the parsed query, which filters were applied or ignored and why, the route and ranking regime chosen, timings and count basis. Takes the same arguments as search_jobs.",
  },
  {
    name: "fit_resume",
    tier: "paid",
    body: "Score a résumé against the board — the site's résumé drop for an agent holding a CV. Reads the occupation out of the text, searches for it, and scores up to 20 results with matched and missing terms. Paid keys only, exactly like POST /v1/fit.",
  },
  {
    name: "request_application",
    tier: "apply",
    body: "Ask your apply agent to submit an application to a job. Passes through every gate of the signed-in flow — mandate, honesty classifier, vendor boundary, daily cap.",
  },
  {
    name: "application_status",
    tier: "apply",
    body: "Status of the applications your agent has requested — queued, submitted, refused (with the refusing gate named), or failed.",
  },
];

export const MCP_TOOL_NAMES = MCP_TOOLS.map((t) => t.name);
export const MCP_READ_TOOLS = MCP_TOOLS.filter((t) => t.tier === "read");
export const MCP_PAID_TOOLS = MCP_TOOLS.filter((t) => t.tier === "paid");
export const MCP_APPLY_TOOLS = MCP_TOOLS.filter((t) => t.tier === "apply");

/**
 * Which MCP hosts can present this server's credential today, measured
 * against each vendor's own documentation on 2026-09-15 — every tool call
 * needs `Authorization: Bearer rb_live_…`, and only some hosts can send it.
 *
 *   - Claude Code: `claude mcp add --transport http … --header` (code.claude.com/docs/en/mcp).
 *   - Cursor: `headers` in mcp.json.
 *   - claude.ai / Claude Desktop custom connectors: the dialog takes a URL and
 *     optional OAuth client credentials; a static request header is "in beta
 *     and available to a limited set of organizations", entered by the org
 *     administrator (claude.com/docs/connectors/custom/remote-mcp). Without
 *     that beta, discovery works and every tool call refuses.
 *   - ChatGPT developer mode: the connector's auth options are OAuth, No
 *     Authentication, and Mixed; there is no field for an API key
 *     (developers.openai.com/apps-sdk/build/auth — "you are expected to
 *     implement an OAuth 2.1 flow"). Discovery works and every tool call refuses.
 *
 * `header` is the property the page renders from: true means the host can
 * carry the key and therefore reach every tool its key tier allows; false
 * means the host can list the tools and call none of them today.
 */
export interface McpHost {
  name: string;
  header: boolean;
  /** How the key travels, or why it cannot. */
  how: string;
}

export const MCP_HOSTS: readonly McpHost[] = [
  { name: "Claude Code", header: true, how: "the --header flag on claude mcp add, or ${API_KEY} expansion in .mcp.json" },
  { name: "Cursor", header: true, how: "the headers block in ~/.cursor/mcp.json" },
  { name: "Any custom MCP client", header: true, how: "an Authorization header on each POST — Streamable HTTP, stateless" },
  { name: "claude.ai and Claude Desktop", header: false, how: "the custom-connector dialog takes a URL and optional OAuth client credentials only; a static header is an org-admin beta for a limited set of organizations" },
  { name: "ChatGPT (developer mode)", header: false, how: "connector auth is OAuth, No Authentication or Mixed — there is no field for an API key" },
];
