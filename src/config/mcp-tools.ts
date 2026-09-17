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

/**
 * The two caps a keyed read carries — rows per search page and ids per
 * check_jobs_open call — mirrored from the server's KEYED_SEARCH_LIMIT and
 * CHECK_JOBS_OPEN_MAX (pinned by the-attach-menu test). Declared above the
 * tool list because a body below reads it (a const cannot be read above its
 * line).
 */
export const MCP_KEYED_CAPS = { searchRows: 60, checkJobsOpenIds: 200 } as const;

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
    body: `Are these postings still on the board? Up to ${MCP_KEYED_CAPS.checkJobsOpenIds} ids per call, answered from the board's index rather than the employer's site at that instant — it names that basis so a shortlist is re-verified honestly.`,
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


// ───────────────────────── THE SIGN-IN FACT ─────────────────────────────
//
// Whether a chat host (claude.ai, ChatGPT) can sign a person in to this
// server is ONE fact, computed by the server (a cached probe of its
// authorization server's metadata) and carried on the `initialize` result
// under a reverse-DNS `_meta` key. The page reads that key and branches on
// `state` only; nothing on the site derives the fact a second way (no
// client-side probe, no build-time flag — both refuted in the connect3
// spec). The key is spelled once here and once in the Deno probe module;
// src/test/which-agent-do-you-use.test.tsx reads the Deno file and fails
// when the two spellings part.

export const MCP_SIGN_IN_META_KEY = "work.resumebooster/sign-in";

export type SignInState = "on" | "off" | "unknown";

export interface SignInFact {
  state: SignInState;
  checkedAt: string | null;
  authorizationServer: string | null;
  reason: string | null;
}

/** What the page assumes until the server has said otherwise. */
export const SIGN_IN_UNKNOWN: SignInFact = { state: "unknown", checkedAt: null, authorizationServer: null, reason: null };

/**
 * The fact as an initialize result carries it, or `unknown` for a result
 * that carries none (an older server, a malformed field, a network fault).
 * Only `state` decides anything; the other fields are for the developer
 * disclosure.
 */
export function readSignInFact(initializeResult: unknown): SignInFact {
  const r = initializeResult as { _meta?: Record<string, unknown> } | null;
  const raw = r?._meta?.[MCP_SIGN_IN_META_KEY] as Partial<SignInFact> | undefined;
  const state: SignInState = raw?.state === "on" || raw?.state === "off" ? raw.state : "unknown";
  return {
    state,
    checkedAt: typeof raw?.checkedAt === "string" ? raw.checkedAt : null,
    authorizationServer: typeof raw?.authorizationServer === "string" ? raw.authorizationServer : null,
    reason: typeof raw?.reason === "string" ? raw.reason : null,
  };
}

// ───────────────────────── THE WORDS EVERY SURFACE SHARES ─────────────────

/** The protocol revision the server advertises (its MCP_PROTOCOL_VERSIONS[0]); sent as the mcp-protocol-version header. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** The display name a person types into a connector dialog. */
export const MCP_CONNECTOR_NAME = "Resume Booster";
/** The name the server's initialize answer carries as serverInfo.name (the Deno SERVER_INFO.name; pinned equal by a guard). */
export const MCP_SERVER_INFO_NAME = "resumebooster-job-board";
/** The server's key in every host's config file and command. */
export const MCP_SERVER_KEY = "resumebooster";
/** The shell variable the keyed blocks read, so a key never sits in a command or a committed file. */
export const MCP_KEY_ENV = "RESUMEBOOSTER_KEY";
/** Where a free key is minted (the site's own page; the server's MINT_URL names the same route). */
export const MCP_MINT_PATH = "/data-api";
/** The query the "Test the server" button searches for — fixed, so every run is comparable. */
export const MCP_TEST_QUERY = "nurse";
/** The public install repository (mirrors this file's hosts by id). */
export const MCP_INSTALL_REPO_URL = "https://github.com/campbellaabbott-rgb/resumebooster-mcp";
/**
 * The one sentence printed wherever the address is pasted. The Supabase URL
 * is the canonical and ONLY address: a redirect drops the Authorization
 * header on some hosts and a proxy would fork the resource identity the
 * OAuth server binds tokens to (connect3 spec §4).
 */
export const MCP_SERVER_ADDRESS_NOTE = "This address is on Supabase, the company that hosts our server; it is ours. Paste it exactly as it is.";

/**
 * The gloss of "address", used once per panel where the cap is first named.
 * Replaces "per address" everywhere: a chat service's own servers are one
 * address, so from Claude or ChatGPT the number left can start below the cap.
 */
export const MCP_ADDRESS_GLOSS =
  `${MCP_ANON_CAPS.perAddressPerDay} free calls a day per network address — an office, a home connection, or a chat service's own servers count as one address, so from Claude or ChatGPT the number left can start below ${MCP_ANON_CAPS.perAddressPerDay} because other people share it.`;

/** The three things that need an account, said under every host's steps. */
export const MCP_NEEDS_ACCOUNT_LINE =
  "The three things that need your account (a key or a sign-in): opening a posting in full through get_job (fetch works without), checking that a shortlist is still open, and applying.";

/** The tools a free key opens beyond the unkeyed four — every read tool outside the unkeyed set. */
export const MCP_KEY_ONLY_READ_TOOLS = MCP_READ_TOOLS.filter((t) => !MCP_ANON_TOOL_NAMES.includes(t.name));

