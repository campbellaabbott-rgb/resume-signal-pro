// "TEST THE SERVER" — the connection test the /agents page runs on a click.
//
// A manual button, never auto-run: a crawler that executes scripts would
// spend the visitor's shared address allowance for nothing. It sends four
// JSON-RPC messages from the browser's own origin (the server's CORS allows
// POST from any origin with the mcp-protocol-version header, measured
// 2026-09-16): initialize, tools/list and prompts/list, which are free and
// unmetered, then ONE unkeyed search_jobs, which is counted against the
// visitor's address — the page says so beside the button. It prints the
// answer in words, every number read off the responses and the mirrors,
// including today's sign-in state, which it reads from the initialize
// result's _meta field and from nowhere else (connect3 spec §2.2: the page
// never derives that fact a second way).
//
// Pure functions over an injected fetch, so the guard can exercise every
// branch with a stubbed server and never by regex.

import {
  MCP_ANON_CAPS, MCP_PROTOCOL_VERSION, MCP_TEST_QUERY, MCP_SIGN_IN_META_KEY, MCP_HOSTS, MCP_PAGE_HOSTS, readSignInFact,
  andList, MCP_ANON_TOOL_NAMES, type SignInFact, type SignInState,
} from "@/config/mcp-tools";

/**
 * THE SERVER ADDRESS, defined once beside the client that calls it. Same
 * convention as DataApi's API_BASE: read the env the client is built with,
 * so the documented URL cannot drift from the project serving it. The page
 * re-exports it; the prerender reads the same env variable itself.
 */
