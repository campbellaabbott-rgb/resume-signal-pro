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
//   paid  — the same paid-tier gate as POST /v1/fit, OR a live pass on the
//           key's account (the pass opens the scorer and nothing on /v1).
//   apply — refuses a key that is not linked to an account; funded by an
//           Agent plan or a live pass.

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
    name: "employer_hiring_record",
    tier: "read",
    body: "An employer's record on its own board, from the closure ledger no other board keeps: roles open now, roles watched coming down in the last 90 days with re-lists counted separately, medians from the employer's own stated dates, and how long that board has been watched — per board, never summed across an employer's boards, and a takedown is never called a hire; a board with no closure observed answers unknown with the reason, never a verdict.",
  },
  {
    name: "employer_growth",
    tier: "read",
    body: "Whether an employer's board served more roles than a week earlier, judged by the board itself from our own daily observation and passed through untouched: grew, no-growth, or unknown with the gate that refused named — an unknown is never a no, one board is never summed with another, and nothing here ranks employers.",
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
    name: "search",
    tier: "read",
    body: "An alias of search_jobs in the fixed shape ChatGPT's deep-research and company-knowledge connectors call: one query in, a list of {id, title, url} out, the same page size as an unkeyed search. Every other client should call search_jobs, which takes every filter.",
  },
  {
    name: "fetch",
    tier: "read",
    body: "An alias of get_job in the same ChatGPT research shape: one id in, {id, title, text, url, metadata} out — the full description as text and the card's structured fields as metadata. A dead id answers with what the board knows, never a stale card.",
  },
  {
    name: "fit_resume",
    tier: "paid",
    body: "Score a résumé against the board — the site's résumé drop for an agent holding a CV. Reads the occupation out of the text, searches for it, and scores up to 20 results with matched and missing terms. Paid keys, exactly like POST /v1/fit — and a live pass.",
  },
  {
    name: "request_application",
    tier: "apply",
    body: "Ask your apply agent to submit an application to a job — on an Agent plan, or on a live pass that pays for it at accept. Passes through every gate of the signed-in flow — mandate, honesty classifier, vendor boundary, daily cap.",
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
 * THE UNKEYED TIER, mirrored from the server's ANON_TOOLS and the caps beside
 * it. These tools answer a tools/call that carries no Authorization header at
 * all, which is what makes claude.ai, Claude Desktop and ChatGPT — hosts whose
 * connector dialogs have no field for a key — usable on a first call. The
 * caps are per address per UTC day and across every unkeyed caller per day
 * (both, because those hosts share egress addresses), and an unkeyed search
 * is one page. Pinned to the Deno constants, and the free-key quota to the
 * minting function's own constant, by
 * src/test/a-first-call-with-no-key-gets-an-answer-not-a-wall.test.ts.
 */
export const MCP_ANON_TOOL_NAMES: readonly string[] = ["board_stats", "search_jobs", "search", "fetch"];
export const MCP_ANON_TOOLS = MCP_TOOLS.filter((t) => MCP_ANON_TOOL_NAMES.includes(t.name));
export const MCP_ANON_CAPS = { perAddressPerDay: 25, globalPerDay: 2000, searchRows: 10 } as const;
/** Calls a day on a free key — api_key_issue's c_quota (migration 20260826214700), mirrored. */
export const MCP_FREE_KEY_DAILY_QUOTA = 1000;

/**
 * Which MCP hosts can present this server's credential today, measured
 * against each vendor's own documentation on 2026-09-15 — every KEYED tool
 * call needs `Authorization: Bearer rb_live_…`, and only some hosts can send
 * it. The unkeyed tools (MCP_ANON_TOOLS) answer from any host.
 *
 *   - Claude Code: `claude mcp add --transport http … --header` (code.claude.com/docs/en/mcp).
 *   - Cursor: `headers` in mcp.json.
 *   - claude.ai / Claude Desktop custom connectors: the dialog takes a URL and
 *     optional OAuth client credentials; a static request header is "in beta
 *     and available to a limited set of organizations", entered by the org
 *     administrator (claude.com/docs/connectors/custom/remote-mcp). Without
 *     that beta the host holds only an OAuth token, so the pass reaches a
 *     call from here through sign-in (`oauth` below), never through a key.
 *   - ChatGPT developer mode: the connector's auth options are OAuth, No
 *     Authentication, and Mixed; there is no field for an API key
 *     (developers.openai.com/apps-sdk/build/auth — "you are expected to
 *     implement an OAuth 2.1 flow"). Same: OAuth or the unkeyed tools.
 *
 * Two properties the page renders from. `header`: the host can carry the
 * key and therefore reach every tool its key tier allows. `oauth`: the host
 * can sign a person in to the server, so a keyed tool reaches their own
 * account-linked key (and any pass or plan on it) without a key ever being
 * pasted. A host with neither can list the tools and call only the unkeyed
 * ones.
 */
export interface McpHost {
  name: string;
  header: boolean;
  /**
   * Whether this host can sign a person in to the server through OAuth —
   * the ONLY way a host with no header field can present a per-user paid
   * credential (an Agent Pass or an Agent plan). True for the connector
   * hosts now that the server answers its protected-resource metadata and
   * a keyed tool called with no credential answers a sign-in challenge the
   * host turns into its Connect card; the consent route on this site
   * completes the round trip. A host marked true is told to "choose Sign in
   * when needed"; a host marked false keeps the unkeyed tools only. The
   * key-carrying hosts stay on the key (their primary path) and are not
   * marked, so the page never sends a Claude Code or Cursor user through a
   * browser when a pasted key already works.
   */
  oauth: boolean;
  /** How the key travels, or why it cannot. */
  how: string;
  /**
   * Which hand-off block the post-purchase page renders for this host:
   * the Claude Code one-liner, the Cursor mcp.json, a paste-the-URL walk
   * for connector dialogs, or the bare header for a custom client.
   */
  handoff: "claude-code" | "cursor" | "connector" | "header";
}

export const MCP_HOSTS: readonly McpHost[] = [
  { name: "Claude Code", header: true, oauth: false, handoff: "claude-code", how: "the --header flag on claude mcp add, or ${API_KEY} expansion in .mcp.json" },
  { name: "Cursor", header: true, oauth: false, handoff: "cursor", how: "the headers block in ~/.cursor/mcp.json" },
  { name: "Any custom MCP client", header: true, oauth: false, handoff: "header", how: "an Authorization header on each POST — Streamable HTTP, stateless" },
  { name: "claude.ai and Claude Desktop", header: false, oauth: true, handoff: "connector", how: "paste the URL as a custom connector and choose Sign in when needed — the first keyed tool shows a Connect card that signs you in through OAuth; the dialog has no field for a key (a static header is an org-admin beta), and with No sign-in only the unkeyed tools answer" },
  { name: "ChatGPT (developer mode)", header: false, oauth: true, handoff: "connector", how: "add the URL as a connector with OAuth (or Mixed, so search and fetch keep answering before sign-in) and Allow on the consent page; there is no field for an API key, and with No Authentication only the unkeyed tools answer (search and fetch are the names its research connector calls)" },
];