/** "a, b and c" for prose; items carrying their own " and " are joined with semicolons so no list reads "and … and". */
export const andList = (xs: readonly string[]): string => {
  if (xs.length < 2) return xs.join("");
  if (xs.some((x) => / and /.test(x))) return `${xs.slice(0, -1).join("; ")}; and ${xs[xs.length - 1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
};

// ───────────────────────── THE HOSTS AND THEIR STEPS ──────────────────────
//
// /agents opens with one question — "Which agent do you use?" — and six
// buttons in the owner's order. Picking one reveals only that host's
// numbered steps. The steps, the "how you know it worked" line and the
// sign-in sentence per state live HERE, as builders over the server address,
// so the page, the pass receipt, the prerender and the install repo's README
// render one list and the switchboard can never say something the mirror
// does not. Every host-UI label is quoted from the vendor's own document,
// named on the host; every command and config block is produced by a
// builder, never typed in JSX.
//
// KEYLESS IS THE DEFAULT of every block. A keyed block exists only after a
// key is pasted into the page's field (or minted on the receipt page); with
// no key the builders render the shell `export` line with an empty value and
// the "paste your key above" sentence — never a placeholder inside an
// Authorization value. The deep links (cursor://, vscode:) take no key at
// all. which-agent-do-you-use.test.tsx renders every block both ways and
// decodes every link.

export const MCP_HOST_IDS = ["claude", "chatgpt", "claude-code", "cursor", "vscode", "more"] as const;
export type McpHostId = (typeof MCP_HOST_IDS)[number];

/** What every builder is handed: the server address, and the key once there is one. */
export interface McpCtx {
  url: string;
  key?: string;
  /** The sign-in fact's state where a host's steps depend on it (Zed); absent — the prerender, the receipt — reads as not on. */
  signIn?: SignInState;
}

/** One numbered step: a sentence (with **label** and `code` marks), and, when there is something to paste, the exact text of it. */
export interface McpStep {
  text: string;
  /** The pasteable thing — a command, a block, an address, a prompt. */
  copy?: string;
  /** What the copy button says it copies. */
  copyLabel?: string;
  /** A small line under the step. */
  note?: string;
}

/** The optional "with a free key" part of a header host's panel. */
export interface McpKeyed {
  /** Whether the key's value is written into the block (false when the host prompts for it itself). */
  takesKey: boolean;
  title: string;
  steps: (ctx: McpCtx) => McpStep[];
}

export interface McpDeepLink {
  label: string;
  href: string;
}

export interface McpHost {
  id: McpHostId;
  /** The button label, and the option in the board's "Which agent?" chooser. */
  name: string;
  /** Small print under the button. */
  small?: string;
  /** The host can carry the key in an Authorization header and therefore reach every tool its key tier allows. */
  header: boolean;
  /**
   * The host can sign a person in to the server through OAuth — the only
   * way a host with no header field presents a per-user credential. A
   * capability of the host; whether the sign-in WORKS today is the server's
   * runtime fact (SignInFact), and every rendered sentence branches on that
   * fact, never on this flag alone.
   */
  oauth: boolean;
  /** How the key travels, or why it cannot — the developer disclosure's row. */
  how: string;
  /** The documents the labels in `steps` are quoted from. */
  docs: readonly string[];
  steps: (ctx: McpCtx) => McpStep[];
  keyed?: McpKeyed;
  deeplinks?: (ctx: McpCtx) => McpDeepLink[];
  /** The sign-in sentence for this host, by the server's fact. */
  signIn: (state: SignInState) => string;
  /** How you know it worked — judged by the server's own answer, never a pixel. */
  verify: string;
}

/** A base64 of an ASCII string, in the browser and in Node alike. */
const b64 = (s: string): string => btoa(s);

const json = (o: unknown) => JSON.stringify(o, null, 2);

/** `export RESUMEBOOSTER_KEY=…` — the only line a key is ever written into; empty until one is pasted. */
export const exportLine = (key?: string) => `export ${MCP_KEY_ENV}=${key ?? ""}`;
export const PASTE_KEY_NOTE = "Paste your key above to fill this in.";
/** The shell header the CLI hosts send: the variable, never the value. */
const shellHeader = `--header "Authorization: Bearer $${MCP_KEY_ENV}"`;

const claudeCodeAdd = (url: string) => `claude mcp add --transport http --scope user ${MCP_SERVER_KEY} ${url}`;
const geminiAdd = (url: string) => `gemini mcp add --transport http --scope user ${MCP_SERVER_KEY} ${url}`;
const codexAdd = (url: string) => `codex mcp add ${MCP_SERVER_KEY} --url ${url}`;
const codexToml = (url: string, keyed: boolean) =>
  `[mcp_servers.${MCP_SERVER_KEY}]\nurl = "${url}"${keyed ? `\nbearer_token_env_var = "${MCP_KEY_ENV}"` : ""}`;

/** The Cursor mcp.json block: keyless, or with Cursor's documented ${env:NAME} interpolation so the key never sits in the file. */
export const cursorBlock = (url: string, keyed: boolean) =>
  json({ mcpServers: { [MCP_SERVER_KEY]: { url, ...(keyed ? { headers: { Authorization: `Bearer \${env:${MCP_KEY_ENV}}` } } : {}) } } });

/** The VS Code .vscode/mcp.json block: the key is an input VS Code prompts for (password: true); Enter leaves it empty. */
export const vscodeBlock = (url: string) =>
  json({
    inputs: [{ type: "promptString", id: `${MCP_SERVER_KEY}-key`, description: `${MCP_CONNECTOR_NAME} key (optional — Enter for none)`, password: true }],
    servers: { [MCP_SERVER_KEY]: { type: "http", url, headers: { Authorization: `Bearer \${input:${MCP_SERVER_KEY}-key}` } } },
  });

const clineBlock = (url: string, key?: string) =>
  json({ mcpServers: { [MCP_SERVER_KEY]: { type: "streamableHttp", url, ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) } } });
const zedBlock = (url: string, key?: string) =>
  json({ context_servers: { [MCP_SERVER_KEY]: { url, ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) } } });
/** The Windsurf block (~/.codeium/windsurf/mcp_config.json): serverUrl, and the documented ${env:NAME} interpolation when keyed. */
const windsurfBlock = (url: string, keyed: boolean) =>
  json({ mcpServers: { [MCP_SERVER_KEY]: { serverUrl: url, ...(keyed ? { headers: { Authorization: `Bearer \${env:${MCP_KEY_ENV}}` } } : {}) } } });

/** The initialize message any client sends first — what the "Test the server" button and the curl line use. */
export const initializeMessage = () =>
  json({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "your-client", version: "1.0" } } });

/** The same test as a curl line: initialize, then the sign-in fact read out of the answer. */
export const curlInitialize = (url: string) =>
  `curl -s -X POST ${url} -H 'content-type: application/json' -H 'mcp-protocol-version: ${MCP_PROTOCOL_VERSION}' -d '${initializeMessage().replace(/\s+/g, " ")}'`;

const ASK_STATS = "call board_stats";
const ASK_KEY = "call key_status";

const anonNames = () => MCP_ANON_TOOL_NAMES.join(", ");
const keyOnlyNames = () => MCP_KEY_ONLY_READ_TOOLS.map((t) => t.name).join(", ");
const headerHostNames = () => MCP_HOSTS.filter((h) => h.header && h.id !== "more").map((h) => h.name);

/** The chat hosts' `off` sentence, one wording with the host's name in it. */
const chatOff = (host: string) =>
  `Sign-in from ${host} is not switched on yet. From ${host}, these tools work with no sign-in: ${anonNames()} (search shows ${MCP_ANON_CAPS.searchRows} results). A tool that needs your account answers in words that sign-in is off — no card appears. To use every tool today, connect from ${andList(headerHostNames())} with a free key (pick that app above).`;
const UNKNOWN_LINE = "We could not check sign-in just now; press **Test the server** below in a minute.";
const cliOff = "Without a key, a tool that needs your account answers in words that sign-in is off; add a free key (below) to use it.";
const cliUnknown = `${UNKNOWN_LINE} The free-key steps below work in every state.`;

const addressStep = (ctx: McpCtx, into: string): McpStep => ({
  text: `Paste this address into ${into}:`,
  copy: ctx.url,
  copyLabel: "the server address",
  note: MCP_SERVER_ADDRESS_NOTE,
});

/** The "with a free key" sub-steps for the CLI hosts: mint, paste, export, add with the variable, verify. */
const cliKeyed = (add: (url: string) => string, reconnect: string): McpKeyed => ({
  takesKey: true,
  title: `With a free key (optional — opens every read tool: ${keyOnlyNames()}; ${MCP_FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} calls a day)`,
  steps: (ctx) => [
    { text: `Get a free key at ${MCP_MINT_PATH} — it asks for an email and shows the key once.` },
    {
      text: "Paste the key in the field above — the two lines below fill themselves (nothing is sent anywhere; the field only edits the text on this page). Run the first line, then the second:",
      copy: exportLine(ctx.key),
      copyLabel: "the export line",
      note: ctx.key ? undefined : PASTE_KEY_NOTE,
    },
    { text: "Then add the server with the key's variable in the header:", copy: `${add(ctx.url)} ${shellHeader}`, copyLabel: "the add command with the key header" },
    { text: `${reconnect}, then ask: \`${ASK_KEY}\` — it names your tier and calls left.` },
  ],
});