export const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-mcp`;

/**
 * The hosts that sign a person in (no key field) — the server's fact is
 * about all of them, so the full table — and the key-carrying hosts the
 * sentence tells the person to connect FROM: only the page's tiles, never a
 * host the page sends to GitHub. Read off the host mirror, never typed.
 */
const chatHosts = () => andList(MCP_HOSTS.filter((h) => !h.header).map((h) => h.name));
const keyHosts = () => andList(MCP_PAGE_HOSTS.filter((h) => h.header).map((h) => h.name));

export interface McpTestReport {
  /** Whether initialize answered at all; the sentence below explains either way. */
  reached: boolean;
  /** HTTP status of initialize, or null when nothing came back. */
  status: number | null;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  promptCount: number | null;
  signIn: SignInFact;
  /** The search: rows returned (asked for MCP_ANON_CAPS.searchRows) and the allowance left, or the server's own refusal. */
  search:
    | { ok: true; rows: number; left: number | null; ipCap: number | null; globalLeft: number | null }
    | { ok: false; error: string; fix: string | null }
    | null;
  /** A JSON-RPC error message from any of the four calls. */
  rpcError: string | null;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface RpcAnswer {
  status: number;
  headers: Headers;
  body: { result?: Record<string, unknown>; error?: { message?: string } } | null;
}

async function rpc(fetchImpl: Fetch, url: string, method: string, params: unknown, id: number): Promise<RpcAnswer> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  let body: RpcAnswer["body"] = null;
  try { body = (await res.json()) as RpcAnswer["body"]; } catch { body = null; }
  return { status: res.status, headers: res.headers, body };
}

/** The text of a tool result's first text block, parsed as JSON when it is. */
function toolPayload(result: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const content = result?.content as Array<{ type?: string; text?: string }> | undefined;
  const text = content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { text }; }
}

/**
 * Run the four calls. Never throws: a network fault is a report with
 * `reached: false`, and the sentence builder says what that means.
 */
export async function runServerTest(url: string, fetchImpl: Fetch = (i, init) => fetch(i, init)): Promise<McpTestReport> {
  const report: McpTestReport = {
    reached: false, status: null, serverName: null, serverVersion: null, toolCount: null, promptCount: null,
    signIn: readSignInFact(null), search: null, rpcError: null,
  };
  let init: RpcAnswer;
  try {
    init = await rpc(fetchImpl, url, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "resumebooster.work/agents", version: "1" },
    }, 1);
  } catch {
    return report;
  }
  report.status = init.status;
  if (!init.body?.result) {
    report.rpcError = init.body?.error?.message ?? null;
    return report;
  }
  report.reached = true;
  const info = init.body.result.serverInfo as { name?: string; version?: string } | undefined;
  report.serverName = info?.name ?? null;
  report.serverVersion = info?.version ?? null;
  // The ONE place the page learns the sign-in state: the initialize result's
  // _meta field, keyed by the shared constant; anything else reads as unknown.
  report.signIn = readSignInFact(init.body.result);

  try {
    const tools = await rpc(fetchImpl, url, "tools/list", {}, 2);
    const list = tools.body?.result?.tools;
    report.toolCount = Array.isArray(list) ? list.length : null;
    if (tools.body?.error?.message) report.rpcError = tools.body.error.message;
    const prompts = await rpc(fetchImpl, url, "prompts/list", {}, 3);
    const plist = prompts.body?.result?.prompts;
    report.promptCount = Array.isArray(plist) ? plist.length : null;
    if (prompts.body?.error?.message) report.rpcError = prompts.body.error.message;
  } catch { /* the counts stay null; the sentence says what it knows */ }

  // The one metered call. It asks for the unkeyed maximum, sent explicitly
  // so the request body says what it asked for: the meter counts the call
  // before any runner runs and the server clamps the limit, so the cost is
  // the same as asking for one, and the answer shows what an unkeyed search
  // from a chat host returns (a bare "1 result" beside the hero's hundreds
  // of thousands read as a broken search).
  try {
    const search = await rpc(fetchImpl, url, "tools/call", { name: "search_jobs", arguments: { query: MCP_TEST_QUERY, limit: MCP_ANON_CAPS.searchRows } }, 4);
    if (search.body?.error?.message) {
      report.rpcError = search.body.error.message;
    } else {
      const result = search.body?.result;
      const payload = toolPayload(result);
      if (result?.isError) {
        report.search = { ok: false, error: String(payload?.error ?? payload?.text ?? "refused"), fix: payload?.fix ? String(payload.fix) : null };
      } else {
        const jobs = payload?.jobs;
        const unkeyed = payload?.unkeyed as { callsLeftToday?: number; ipCap?: number; globalLeftToday?: number } | undefined;
        // The sentence's denominator is the address cap, so its numerator is
        // the payload's ADDRESS figure; the header carries whichever bucket
        // binds first (address or world) and is only the fallback. The world's
        // figure, when it is the tighter one, gets its own clause.
        const header = search.headers.get("X-Unkeyed-Remaining");
        const fromHeader = header !== null && header !== "" && Number.isFinite(Number(header)) ? Number(header) : null;
        const left = typeof unkeyed?.callsLeftToday === "number" ? unkeyed.callsLeftToday : fromHeader;
        const globalLeft = typeof unkeyed?.globalLeftToday === "number" ? unkeyed.globalLeftToday : null;
        report.search = { ok: true, rows: Array.isArray(jobs) ? jobs.length : 0, left, ipCap: typeof unkeyed?.ipCap === "number" ? unkeyed.ipCap : null, globalLeft };
      }
    }
  } catch { /* the search stays null */ }
  return report;
}

/**
 * The silent read a host panel makes when it opens: one initialize (free,
 * unmetered) and the fact off its result. Never throws; a fault is unknown.
 */
export async function readSignInFromServer(url: string, fetchImpl: Fetch = (i, init) => fetch(i, init)): Promise<SignInFact> {
  try {
    const init = await rpc(fetchImpl, url, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "resumebooster.work/agents", version: "1" },
    }, 1);
    return readSignInFact(init.body?.result ?? null);
  } catch {
    return readSignInFact(null);
  }
}

/** The sign-in clause of the sentence, by state — the only branch the page takes on the fact. */
export function signInLine(state: SignInState, checkedAt: string | null): string {
  switch (state) {
    case "on":
      return "switched on — those apps show a Connect card when a tool needs your account.";
    case "off":
      return `not available yet — from those apps only ${andList(MCP_ANON_TOOL_NAMES)} answer, and the server says so in words instead of showing a card. To use everything, connect from ${keyHosts()} with a free key.`;
    default:
      return `could not be checked just now${checkedAt ? ` (the server's last check was ${checkedAt})` : ""}; try again in a minute.`;
  }
}

/** The report, in words. Every number comes from the report or the mirrors. */
export function describeTest(r: McpTestReport): string {
  if (!r.reached) {
    const what = r.rpcError ? r.rpcError : r.status ? `HTTP ${r.status}` : "no response";
    return `Could not reach the server from this browser: ${what}. Your agent may still reach it — try step 1 for your app, or check the troubleshooting list below.`;
  }
  const head = `The server answered: ${r.serverName ?? "unnamed"}, version ${r.serverVersion ?? "unknown"} — ${r.toolCount ?? "?"} tools, ${r.promptCount ?? "?"} prompts.`;
  let searchLine: string;
  if (r.search?.ok) {
    const left = r.search.left !== null ? `${r.search.left} of ${r.search.ipCap ?? MCP_ANON_CAPS.perAddressPerDay}` : "an unknown number of";
    const world = r.search.left !== null && r.search.globalLeft !== null && r.search.globalLeft < r.search.left ? ` (${r.search.globalLeft} across every unkeyed caller — that number binds first)` : "";
    searchLine = `Search works with no key: asked for the ${MCP_ANON_CAPS.searchRows} results an unkeyed search allows for "${MCP_TEST_QUERY}" and got ${r.search.rows}; ${left} free calls left today from your network address${world}.`;
  } else if (r.search && r.search.ok === false) {
    const refused = r.search;
    searchLine = `The search was refused: ${refused.error}${refused.fix ? ` ${refused.fix}` : ""}`;
  } else if (r.rpcError) {
    searchLine = `The search did not run: ${r.rpcError}.`;
  } else {
    searchLine = "The search did not answer.";
  }
  return `${head} ${searchLine} Sign-in for ${chatHosts()}: ${signInLine(r.signIn.state, r.signIn.checkedAt)}`;
}

export { MCP_SIGN_IN_META_KEY };
