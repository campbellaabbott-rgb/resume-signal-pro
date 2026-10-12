// THE BOARD HANDS ITSELF TO THE AGENT.
//
// Two things a person on /jobs already holds — a posting and a search — and
// nothing on the page that turns either into something their own agent can
// act on. The Share control copies a URL for humans; an agent handed that
// URL learns nothing from it (the detail is injected after hydration) and
// nothing anywhere told it that the `job=` value IS the argument to get_job.
// These builders produce the sentence the person pastes instead: it names
// the MCP server by URL, the tool to call first, and the job id verbatim.
//
// RULES THIS FILE KEEPS, each pinned by
// src/test/the-board-hands-a-job-and-a-search-to-the-agent.test.tsx:
//   - every tool name in a prompt goes through tool(), which refuses a name
//     the mirror does not register — a prompt naming a tool the server lacks
//     is the claim-drift defect in a new coat (project_claim_drift);
//   - the prompt carries the job id verbatim, the MCP URL, and never a key;
//   - toSearchJobsArgs() emits only keys the server's SEARCH_PROPERTIES
//     declares (read from the Deno file by the guard), so the agent is handed
//     arguments search_jobs will honour rather than a copy of the board's
//     own request body;
//   - the prompts are agent-facing English, deliberately NOT i18n — the
//     agent reads them, the person only carries them.
//
// A deep link is offered for ONE vendor only, where the format is published:
// claude://claude.ai/new?q=<prompt> prefills (never auto-sends) a Claude
// Desktop conversation, and claude://code/new?q=<prompt> does the same for
// Claude Code (support.claude.com/en/articles/14729294; ~14,000-character
// cap, far above these prompts). Nothing else is deep-linked: a ChatGPT ?q=
// prefill has no official document and Cursor's deep link installs a server
// rather than opening a prompt. The link is rendered only after the person
// has said which agent they use, because a claude:// URL with no app behind
// it has no documented fallback.
import { MCP_PAGE_HOSTS, MCP_TOOL_NAMES, MCP_ADD_TO_CLAUDE_LIVE, claudeInstallLink } from "@/config/mcp-tools";
import { MCP_URL } from "@/lib/mcp-test";

/**
 * Where the browser remembers which agent the person uses. Spelled ONCE, here:
 * the receipt page (/agents/pass), the switchboard (/agents) and the board all
 * read and write it through the two functions below, so a buyer who chose a
 * host on the receipt is not asked again on the board — and what counts as a
 * page host is decided in one place. The board guard fails any page that
 * spells the key or reads the storage itself.
 */
export const HOST_STORAGE_KEY = "rb_pass_host";

/**
 * The host the browser remembers, or the first tile. Never throws. Resolves
 * ONLY to a page host: a name the page has no tile for (a host the table
 * carries for the README, or a pick from before the tiles were cut to the
 * owner's three) reads as no pick, never as a host the page cannot show.
 */
export function rememberedHostName(): string {
  return rememberedHostChoice() ?? MCP_PAGE_HOSTS[0].name;
}

/** The host the browser remembers, or null when it remembers none — or none the page has a tile for (the switchboard opens no panel on a mere default). Never throws. */
export function rememberedHostChoice(): string | null {
  try {
    const v = localStorage.getItem(HOST_STORAGE_KEY);
    if (v && MCP_PAGE_HOSTS.some((h) => h.name === v)) return v;
  } catch { /* storage blocked */ }
  return null;
}

/** Remember the pick for the next hand-off. Never throws. */
export function rememberHostName(name: string): void {
  try { localStorage.setItem(HOST_STORAGE_KEY, name); } catch { /* per-browser convenience only */ }
}

/**
 * A tool name, and proof it exists. The mirror is pinned to the server's
 * registration by the-page-says-six guard, so a name that passes here is a
 * name the server answers to today; a name that does not throws at build
 * time in the test that renders every prompt, never in a visitor's browser.
 */
export function tool(name: string): string {
  if (!MCP_TOOL_NAMES.includes(name)) throw new Error(`agent-handoff names a tool the mirror does not register: ${name}`);
  return name;
}

export interface HandoffJob {
  /** The board's posting id — `source:token:externalId` — passed verbatim. */
  id: string;
  /**
   * Whether the retired apply agent's adapter covered this posting's vendor.
   * IGNORED since the apply pivot (owner decision 2026-10-11): the apply
   * agent is switched off, so no posting is "sendable" and every prompt is
   * the same. Kept on the type so the board's call sites compile unchanged.
   */
  sendable?: boolean;
}

/**
 * The one-line prompt for a posting. It opens with a tool that answers with
 * NO key (the fetch alias — get_job needs a key or a sign-in, and a prompt
 * whose first call walls the person is the wall in a new coat), shows the
 * posting, then asks for the employer's own apply link and what the posting
 * asks applicants for — and says the person applies themselves. It names no
 * apply-agent tool and asks nothing to be sent: the server-side apply agent
 * is switched off, and applying yourself is the only apply path (connect
 * spec D1). The guard asserts the FIRST tool each prompt names is in the
 * unkeyed set, and that no prompt names a dormant apply tool.
 */