export const MCP_HOSTS: readonly McpHost[] = [
  {
    id: "claude",
    name: "Claude",
    small: "claude.ai, Claude Desktop, Claude on your phone",
    header: false,
    oauth: true,
    how: "paste the address as a custom connector and choose Sign in when needed — while the server's sign-in is on, the first tool that needs your account shows a Connect card that signs you in through OAuth; the dialog has no field for a key (a static header is an org-admin beta), and with No sign-in only the unkeyed tools answer",
    docs: ["https://claude.com/docs/connectors/custom/remote-mcp"],
    steps: (ctx) => [
      { text: "In Claude, open **Customize**, then **Connectors**." },
      { text: "Click **Add custom connector**.", note: "On a Team or Enterprise plan there is no such button: an owner adds the connector under **Organization settings > Connectors** (**Add**, then **Custom**; if it asks for the connector type, **Web**), and you then find it under **Customize > Connectors** with the \"Custom\" label and click **Connect**." },
      { text: "If it asks for a **Name**, type:", copy: MCP_CONNECTOR_NAME, copyLabel: "the connector name" },
      addressStep(ctx, "**MCP server URL**"),
      {
        text: "If Claude asks about **Authentication**, choose **Sign in when needed**. If it asks about **OAuth client**, choose **Register automatically**. (Claude may already show these as \"Detected\" — leave them. Do not choose **No sign-in**: Claude cannot change that later, so the tools that need your account would stay off until you remove the connector and add it again.)",
        note: "**Sign in when needed** means search works at once, and Claude asks you to sign in only when a tool needs your account. **Register automatically** is the only OAuth-client choice this server supports; **Use Claude's published identity** does not work here even though Claude marks it recommended.",
      },
      { text: "Click **Add**." },
      { text: `In a chat, click **+**, open **Connectors**, and switch **${MCP_CONNECTOR_NAME}** on.` },
      { text: "Ask Claude:", copy: `Using ${MCP_CONNECTOR_NAME}, ${ASK_STATS} and tell me how many jobs are open right now.`, copyLabel: "the first question" },
    ],
    signIn: (s) =>
      s === "on"
        ? `The first time Claude needs your account — to open a posting in full, to check a shortlist, or to apply — a **Connect** card appears in the chat. Click it, sign in to ${MCP_CONNECTOR_NAME}, press **Allow**, and Claude continues where it stopped.`
        : s === "off" ? chatOff("Claude") : UNKNOWN_LINE,
    verify: `Under **+ → Connectors**, ${MCP_CONNECTOR_NAME} is on. Ask "${ASK_STATS}": the answer names the number of open postings and a note that reads "unkeyed: N of ${MCP_ANON_CAPS.perAddressPerDay} anonymous calls left today".`,
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    small: "developer mode",
    header: false,
    oauth: true,
    how: "add the address as a connector in developer mode; there is no field for an API key, and search and fetch (the names its research connector calls) answer with no sign-in — while the server's sign-in is on, a tool that needs your account shows ChatGPT's own OAuth sign-in and you press Allow on the consent page",
    docs: ["https://developers.openai.com/apps-sdk/deploy/connect-chatgpt", "https://developers.openai.com/apps-sdk/build/auth"],
    steps: (ctx) => [
      { text: "In ChatGPT, open **Settings**, choose **Security and login**, and turn on **Developer mode**. (If you do not see it, your account or workspace does not allow it yet.)" },
      { text: "Go to this page and click the **+** button:", copy: "https://chatgpt.com/plugins", copyLabel: "the ChatGPT plugins link" },
      { text: "Type a name —", copy: MCP_CONNECTOR_NAME, copyLabel: "the connector name", note: "— and a description: `Live job board: search real openings from employers' own hiring systems.`" },
      {
        text: "Under **Connection**, paste this address as the MCP server URL. Paste it exactly as it is — do not add `/mcp` at the end.",
        copy: ctx.url,
        copyLabel: "the server address",
        note: MCP_SERVER_ADDRESS_NOTE,
      },
      { text: `Create the connection, and check the list of tools it found — there should be ${MCP_TOOLS.length}.` },
      { text: `Start a new chat and add **${MCP_CONNECTOR_NAME}** from the tools menu.` },
      { text: "Ask:", copy: `Search ${MCP_CONNECTOR_NAME} for nurse jobs in Texas and show me the first ten.`, copyLabel: "the first question", note: `ChatGPT's own search uses two of the tools, \`search\` and \`fetch\`: ${MCP_ANON_CAPS.searchRows} results per search, and the full text of any result. That works with no sign-in.` },
    ],
    signIn: (s) =>
      s === "on"
        ? `When a tool needs your account, ChatGPT shows its sign-in for ${MCP_CONNECTOR_NAME}; sign in and press **Allow**.`
        : s === "off" ? chatOff("ChatGPT") : UNKNOWN_LINE,
    verify: `Ask it to search for "nurse in Texas": ${MCP_ANON_CAPS.searchRows} results with ids come back.`,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    header: true,
    oauth: false,
    how: "the --header flag on claude mcp add, with the key in a shell variable",
    docs: ["https://code.claude.com/docs/en/mcp"],
    steps: (ctx) => [
      { text: "Copy this line and run it in your terminal:", copy: claudeCodeAdd(ctx.url), copyLabel: "the add command", note: `\`--scope user\` makes it available in every folder, not just this one. ${MCP_SERVER_ADDRESS_NOTE}` },
      { text: `Start \`claude\` and type \`/mcp\` — \`${MCP_SERVER_KEY}\` is listed as connected.` },
      { text: `Ask: \`${ASK_STATS}\` — the answer names the number of open postings and says how many free calls are left today.` },
    ],
    keyed: cliKeyed(claudeCodeAdd, "Type `/mcp` and reconnect"),
    signIn: (s) =>
      s === "on"
        ? `Without a key, the first tool that needs your account makes \`/mcp\` show \`! Needs authentication\`; type \`/mcp\` and sign in in the browser (Claude Code 2.1.186 or newer can also run \`claude mcp login ${MCP_SERVER_KEY}\`).`
        : s === "off" ? cliOff : cliUnknown,
    verify: `\`/mcp\` lists \`${MCP_SERVER_KEY}\` as connected; "${ASK_STATS}" answers with the count and the unkeyed note; with a key, "${ASK_KEY}" names your tier and calls left.`,
  },
  {
    id: "cursor",
    name: "Cursor",
    header: true,
    oauth: false,
    how: "the headers block in ~/.cursor/mcp.json, with Cursor's ${env:NAME} interpolation so the key never sits in the file",
    docs: ["https://cursor.com/docs/context/mcp", "https://cursor.com/docs/context/mcp/install-links"],
    steps: (ctx) => [
      { text: "Click **Add to Cursor** below — Cursor opens and asks you to confirm the server. (The link carries only the address, never a key.)" },
      { text: "Or paste this block into `~/.cursor/mcp.json`:", copy: cursorBlock(ctx.url, false), copyLabel: "the Cursor mcp.json block", note: MCP_SERVER_ADDRESS_NOTE },
      { text: `In Cursor's chat, ask: \`${ASK_STATS}\`.` },
    ],
    keyed: {
      takesKey: true,
      title: `With a free key (optional — opens every read tool: ${keyOnlyNames()}; ${MCP_FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} calls a day)`,
      steps: (ctx) => [
        { text: `Get a free key at ${MCP_MINT_PATH} — it asks for an email and shows the key once.` },
        { text: "Paste the key in the field above; set it in your shell (nothing is sent anywhere):", copy: exportLine(ctx.key), copyLabel: "the export line", note: ctx.key ? undefined : PASTE_KEY_NOTE },
        { text: "Use this block instead — the header reads the variable, so the key never sits in the file:", copy: cursorBlock(ctx.url, true), copyLabel: "the keyed Cursor mcp.json block" },
        { text: `Restart Cursor, then ask: \`${ASK_KEY}\` — it names your tier and calls left.` },
      ],
    },
    deeplinks: (ctx) => [
      { label: "Add to Cursor", href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_KEY}&config=${b64(JSON.stringify({ url: ctx.url }))}` },
    ],
    signIn: (s) =>
      s === "on"
        ? "Without a key, a tool that needs your account answers a sign-in challenge; what Cursor shows for it is not described in a document we have read, so add a free key (below) to use those tools."
        : s === "off" ? cliOff : cliUnknown,
    verify: `Ask the chat "${ASK_STATS}" — the same count and note. (Cursor's own status indicator is not described in a document we have read, so this page does not describe it.)`,
  },
  {
    id: "vscode",
    name: "VS Code",
    header: true,
    oauth: false,
    how: "the headers block in .vscode/mcp.json, fed by a promptString input with password: true so the key is typed into VS Code, never into the file",
    docs: ["https://code.visualstudio.com/docs/agents/reference/mcp-configuration", "https://code.visualstudio.com/api/extension-guides/ai/mcp"],
    steps: (ctx) => [
      { text: "Click **Add to VS Code** below (or the **Insiders** twin) — VS Code asks you to confirm. (The link carries only the address, never a key.)" },
      { text: "Or paste this block into `.vscode/mcp.json`. When the server starts, VS Code asks for the key; leave it empty to use the tools that need no key (VS Code's own document does not say what an empty answer does — if the server does not start, use the link above instead):", copy: vscodeBlock(ctx.url), copyLabel: "the VS Code mcp.json block", note: MCP_SERVER_ADDRESS_NOTE },
      { text: `In the chat, ask: \`${ASK_STATS}\`.` },
    ],
    keyed: {
      takesKey: false,
      title: `With a free key (optional — opens every read tool: ${keyOnlyNames()}; ${MCP_FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} calls a day)`,
      steps: () => [
        { text: `Get a free key at ${MCP_MINT_PATH} — it asks for an email and shows the key once.` },
        { text: "When VS Code asks for the key at start (the block above declares it as a hidden input), paste it there — it is never written into the file." },
        { text: `Ask: \`${ASK_KEY}\` — it names your tier and calls left.` },
      ],
    },
    deeplinks: (ctx) => {
      const cfg = encodeURIComponent(JSON.stringify({ name: MCP_SERVER_KEY, type: "http", url: ctx.url }));
      return [
        { label: "Add to VS Code", href: `vscode:mcp/install?${cfg}` },
        { label: "Insiders", href: `vscode-insiders:mcp/install?${cfg}` },
      ];
    },
    signIn: (s) =>
      s === "on"
        ? "Without a key, a tool that needs your account answers a sign-in challenge; what VS Code shows for it is not described in a document we have read, so add a free key (below) to use those tools."
        : s === "off" ? cliOff : cliUnknown,
    verify: `If you used the mcp.json block, VS Code asks for the key at start — leave it empty (the link declares no key, so it asks nothing). Either way, ask the chat "${ASK_STATS}" — the same count and note.`,
  },
  {
    id: "more",
    name: "More…",
    small: "Gemini CLI, Codex CLI, Cline, Zed, Windsurf, anything else",
    header: true,
    oauth: false,
    how: "an Authorization header on each POST — Streamable HTTP, stateless; each app below has its own block",
    docs: [],
    steps: (ctx) => [
      { text: "Pick your app below, or, for any client at all, send this one message as a POST to the address (one JSON-RPC message per request):", copy: initializeMessage(), copyLabel: "the initialize message", note: MCP_SERVER_ADDRESS_NOTE },
      { text: "Then ask your agent to call `board_stats`." },
    ],
    keyed: {
      takesKey: false,
      title: "With a free key (any client)",
      steps: () => [
        { text: `Get a free key at ${MCP_MINT_PATH}, and send it as \`Authorization: Bearer <key>\` on each request.` },
      ],
    },
    signIn: (s) =>
      s === "on"
        ? "Without a key, a tool that needs your account answers a sign-in challenge (HTTP 401); a client that supports sign-in opens it, and a client that does not needs a free key."
        : s === "off" ? cliOff : cliUnknown,
    verify: `The initialize answer's \`serverInfo.name\` is \`${MCP_SERVER_INFO_NAME}\`; the **Test the server** button on this page runs this for you.`,
  },
];

/** The long tail under "More…": one block each, from the same builders. */
export interface McpMoreHost {
  id: string;
  name: string;
  docs: readonly string[];
  /** Labelled where a doc was not re-read in the connect3 pass. */
  caveat?: string;
  steps: (ctx: McpCtx) => McpStep[];
  keyed?: McpKeyed;
  /** Only the `on` state has a host-specific sentence; the others are the shared CLI lines. */
  signInOn?: string;
}

export const MCP_MORE_HOSTS: readonly McpMoreHost[] = [
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    docs: ["https://geminicli.com/docs/tools/mcp-server/"],
    steps: (ctx) => [
      { text: "Run:", copy: geminiAdd(ctx.url), copyLabel: "the Gemini CLI add command", note: MCP_SERVER_ADDRESS_NOTE },
      { text: `Ask: \`${ASK_STATS}\`.` },
    ],
    keyed: cliKeyed(geminiAdd, "Restart the CLI"),
    signInOn: `\`/mcp auth ${MCP_SERVER_KEY}\` starts the sign-in.`,
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    docs: ["https://learn.chatgpt.com/docs/extend/mcp?surface=cli"],
    steps: (ctx) => [
      { text: "Run:", copy: codexAdd(ctx.url), copyLabel: "the Codex CLI add command", note: MCP_SERVER_ADDRESS_NOTE },
      { text: `Ask: \`${ASK_STATS}\`.` },
    ],
    keyed: {
      takesKey: true,
      title: "With a free key",
      steps: (ctx) => [
        { text: `Get a free key at ${MCP_MINT_PATH}; set it in your shell:`, copy: exportLine(ctx.key), copyLabel: "the export line", note: ctx.key ? undefined : PASTE_KEY_NOTE },
        { text: "Add this to your Codex config so it reads the variable:", copy: codexToml(ctx.url, true), copyLabel: "the Codex TOML block" },
      ],
    },
    signInOn: `\`codex mcp login ${MCP_SERVER_KEY}\` starts the sign-in.`,
  },
  {
    id: "cline",
    name: "Cline",
    docs: ["https://docs.cline.bot/mcp/configuring-mcp-servers"],
    steps: (ctx) => [
      { text: `In the **Remote Servers** tab: Server Name \`${MCP_SERVER_KEY}\`, Server URL (below), Transport **Streamable HTTP**, then **Add Server**.`, copy: ctx.url, copyLabel: "the server address", note: MCP_SERVER_ADDRESS_NOTE },
      { text: "Or the JSON block — in `~/.cline/mcp.json` for the Cline CLI; in the VS Code extension, open the **MCP Servers** panel, the **Configure** tab, then **Configure MCP Servers** and add it there:", copy: clineBlock(ctx.url), copyLabel: "the Cline JSON block" },
      { text: `Ask: \`${ASK_STATS}\`.` },
    ],
    keyed: {
      takesKey: true,
      title: "With a free key",
      steps: (ctx) => [
        { text: `Get a free key at ${MCP_MINT_PATH} and paste it in the field above; the block adds the header (your own config file, never a committed one):`, copy: ctx.key ? clineBlock(ctx.url, ctx.key) : clineBlock(ctx.url), copyLabel: "the keyed Cline JSON block", note: ctx.key ? undefined : PASTE_KEY_NOTE },
      ],
    },
  },
  {
    id: "zed",
    name: "Zed",
    docs: ["https://zed.dev/docs/ai/mcp"],
    // Zed prompts for sign-in whenever no Authorization header is set (its
    // doc); while the fact is on, the keyless block goes first and that
    // prompt completes; otherwise the prompt cannot finish, so the person
    // is sent to the keyed block below (the key is rendered there and
    // nowhere else).
    steps: (ctx) => [
      ctx.signIn === "on"
        ? { text: "Add this to your Zed settings. With no Authorization header set, Zed prompts you to sign in through the server's own flow the first time a tool needs your account:", copy: zedBlock(ctx.url), copyLabel: "the Zed context_servers block", note: MCP_SERVER_ADDRESS_NOTE }
        : { text: "Zed asks to sign in whenever no Authorization header is set; while that sign-in is not switched on (**Test the server** below tells you today's state), use a free key instead: the block under **With a free key** just below is the whole setup." },
      { text: `Ask: \`${ASK_STATS}\`.` },
    ],
    keyed: {
      takesKey: true,
      title: "With a free key",
      steps: (ctx) => [
        { text: `Get a free key at ${MCP_MINT_PATH}, paste it in the field above, then add this to your Zed settings:`, copy: ctx.key ? zedBlock(ctx.url, ctx.key) : zedBlock(ctx.url), copyLabel: "the keyed Zed block", note: ctx.key ? MCP_SERVER_ADDRESS_NOTE : `${PASTE_KEY_NOTE} ${MCP_SERVER_ADDRESS_NOTE}` },
      ],
    },
    signInOn: "With no Authorization header set, Zed prompts you to sign in through the server's own flow.",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    docs: ["https://docs.devin.ai/desktop/cascade/mcp"],
    steps: (ctx) => [
      { text: "Add this block to `~/.codeium/windsurf/mcp_config.json`. (Windsurf's document says this file configures the legacy Cascade agent only; the Devin Local agent, the default for new tabs, reads the Devin CLI config files instead.)", copy: windsurfBlock(ctx.url, false), copyLabel: "the Windsurf block", note: MCP_SERVER_ADDRESS_NOTE },
      { text: `Ask: \`${ASK_STATS}\`.` },
    ],
    keyed: {
      takesKey: true,
      title: "With a free key",
      steps: (ctx) => [
        { text: `Get a free key at ${MCP_MINT_PATH}; set it in your shell (the block reads the variable, so the key never sits in the file):`, copy: exportLine(ctx.key), copyLabel: "the export line", note: ctx.key ? undefined : PASTE_KEY_NOTE },
        { text: "Use this block instead:", copy: windsurfBlock(ctx.url, true), copyLabel: "the keyed Windsurf block" },
      ],
    },
  },
  {
    id: "any-client",
    name: "Any client / curl",
    docs: [],
    steps: (ctx) => [
      { text: "POST one JSON-RPC message per request to the address; this is the first one:", copy: curlInitialize(ctx.url), copyLabel: "the curl line" },
      { text: "With a key, send `Authorization: Bearer <key>` on each request." },
    ],
  },
  {
    id: "copy-the-prompt",
    name: "Copy the prompt",
    docs: [],
    steps: (ctx) => [
      {
        text: "For an agent that can install a server from prose, paste this:",
        copy: `Add the MCP server "${MCP_CONNECTOR_NAME}" at ${ctx.url} (Streamable HTTP, no key needed to start). Then ${ASK_STATS} and tell me how many jobs are open.`,
        copyLabel: "the prompt",
      },
    ],
  },
];

/** The hosts that show a key field: every host whose keyed block writes the key's value. */
export const hostTakesKey = (h: McpHost | McpMoreHost) => !!h.keyed?.takesKey;

/** The hosts a chooser offers by name (the board's "Which agent?"): every real app — "More…" is the switchboard's long-tail button, not an app a hand-off can name. */
export const MCP_CHOOSER_HOSTS: readonly McpHost[] = MCP_HOSTS.filter((h) => h.id !== "more");

/**
 * The inline marks in a step's text: **label** for a host-UI label as the
 * vendor prints it, `code` for something typed. One parser for the page
 * (React) and the prerender (HTML), so the two never disagree.
 */
export type StepSegment = { kind: "text" | "strong" | "code"; value: string };
export function stepSegments(text: string): StepSegment[] {
  const out: StepSegment[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "strong", value: m[1] } : { kind: "code", value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

/** The state-neutral sign-in sentence the prerender carries — true in every state. */
export const MCP_SIGN_IN_NEUTRAL =
  `Claude and ChatGPT have no field for a key. They sign you in instead — but only while the server's sign-in service is switched on. When it is off, a tool that needs your account answers in words (no Connect card), and ${anonNames()} still answer. Press **Test the server** on this page for today's state.`;

// ───────────────────────── IF IT DOES NOT WORK ────────────────────────────
//
// Symptom strings are the SERVER's own words (its error strings, pinned to
// the comment-stripped Deno source by which-agent-do-you-use.test.tsx) or a
// vendor's documented UI string (the doc named on the row). A row marked
// `since` quotes a server string that ships with that server version; the
// guard requires it present once the mirror's server source carries that
// version and absent before, so the row cannot quote a string the server
// does not send. `when` renders the row only in that sign-in state.

export interface TroubleRow {
  id: string;
  /** What the person sees; {{n}} placeholders are filled from the mirrors. */
  see: string;
  why: string;
  fix: string;
  source: { kind: "server"; pin: string; file: "index.ts" | "oauth.ts"; since?: string } | { kind: "vendor"; doc: string } | { kind: "symptom" };
  when?: SignInState;
}

export const MCP_TROUBLESHOOTING: readonly TroubleRow[] = [
  {
    id: "sign-in-off",
    see: "\"Sign-in through this server is not switched on yet, so this tool needs a key.\"",
    why: "The tool needs your account; sign-in from chat apps is off today.",
    fix: `Search, board statistics and full postings still work with no key. To use every tool, connect from ${andList(headerHostNames())} with a free key (${MCP_MINT_PATH}).`,
    source: { kind: "server", pin: "Sign-in through this server is not switched on yet, so this tool needs a key.", file: "index.ts", since: "2026-09-04.7" },
    when: "off",
  },
  {
    id: "connect-card",
    see: "Claude: a **Connect** card appears",
    why: "A tool needs your account.",
    fix: `Click it, sign in to ${MCP_CONNECTOR_NAME}, press **Allow**; Claude retries the call itself.`,
    source: { kind: "vendor", doc: "https://claude.com/docs/connectors/custom/remote-mcp" },
    when: "on",
  },
  {
    id: "claude-unreachable",
    see: "Claude: \"Couldn't reach the MCP server\" or \"Authorization with the MCP server failed\"",
    why: "The address was mistyped, `/mcp` was added to it, or (while sign-in is on) the sign-in could not finish.",
    fix: "Check the address is exactly `…/functions/v1/agent-mcp`; press **Test the server** on this page; if the test says sign-in is on and the card still fails, remove the connector and add it again with **Sign in when needed** + **Register automatically**.",
    source: { kind: "vendor", doc: "https://claude.com/docs/connectors/building/troubleshooting" },
  },
  {
    id: "claude-code-needs-auth",
    see: "Claude Code: `/mcp` shows `! Needs authentication`",
    why: "A tool that needs your account was called with no key, and the server asked for sign-in.",
    fix: `Type \`/mcp\` and follow the browser steps (2.1.186 or newer: \`claude mcp login ${MCP_SERVER_KEY}\`), or add a free key with \`--header\`.`,
    source: { kind: "vendor", doc: "https://code.claude.com/docs/en/mcp" },
    when: "on",
  },
  {
    id: "allowance-spent",
    see: `"The unkeyed allowance is spent — ${MCP_ANON_CAPS.perAddressPerDay} unkeyed calls a day from one address…"`,
    why: "Your network address used its free calls today; an office or a chat service counts as one address.",
    fix: `Get a free key at ${MCP_MINT_PATH} (${MCP_FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} calls a day, no account) and add it to your app. Resets at midnight UTC.`,
    source: { kind: "server", pin: "The unkeyed allowance is spent", file: "index.ts" },
  },
  {
    id: "key-not-recognised",
    see: "\"That key is not recognised.\"",
    why: "The key was cut off, or the header lacks `Bearer ` with the space.",
    fix: "The header must read `Authorization: Bearer rb_live_…`. A key is shown once; get a new one if lost (the old one stops working).",
    source: { kind: "server", pin: "That key is not recognised.", file: "index.ts" },
  },
  {
    id: "key-revoked",
    see: "\"This key has been revoked.\"",
    why: "A newer key was made for the same account or email; only the newest works.",
    fix: "Use the newest key, or make one more and update every app that holds the old one.",
    source: { kind: "server", pin: "This key has been revoked.", file: "index.ts" },
  },
  {
    id: "quota-used",
    see: `"Daily quota of ${MCP_FREE_KEY_DAILY_QUOTA.toLocaleString("en-US")} requests used."`,
    why: "The free key's day is spent.",
    fix: "Wait for midnight UTC; the unkeyed tools still answer; an Agent Pass raises the limit for its hours.",
    source: { kind: "server", pin: "Daily quota of", file: "index.ts" },
  },
  {
    id: "rate",
    see: "\"Over … requests/minute.\"",
    why: "Too many calls in one minute.",
    fix: "Wait one minute.",
    source: { kind: "server", pin: "requests/minute.", file: "index.ts" },
  },
  {
    id: "fit-paid",
    see: "\"fit_resume is a paid feature…\"",
    why: "Résumé fit scoring needs a paid key or a live Agent Pass.",
    fix: `${MCP_MINT_PATH} for a paid key, or /agents/pass — search keeps working.`,
    source: { kind: "server", pin: "fit_resume is a paid feature", file: "index.ts" },
  },
  {
    id: "apply-plan",
    see: "\"The apply agent needs an active Agent plan or a live pass.\"",
    why: "Applying is paid.",
    fix: "/agents/pass (sign in first) or /agent for the plan.",
    source: { kind: "server", pin: "The apply agent needs an active Agent plan or a live pass.", file: "index.ts" },
  },
  {
    id: "mandate",
    see: "\"No agent mandate on this account.\" / \"Your agent is switched off.\" / \"No resume on file\"",
    why: "The apply agent is not set up, is off, or has no CV.",
    fix: "Account → set up the apply agent (turn it on, choose countries and field, add the CV). The off switch always wins.",
    source: { kind: "server", pin: "No agent mandate on this account.", file: "index.ts" },
  },
  {
    id: "pass",
    see: "\"The pass on this account is not live.\" / \"No applications left on this pass.\"",
    why: "The pass ended or its applications are used.",
    fix: "Search keeps working; buy another pass when the clock ends.",
    source: { kind: "server", pin: "The pass on this account is not live.", file: "index.ts" },
  },
  {
    id: "job-id",
    see: "\"That is not a job id from this board.\"",
    why: "You passed a link or a title.",
    fix: "Use the id from a search, e.g. `greenhouse:acme:12345`; the id in a `/jobs?job=<id>` link is the same one.",
    source: { kind: "server", pin: "That is not a job id from this board.", file: "index.ts" },
  },
  {
    id: "browser",
    see: "Browser shows \"This is an MCP server for AI agents, not a web page…\"",
    why: "You opened the address like a web page.",
    fix: "Nothing is wrong. Paste it into your agent; the how-to is this page.",
    source: { kind: "server", pin: "This is an MCP server for AI agents, not a web page", file: "index.ts", since: "2026-09-04.7" },
  },
  {
    id: "zero-tools",
    see: "Cursor / VS Code / Cline: server listed, zero tools",
    why: "Wrong transport (Cline: not `sse`; VS Code: `\"type\": \"http\"`) or `/mcp` appended to the address.",
    fix: "The address ends in `/agent-mcp` exactly; the transport is HTTP (Cline: \"Streamable HTTP\").",
    source: { kind: "vendor", doc: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration" },
  },
  {
    id: "chatgpt-search-only",
    see: "ChatGPT only ever searches and fetches",
    why: `By design: ChatGPT's search calls \`search\` and \`fetch\`, ${MCP_ANON_CAPS.searchRows} results a page.`,
    fix: "For filters (pay, remote, seniority), use an app that calls `search_jobs`.",
    source: { kind: "vendor", doc: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt" },
  },
  {
    id: "401-curl",
    see: "\"Sign in to use this tool\" (HTTP 401) from a script or curl",
    why: "A tool that needs a key was called with none.",
    fix: `Send \`Authorization: Bearer <key>\` (free at ${MCP_MINT_PATH}), or call one of ${anonNames()}.`,
    source: { kind: "server", pin: "Sign in to use this tool", file: "oauth.ts" },
    when: "on",
  },
];

/** The rows to show for a state: unconditional rows plus the ones for that state (unknown shows the off rows — closed toward the in-band answer). */
export const troubleRowsFor = (state: SignInState) =>
  MCP_TROUBLESHOOTING.filter((r) => !r.when || r.when === (state === "unknown" ? "off" : state));

/**
 * THE ATTACH MENU, MIRRORED: the prompts and resources the server registers
 * beside its tools (agent-mcp 2026-09-04.7), one entry each, for every
 * surface that describes them. Pinned to the Deno registries — name, order,
 * count, title, URI, mime type and gate — by
 * src/test/the-attach-menu-lists-what-the-server-registers.test.ts, the
 * same mirror-constant pattern as MCP_TOOLS above. Never spell either count;
 * read `.length`.
 *
 * A prompt is an entry point a host lists (claude.ai's attach menu, Claude
 * Code's slash list, Cursor's panel — ChatGPT has none): its body on the
 * server is a function of the tool registry and names gates, never prices.
 * Listing and reading a prompt is free for every caller, keyed or not — a
 * prompt is never metered and never starts a pass.
 */
export interface McpPrompt {
  /** The `name` the server registers — what a host lists and calls. */
  name: string;
  /** The display title the server sends. */
  title: string;
  /** One sentence for a human reading the page. */
  body: string;
}

export const MCP_PROMPTS: readonly McpPrompt[] = [
  {
    name: "find_roles_for_my_cv",
    title: "Find roles that fit my CV",
    body: "Reads the occupation out of a CV, searches the live board without a key, then verifies the shortlist is still open — the one step that needs a key or a sign-in. Never invents a CV and never requests an application without a yes per job.",
  },
  {
    name: "apply_to_my_shortlist",
    title: "Apply to my shortlist",
    body: "Asks what this connection may do first (plan or pass, mandate, résumé on file, applications left), checks each job's hiring system, shows the cards, and requests one application per job only after the person confirms it.",
  },
  {
    name: "what_can_my_key_do",
    title: "What can this connection do right now",
    body: "One status call, explained in plain words: tier, calls left, whether the paid scorer and the apply tools would answer, and what would change each closed answer — the gate, never a price.",
  },
];

export const MCP_PROMPT_NAMES = MCP_PROMPTS.map((p) => p.name);

/**
 * A resource is a document a host can attach or @-mention (listed resources
 * only — no host documents surfacing templates, so the server declares none).
 * `keyed` mirrors the server's gate: false answers with no credential (the
 * statistics through the unkeyed tier, counted exactly as an unkeyed
 * board_stats call; the guide free), true needs a key or a sign-in. Reading
 * a keyed resource is metered like a tool.
 */
export interface McpResource {
  /** The URI the server registers — what a host reads. */
  uri: string;
  /** The short name the server lists it under. */
  name: string;
  title: string;
  mimeType: string;
  keyed: boolean;
  /** One sentence for a human reading the page. */
  body: string;
}

export const MCP_RESOURCES: readonly McpResource[] = [
  {
    uri: "resumebooster://guide",
    name: "guide",
    title: "How this board answers an agent",
    mimeType: "text/markdown",
    keyed: false,
    body: "The tiers, which tools answer unkeyed, how to verify a shortlist cheaply, and what the closure ledger can and cannot say — built from the tool registry at request time, so it cannot describe a tool the server does not have.",
  },
  {
    uri: "resumebooster://board/stats",
    name: "board-stats",
    title: "Board statistics (live cache)",
    mimeType: "application/json",
    keyed: false,
    body: "The same payload as board_stats: servable and tracked totals, open company boards, the category set, the freshness stamp.",
  },
  {
    uri: "resumebooster://me/key",
    name: "my-key",
    title: "This key's limits and powers",
    mimeType: "application/json",
    keyed: true,
    body: "The same payload as key_status: tier, calls left, which tools would answer, and the pass if the account holds one.",
  },
];

export const MCP_RESOURCE_URIS = MCP_RESOURCES.map((r) => r.uri);

/**
 * Every job card on search_jobs and get_jobs also carries a resource link
 * under this prefix plus the job id — a URI resources/read resolves to the
 * posting (unkeyed, through the fetch alias's allowance; keyed, metered).
 * No copy may claim a host renders the link: host rendering is undocumented.
 */
export const MCP_JOB_RESOURCE_PREFIX = "resumebooster://job/";