export function agentPrompt(job: HandoffJob): string {
  return (
    `Using the resumebooster MCP server (${MCP_URL}), call ${tool("fetch")} with job id "${job.id}" and show me the posting; ` +
    "then give me the employer's apply link and list what the posting asks applicants for. I will apply myself, on the employer's site."
  );
}

/**
 * The one-click install link for a host, or null. Only Claude documents
 * one (claude.ai/customize/connectors?modal=add-custom-connector&…), and
 * only while MCP_ADD_TO_CLAUDE_LIVE is on — the owner's check of that link
 * comes first, because Claude's authentication choice cannot be changed
 * after a connector is added. `live` is a parameter so the guard can render
 * both states; every caller leaves it to the flag.
 */
export function installLinkFor(hostName: string, live: boolean = MCP_ADD_TO_CLAUDE_LIVE): string | null {
  return live && hostName === "Claude" ? claudeInstallLink(MCP_URL) : null;
}

/**
 * The deep link per host, keyed by the host's NAME in MCP_HOSTS so a renamed
 * host loses its link loudly (the guard checks every key here is a name the
 * mirror carries) rather than silently. Only the two documented schemes.
 */
const DEEP_LINK_BY_HOST: Readonly<Record<string, (prompt: string) => string>> = {
  "Claude": (p) => `claude://claude.ai/new?q=${encodeURIComponent(p)}`,
  "Claude Code": (p) => `claude://code/new?q=${encodeURIComponent(p)}`,
};

/** The names a deep link exists for — what the chooser can offer a button to. */
export const DEEP_LINK_HOST_NAMES: readonly string[] = Object.keys(DEEP_LINK_BY_HOST);

/** A prefilled-conversation link for this host, or null where none is documented. */
export function agentDeepLink(hostName: string, prompt: string): string | null {
  const build = DEEP_LINK_BY_HOST[hostName];
  return build ? build(prompt) : null;
}

/**
 * THE THREE RENAMES AND THE TWO DROPS between the board's own request body
 * (boardFilterBody in Jobs.tsx) and the server's search_jobs arguments.
 * Everything else travels under its own name; `companies` is the board's
 * array and the server's comma list, so it is joined.
 */
export const SEARCH_ARG_RENAMES: Readonly<Record<string, string>> = {
  q: "query",
  salaryFloor: "salaryMin",
  salaryCeiling: "salaryMax",
};
/**
 * Board keys with no search_jobs argument. includeUncategorised WIDENS a
 * category, and the server has no such switch. sendableOnly was the board's
 * "agent-ready" filter, the postings the server-side apply agent could send
 * to: that agent is retired (owner decision 2026-10-11), the server no longer
 * declares agentReadyOnly, and a hand-off must carry only arguments the server
 * declares.
 */
export const SEARCH_ARG_DROPS: readonly string[] = ["includeUncategorised", "sendableOnly"];

export type SearchSort = "relevance" | "newest" | "salary";

/**
 * The board's request body → the arguments search_jobs takes. Pure, so the
 * guard can CALL it on a filter state and compare the key set to the Deno
 * file's SEARCH_PROPERTIES rather than grep for a mapping table.
 *
 * `sort` is passed beside the body because the board carries it outside its
 * filter state, and the order the person is looking at is part of what they
 * are handing over — a search sent without it would disagree with the
 * control on screen (state-and-request-cannot-disagree).
 */
export function toSearchJobsArgs(body: Record<string, unknown>, sort?: SearchSort): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null || SEARCH_ARG_DROPS.includes(k)) continue;
    const name = SEARCH_ARG_RENAMES[k] ?? k;
    out[name] = Array.isArray(v) ? v.join(",") : v;
  }
  if (sort) out.sort = sort;
  return out;
}

/**
 * The prompt for a search. `activelyHiring` is the board's one client-side
 * filter (applied in the browser, never sent), so the prompt says it is not
 * included rather than letting the agent believe the arguments are the
 * whole of what the person was looking at.
 */
export function searchPrompt(args: Record<string, unknown>, opts: { activelyHiring?: boolean } = {}): string {
  const head =
    `Using the resumebooster MCP server (${MCP_URL}), call ${tool("search_jobs")} with ${JSON.stringify(args)} ` +
    "and show me the top results, each with the employer's apply link.";
  return opts.activelyHiring
    ? `${head} The board's "Actively hiring" filter is applied in the browser, not by ${tool("search_jobs")}, so it is not included here.`
    : head;
}

/**
 * Copy text to the clipboard, with the legacy path for contexts where the
 * Clipboard API is absent (an embedded preview). Resolves to whether it
 * worked; never throws. The same two paths the Share control walks.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
