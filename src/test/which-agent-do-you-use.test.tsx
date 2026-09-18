// WHICH AGENT DO YOU USE? — the switchboard's guards (connect3 spec §9: G3,
// G4, G5, G8, G9, G10, G12).
//
// WHAT HAPPENED. /agents told a person with Claude to "choose Sign in when
// needed" while the server's sign-in service was switched off, so the first
// tool that needed an account dead-ended in a card that could not finish;
// the page rendered that sentence from a host-table FLAG, not from anything
// the server said. The same page put `rb_live_...your key...` inside an
// Authorization value in every block, sent a Cursor user a link that could
// carry a key, opened with a transport and a status code, and listed steps
// for no host in particular. The board's hand-off prompt opened with
// get_job, a tool that needs a key, so the prompt's first call was the wall.
//
// WHAT THIS FILE PINS, each on BEHAVIOUR — the builders are called, the
// links decoded, the page mounted, the prerender block executed — never on
// a regex over prose:
//
//   G3  the sign-in fact's key is spelled once in Deno (as-probe.ts) and once
//       here, and the page's test client branches on `state` alone;
//   G4  no placeholder ever sits inside an Authorization value: every block
//       rendered with no key carries none, with a key carries it exactly
//       where the host takes it, and every deep link decodes to the address
//       and nothing else;
//   G5  the troubleshooting rows are the server's own strings — each server
//       row's symptom is a substring of the comment-stripped Deno source
//       (a row whose string ships with a later server version is required
//       ABSENT until the source carries that version, so no row can quote a
//       string the server does not send); every vendor row names its doc;
//   G8  the table keeps every host in the owner's order; the TILES are the
//       owner's three (Claude, ChatGPT, Claude Code — "we're not trying to
//       have people develop", 2026-09-18) and nothing else, with one line
//       under them sending every other host to the install repo on GitHub,
//       its names and its link off the mirror; no host's first step names
//       the jargon a newcomer should never meet; the prerender block,
//       EXECUTED, writes every tile's first step and no other host's, the
//       same GitHub line, and the reach disclosure over the whole table;
//   G9  the two clicks send what they name — agents_host_pick {host} and
//       agents_test_server {host, state} — judged by the JSON that leaves
//       the browser, fetch hooked before the mount;
//   G10 the hand-off prompts' FIRST tool answers with no key;
//   G12 /mcp is a route, prerendered with noindex, titled as not-the-server,
//       and in no sitemap.
//
// TEETH: each property is proven to fail on a mutated copy at the end.
//
// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/agents" }
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
// Line comments first — a line comment holding `/*` would otherwise open a
// block that the block strip runs to the next `*/`.
const strip = (s: string) =>
  s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stubTable(),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }), safeNextPath: (s: string) => s }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit", "in"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
  return th;
}

import {
  MCP_HOSTS, MCP_MORE_HOSTS, MCP_HOST_IDS, MCP_PAGE_HOSTS, MCP_PAGE_HOST_IDS, MCP_OFF_PAGE_HOSTS, MCP_OTHER_AGENTS_LINE,
  MCP_OTHER_AGENTS_TEXT, MCP_COPY_THE_PROMPT, MCP_INSTALL_REPO_URL, MCP_CHOOSER_HOSTS,
  MCP_SIGN_IN_META_KEY, MCP_TROUBLESHOOTING, MCP_ANON_TOOL_NAMES, MCP_ANON_CAPS, MCP_TEST_QUERY,
  MCP_TOOL_NAMES, MCP_KEY_ENV, MCP_SERVER_INFO_NAME, readSignInFact, troubleRowsFor, type McpStep, type SignInState,
} from "../config/mcp-tools";
import { MCP_URL, runServerTest, describeTest, readSignInFromServer } from "../lib/mcp-test";
import { agentPrompt, searchPrompt } from "../lib/agent-handoff";
import AgentConnect from "../pages/AgentConnect";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const KEY = "rb_live_0123456789abcdef0123456789abcdef";
const URL = "https://example.invalid/functions/v1/agent-mcp";

/**
 * What the test's search clause must say, as a pure function of the
 * sentence and the number of rows the server answered: the number asked for
 * (the mirror's unkeyed maximum — never a bare "one" beside the hero's
 * hundreds of thousands), the number that came back (the response's), and
 * no count printed as "N result(s)", which reads as the search's yield.
 */
const searchClauseOffences = (sentence: string, rows: number): string[] => {
  const out: string[] = [];
  if (!sentence.includes(`asked for the ${MCP_ANON_CAPS.searchRows} results`)) out.push("does not say how many results were asked for");
  if (!new RegExp(`\\bgot ${rows}\\b`).test(sentence)) out.push(`does not say ${rows} came back`);
  if (/\b\d+ result\(s\)/.test(sentence)) out.push("prints a bare count as if it were the search's yield");
  return out;
};

// ───────────────────────── G3: one key, one branch ──────────────────────────

describe("G3: the sign-in fact's key is spelled once per runtime, and the page branches on state only", () => {
  const PROBE = strip(read("supabase/functions/agent-mcp/as-probe.ts"));
  it("the Deno probe's SIGN_IN_META_KEY equals the mirror's MCP_SIGN_IN_META_KEY", () => {
    const m = /export const SIGN_IN_META_KEY = "([^"]+)"/.exec(PROBE);
    expect(m, "as-probe.ts no longer exports SIGN_IN_META_KEY as a string literal").toBeTruthy();
    expect(MCP_SIGN_IN_META_KEY).toBe(m![1]);
    // A reverse-DNS key outside the prefixes the MCP spec reserves.
    expect(MCP_SIGN_IN_META_KEY).toMatch(/^[a-z]+\.[a-z]+\/[a-z-]+$/);
    expect(MCP_SIGN_IN_META_KEY).not.toMatch(/^(mcp|modelcontextprotocol)/);
  });
  it("the server's initialize handler carries the fact under that key", () => {
    const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
    expect(MCP).toMatch(/_meta:\s*\{\s*\[SIGN_IN_META_KEY\]:/);
  });
  /** The name the Deno SERVER_INFO block declares, read the way the version pin reads it. */
  const serverInfoNameOf = (code: string): string => {
    const block = /const SERVER_INFO = \{([\s\S]*?)\n\};/.exec(code)?.[1] ?? "";
    const m = /\bname: "([^"]+)"/.exec(block);
    if (!m) throw new Error("index.ts no longer declares SERVER_INFO.name as a string literal");
    return m[1];
  };
  it("the page's MCP_SERVER_INFO_NAME is the Deno SERVER_INFO.name, and the verify line that names it interpolates the constant", () => {
    const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
    expect(serverInfoNameOf(MCP)).toBe(MCP_SERVER_INFO_NAME);
    const more = MCP_HOSTS.find((h) => h.id === "more")!;
    expect(more.verify).toContain(`\`${MCP_SERVER_INFO_NAME}\``);
    // The name is spelled once on the page side: nowhere in the config but the constant.
    const cfg = strip(read("src/config/mcp-tools.ts"));
    expect(cfg.split(MCP_SERVER_INFO_NAME).length - 1).toBe(1);
    // Teeth: a renamed server parts from the constant.
    const renamed = MCP.replace(`name: "${MCP_SERVER_INFO_NAME}"`, 'name: "resumebooster-jobs"');
    expect(renamed).not.toBe(MCP);
    expect(serverInfoNameOf(renamed)).not.toBe(MCP_SERVER_INFO_NAME);
  });
  it("readSignInFact reads state under the key and answers unknown for anything else", () => {
    const fact = (state: unknown) => readSignInFact({ _meta: { [MCP_SIGN_IN_META_KEY]: { state, checkedAt: "2026-09-16T22:00:00Z", authorizationServer: "https://x/auth/v1", reason: "feature_disabled" } } });
    expect(fact("on").state).toBe("on");
    expect(fact("off")).toEqual({ state: "off", checkedAt: "2026-09-16T22:00:00Z", authorizationServer: "https://x/auth/v1", reason: "feature_disabled" });
    expect(fact("maybe").state).toBe("unknown");
    expect(readSignInFact({ _meta: { "other/key": { state: "on" } } }).state).toBe("unknown");
    expect(readSignInFact(null).state).toBe("unknown");
    expect(readSignInFact({}).state).toBe("unknown");
  });
  /**
   * A "server" that answers the four messages; the search answers `rows`
   * postings — the unkeyed maximum unless a case says otherwise.
   */
  const answers = (state: string, extra: Record<string, unknown> = {}, rows: number = MCP_ANON_CAPS.searchRows) => async (_u: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body)) as { method: string };
    const result =
      method === "initialize" ? { serverInfo: { name: "resumebooster-job-board", version: "t" }, _meta: { [MCP_SIGN_IN_META_KEY]: { state, ...extra } } }
      : method === "tools/list" ? { tools: [{}, {}, {}] }
      : method === "prompts/list" ? { prompts: [{}] }
      : { content: [{ type: "text", text: JSON.stringify({ jobs: Array.from({ length: rows }, () => ({})), unkeyed: { callsLeftToday: 24, ipCap: MCP_ANON_CAPS.perAddressPerDay } }) }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "X-Unkeyed-Remaining": "24" } });
  };
  it("the test client reads the fact off initialize and branches on state only — every other field leaves the sentence unchanged", async () => {
    const on = describeTest(await runServerTest(URL, answers("on", { reason: null })));
    const onOtherReason = describeTest(await runServerTest(URL, answers("on", { reason: "anything", authorizationServer: "https://elsewhere" })));
    const off = describeTest(await runServerTest(URL, answers("off", { reason: "feature_disabled" })));
    const unknown = describeTest(await runServerTest(URL, answers("unknown", { checkedAt: "2026-09-16T22:41:03Z" })));
    expect(on).toBe(onOtherReason);
    expect(on).toMatch(/switched on/);
    expect(off).toMatch(/not available yet/);
    for (const n of MCP_ANON_TOOL_NAMES) expect(off).toContain(n);
    // "connect from …": the key-carrying TILES, never a host the page sends to GitHub.
    for (const h of MCP_PAGE_HOSTS.filter((x) => x.header)) expect(off).toContain(h.name);
    for (const h of MCP_OFF_PAGE_HOSTS) expect(off, `${h.name} is not a tile`).not.toContain(h.name);
    expect(unknown).toMatch(/could not be checked just now \(the server's last check was 2026-09-16T22:41:03Z\)/);
    // The numbers in the sentence are the responses', never typed.
    expect(on).toContain("3 tools, 1 prompts");
    expect(on).toContain(`24 of ${MCP_ANON_CAPS.perAddressPerDay} free calls left today`);
    expect(on).toContain("resumebooster-job-board, version t");
    expect(searchClauseOffences(on, MCP_ANON_CAPS.searchRows)).toEqual([]);
    // The silent read a panel makes is the same read.
    expect((await readSignInFromServer(URL, answers("off"))).state).toBe("off");
  });
  it("the search asks for the unkeyed maximum by the mirror's name and the sentence says what was asked and what came back — the count is the response's, never a typed digit", async () => {
    // WHAT HAPPENED: the button asked for ONE row and printed "1 result(s)
    // for nurse" beside a hero that says 700,000+ and a panel that says an
    // unkeyed search shows ten; a visitor read a working search as a broken
    // one. Asking for the maximum costs the same one metered call (the
    // meter counts before any runner runs; the server clamps the limit).
    const sent: Array<{ name?: string; arguments?: Record<string, unknown> }> = [];
    const spy = (rows: number) => async (u: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body)) as { method: string; params: { name?: string; arguments?: Record<string, unknown> } };
      if (method === "tools/call") sent.push(params);
      return answers("on", {}, rows)(u, init);
    };
    const full = describeTest(await runServerTest(URL, spy(MCP_ANON_CAPS.searchRows)));
    expect(sent).toEqual([{ name: "search_jobs", arguments: { query: MCP_TEST_QUERY, limit: MCP_ANON_CAPS.searchRows } }]);
    expect(full).toContain(`asked for the ${MCP_ANON_CAPS.searchRows} results`);
    expect(full).toContain(`got ${MCP_ANON_CAPS.searchRows};`);
    expect(searchClauseOffences(full, MCP_ANON_CAPS.searchRows)).toEqual([]);
    // Fewer rows than asked for print as what came back, and the property
    // knows the difference between the two numbers.
    const three = describeTest(await runServerTest(URL, spy(3)));
    expect(three).toMatch(/got 3;/);
    expect(searchClauseOffences(three, 3)).toEqual([]);
    expect(searchClauseOffences(three, MCP_ANON_CAPS.searchRows)).toEqual([`does not say ${MCP_ANON_CAPS.searchRows} came back`]);
    // The limit is the mirror's constant in the source: no digit typed.
    const src = strip(read("src/lib/mcp-test.ts"));
    expect(src).toMatch(/limit: MCP_ANON_CAPS\.searchRows/);
    expect(src).not.toMatch(/limit:\s*\d/);
  });
  it("teeth: the pre-fix sentence, a bare count printed as the search's yield, fails the property", () => {
    const old = `Search works with no key: 1 result(s) for "${MCP_TEST_QUERY}", 24 of ${MCP_ANON_CAPS.perAddressPerDay} free calls left today from your network address. Sign-in for Claude and ChatGPT: switched on.`;
    expect(searchClauseOffences(old, 1)).toEqual([
      "does not say how many results were asked for",
      "does not say 1 came back",
      "prints a bare count as if it were the search's yield",
    ]);
    // A copy that asks for one row and says so still fails: the number asked for is the unkeyed maximum, off the mirror.
    const one = `Search works with no key: asked for the 1 results an unkeyed search allows for "${MCP_TEST_QUERY}" and got 1; 24 free calls left today.`;
    expect(searchClauseOffences(one, 1)).toContain("does not say how many results were asked for");
    // A source copy with the digit typed back in fails.
    const src = strip(read("src/lib/mcp-test.ts")).replace("limit: MCP_ANON_CAPS.searchRows", "limit: 1");
    expect(src).toMatch(/limit:\s*\d/);
  });
  it("a server with no _meta (an older version) reads as unknown, a refusal is printed in the server's own words, and a dead server is said so", async () => {
    const noMeta = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "x", version: "v" }, tools: [], prompts: [] } }), { status: 200 });
    const r = await runServerTest(URL, noMeta);
    expect(r.reached).toBe(true);
    expect(r.signIn.state).toBe("unknown");
    const refused = async (_u: string, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body)) as { method: string };
      const result = method === "tools/call"
        ? { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "The unkeyed allowance is spent — from the server", fix: "Get a free key — from the server" }) }] }
        : { serverInfo: { name: "x", version: "v" }, tools: [], prompts: [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    };
    expect(describeTest(await runServerTest(URL, refused))).toMatch(/The search was refused: The unkeyed allowance is spent — from the server Get a free key — from the server/);
    const dead = async () => { throw new TypeError("network"); };
    expect(describeTest(await runServerTest(URL, dead))).toMatch(/Could not reach the server from this browser: no response/);
    const http500 = async () => new Response("nope", { status: 500 });
    expect(describeTest(await runServerTest(URL, http500))).toMatch(/Could not reach the server from this browser: HTTP 500/);
  });
});

// ───────────────────────── G4: no placeholder in an Authorization value ─────

/** Every rendered string of a host's blocks, keyless and keyed. */
const allSteps = (steps: McpStep[]) => steps.flatMap((s) => [s.text, s.copy ?? "", s.note ?? ""]);

describe("G4: keyless is the default; a key sits only where the host takes it; a deep link carries the address and nothing else", () => {
  const OWNERS = [...MCP_HOSTS, ...MCP_MORE_HOSTS];
  it("with no key, no block anywhere carries rb_live_ after Bearer, and every keyed block shows the empty export line or the paste sentence", () => {
    for (const h of OWNERS) {
      const ctx = { url: URL };
      const text = [...allSteps(h.steps(ctx)), ...(h.keyed ? allSteps(h.keyed.steps(ctx)) : [])].join("\n");
      expect(text, `${h.id} keyless block`).not.toMatch(/Bearer rb_live_/);
      expect(text, `${h.id} keyless block`).not.toMatch(/your key\.\.\./);
      if (h.keyed?.takesKey) {
        expect(text, `${h.id} keyed block with no key`).toMatch(/Paste your key above to fill this in\./);
      }
    }
  });
  it("with a key, it appears exactly once in the keyed block of a host that takes it, never in the keyless steps, never in a deep link", () => {
    for (const h of OWNERS) {
      const ctx = { url: URL, key: KEY };
      // The keyless steps never carry the key even when one is pasted, in every sign-in state.
      for (const signIn of ["on", "off", "unknown", undefined] as const) {
        const keyless = allSteps(h.steps({ url: URL, key: KEY, signIn })).join("\n");
        expect(keyless.split(KEY).length - 1, `${h.id} keyless steps carry the key (state ${signIn})`).toBe(0);
      }
      if (h.keyed) {
        const keyed = allSteps(h.keyed.steps(ctx)).join("\n");
        const count = keyed.split(KEY).length - 1;
        expect(count, `${h.id} keyed block key count`).toBe(h.keyed.takesKey ? 1 : 0);
        if (h.keyed.takesKey) expect(keyed).not.toMatch(/Paste your key above/);
      }
      if ("deeplinks" in h && h.deeplinks) {
        for (const l of h.deeplinks(ctx)) expect(l.href, `${h.id} ${l.label}`).not.toContain(KEY);
      }
    }
  });
  it("Zed: the keyless block leads while sign-in is on; otherwise step 1 sends the person to the keyed block, and the key is rendered there once", () => {
    const zed = MCP_MORE_HOSTS.find((h) => h.id === "zed")!;
    const on = zed.steps({ url: URL, signIn: "on" });
    expect(on[0].copy).toContain("context_servers");
    expect(on[0].copy).not.toContain("Authorization");
    for (const signIn of ["off", "unknown", undefined] as const) {
      const first = zed.steps({ url: URL, key: KEY, signIn })[0];
      expect(first.copy, `state ${signIn}`).toBeUndefined();
      expect(first.text, `state ${signIn}`).toMatch(/With a free key/);
      expect(first.text, `state ${signIn}`).not.toMatch(/is off today|switched on yet/);
    }
    const keyed = allSteps(zed.keyed!.steps({ url: URL, key: KEY })).join("\n");
    expect(keyed.split(KEY).length - 1).toBe(1);
    expect(keyed).toContain("context_servers");
  });
  it("the cursor:// link decodes to {url} only and the vscode: links to {name, type, url} only", () => {
    const cursor = MCP_HOSTS.find((h) => h.id === "cursor")!.deeplinks!({ url: URL, key: KEY });
    expect(cursor.length).toBe(1);
    const u = new globalThis.URL(cursor[0].href);
    expect(u.protocol).toBe("cursor:");
    expect(u.searchParams.get("name")).toBe("resumebooster");
    expect(JSON.parse(atob(u.searchParams.get("config")!))).toEqual({ url: URL });
    const vscode = MCP_HOSTS.find((h) => h.id === "vscode")!.deeplinks!({ url: URL, key: KEY });
    expect(vscode.map((l) => l.href.split(":")[0]).sort()).toEqual(["vscode", "vscode-insiders"]);
    for (const l of vscode) {
      const json = decodeURIComponent(l.href.replace(/^vscode(-insiders)?:mcp\/install\?/, ""));
      expect(JSON.parse(json)).toEqual({ name: "resumebooster", type: "http", url: URL });
    }
  });
  it("the Cursor and Windsurf keyed blocks read the key from the environment, and the VS Code block declares a hidden input", () => {
    const cursor = allSteps(MCP_HOSTS.find((h) => h.id === "cursor")!.keyed!.steps({ url: URL, key: KEY })).join("\n");
    expect(cursor).toContain(`Bearer \${env:${MCP_KEY_ENV}}`);
    const windsurf = allSteps(MCP_MORE_HOSTS.find((h) => h.id === "windsurf")!.keyed!.steps({ url: URL, key: KEY })).join("\n");
    expect(windsurf).toContain(`Bearer \${env:${MCP_KEY_ENV}}`);
    const vscode = allSteps(MCP_HOSTS.find((h) => h.id === "vscode")!.steps({ url: URL })).join("\n");
    const block = JSON.parse(/\{[\s\S]*\}/.exec(vscode)![0]) as { inputs: Array<{ type: string; password: boolean; id: string }>; servers: Record<string, { type: string; url: string; headers: Record<string, string> }> };
    expect(block.inputs[0]).toMatchObject({ type: "promptString", password: true });
    expect(block.servers.resumebooster).toMatchObject({ type: "http", url: URL, headers: { Authorization: `Bearer \${input:${block.inputs[0].id}}` } });
  });
});

// ───────────────────────── G5: the rows are the server's strings ─────────────

describe("G5: troubleshooting rows quote the server's own strings, or a vendor's document", () => {
  const SERVER = { "index.ts": strip(read("supabase/functions/agent-mcp/index.ts")), "oauth.ts": strip(read("supabase/functions/agent-mcp/oauth.ts")) };
  const shippedVersion = /version: "(\d{4}-\d{2}-\d{2}\.\d+)"/.exec(SERVER["index.ts"])?.[1] ?? "";
  /** "2026-09-04.10" ships after "2026-09-04.7": the date as a string, the patch as a number — never a string compare of the whole. */
  const shippedBy = (since: string, version: string): boolean => {
    const [sd, sp] = since.split("."), [vd, vp] = version.split(".");
    return sd < vd || (sd === vd && Number(sp) <= Number(vp));
  };
  /** The offences a row list commits against a server source, as a pure function so the teeth can call it. */
  function offences(rows: typeof MCP_TROUBLESHOOTING, src: typeof SERVER, version: string): string[] {
    const out: string[] = [];
    for (const r of rows) {
      if (r.source.kind === "server") {
        const present = src[r.source.file].includes(r.source.pin);
        const shipped = !r.source.since || shippedBy(r.source.since, version);
        if (shipped && !present) out.push(`${r.id}: the server no longer says "${r.source.pin}"`);
        if (!shipped && present) out.push(`${r.id}: the server already says "${r.source.pin}" — drop \`since\``);
        if (!r.see.includes(r.source.pin.slice(0, 20))) out.push(`${r.id}: the row's symptom does not quote its pin`);
      } else if (r.source.kind === "vendor") {
        if (!/^https:\/\/[a-z.]+\/\S+$/.test(r.source.doc)) out.push(`${r.id}: vendor row without a document URL`);
      }
    }
    return out;
  }
  it("reads a real server version and a non-trivial row list", () => {
    expect(shippedVersion).toMatch(/^2026-/);
    // The tenth patch ships after the seventh; a string compare would say otherwise.
    expect(shippedBy("2026-09-04.7", "2026-09-04.10")).toBe(true);
    expect(shippedBy("2026-09-04.10", "2026-09-04.7")).toBe(false);
    expect("2026-09-04.10" <= "2026-09-04.7").toBe(true);
    expect(shippedBy("2026-09-05.1", "2026-09-04.99")).toBe(false);
    // A `since` on a row whose string shipped earlier is a false claim the guard catches only while it is unshipped: so no row pins an oauth.ts string with `since` (oauth.ts is untouched in .7).
    for (const r of MCP_TROUBLESHOOTING) if (r.source.kind === "server" && r.source.file === "oauth.ts") expect(r.source.since, r.id).toBeUndefined();
    expect(MCP_TROUBLESHOOTING.length).toBeGreaterThan(12);
    expect(MCP_TROUBLESHOOTING.filter((r) => r.source.kind === "server").length).toBeGreaterThan(8);
    expect(MCP_TROUBLESHOOTING.filter((r) => r.source.kind === "vendor").length).toBeGreaterThan(2);
  });
  it("every server row's pin occurs in the comment-stripped Deno source once its version has shipped, and every vendor row cites a document", () => {
    expect(offences(MCP_TROUBLESHOOTING, SERVER, shippedVersion)).toEqual([]);
  });
  it("the state rows show for their state, and unknown shows the off rows (closed toward the in-band answer)", () => {
    const ids = (s: SignInState) => troubleRowsFor(s).map((r) => r.id);
    expect(ids("off")).toContain("sign-in-off");
    expect(ids("off")).not.toContain("connect-card");
    expect(ids("on")).toContain("connect-card");
    expect(ids("on")).not.toContain("sign-in-off");
    expect(ids("unknown")).toEqual(ids("off"));
    // Rows with no state show in every state.
    for (const s of ["on", "off", "unknown"] as const) expect(ids(s)).toContain("allowance-spent");
  });
  it("teeth: a server string that moved fails its row, and a row quoting a string the server does not send yet fails without `since`", () => {
    const moved = { ...SERVER, "index.ts": SERVER["index.ts"].replace("That key is not recognised.", "That key is unknown.") };
    expect(moved["index.ts"]).not.toBe(SERVER["index.ts"]);
    expect(offences(MCP_TROUBLESHOOTING, moved, shippedVersion)).toEqual(["key-not-recognised: the server no longer says \"That key is not recognised.\""]);
    const premature = [{ ...MCP_TROUBLESHOOTING[0], id: "x", see: "\"A sentence the server has never said.\"", source: { kind: "server" as const, pin: "A sentence the server has never said.", file: "index.ts" as const } }];
    expect(offences(premature, SERVER, shippedVersion)).toEqual(["x: the server no longer says \"A sentence the server has never said.\""]);
    const stale = [{ ...MCP_TROUBLESHOOTING.find((r) => r.id === "key-not-recognised")!, source: { kind: "server" as const, pin: "That key is not recognised.", file: "index.ts" as const, since: "2099-01-01.1" } }];
    expect(offences(stale, SERVER, shippedVersion)).toEqual(["key-not-recognised: the server already says \"That key is not recognised.\" — drop `since`"]);
  });
});

// ───────────────────────── G8: the switchboard ──────────────────────────────

const JARGON = /\b401\b|WWW-Authenticate|\bbearer\b|Streamable|stateless|\bPRM\b|\bmetadata\b/i;

/**
 * THE TILE PROPERTY — the owner's decision as a pure function over whatever
 * a surface rendered: exactly these hosts, in this order, each flagged
 * `page` in the table, and nothing else. A fourth tile, a missing tile, a
 * swapped pair and a tile the table does not flag each produce an offence;
 * the teeth below call it on such copies.
 */
const OWNER_TILES = ["claude", "chatgpt", "claude-code"] as const;
const tileOffences = (rendered: readonly (string | null)[]): string[] => {
  const out: string[] = [];
  if (rendered.length !== OWNER_TILES.length) out.push(`${rendered.length} tiles, not ${OWNER_TILES.length}`);
  OWNER_TILES.forEach((want, i) => { if (rendered[i] !== want) out.push(`tile ${i + 1} is ${rendered[i]}, not ${want}`); });
  for (const id of rendered.slice(OWNER_TILES.length)) out.push(`${id} is a tile beyond the owner's three`);
  for (const id of rendered) if (!MCP_HOSTS.find((h) => h.id === id)?.page) out.push(`${id} is not flagged page in the table`);
  return out;
};
/** THE GITHUB LINE PROPERTY: the off-page hosts by name, in the table's order, then "and other tools", and the install repo as the one link. */
const githubLineOffences = (text: string, href: string | null): string[] => {
  const out: string[] = [];
  const names = MCP_OFF_PAGE_HOSTS.map((h) => h.name).join(", ");
  if (text !== `Using a different agent? Setup for ${names} and other tools is on GitHub →`) out.push(`line reads "${text}"`);
  if (href !== MCP_INSTALL_REPO_URL) out.push(`link goes to ${href}`);
  if (!/^https:\/\/github\.com\/[^?#]+$/.test(href ?? "")) out.push("link is not a bare GitHub URL");
  if (/rb_live_|[?&]key=/.test(href ?? "")) out.push("link carries a key");
  return out;
};

describe("G8: the tiles are the owner's three with one GitHub line under them; the table keeps every host; a jargon-free first step; a prerender that carries the same", () => {
  it("the table keeps every host in the owner's order (the README's list), and the tiles are the page-flagged three in that order", () => {
    expect(MCP_HOSTS.map((h) => h.id)).toEqual([...MCP_HOST_IDS]);
    expect(MCP_HOST_IDS).toEqual(["claude", "chatgpt", "claude-code", "cursor", "vscode", "more"]);
    expect(MCP_HOSTS.map((h) => h.name)).toEqual(["Claude", "ChatGPT", "Claude Code", "Cursor", "VS Code", "More…"]);
    for (const h of MCP_HOSTS) expect(typeof h.page, `${h.id} has no page flag`).toBe("boolean");
    expect(tileOffences(MCP_PAGE_HOST_IDS)).toEqual([]);
    expect(MCP_PAGE_HOSTS.map((h) => h.name)).toEqual(["Claude", "ChatGPT", "Claude Code"]);
    // Derived, not a second list: the page hosts are the table filtered, in the table's order.
    expect(MCP_PAGE_HOSTS).toEqual(MCP_HOSTS.filter((h) => h.page));
    expect(MCP_OFF_PAGE_HOSTS).toEqual(MCP_HOSTS.filter((h) => !h.page && h.id !== "more"));
    expect(MCP_OFF_PAGE_HOSTS.map((h) => h.name)).toEqual(["Cursor", "VS Code"]);
    // Every seeker-facing chooser is the page list.
    expect(MCP_CHOOSER_HOSTS).toEqual(MCP_PAGE_HOSTS);
  });
  it("the GitHub line names the off-page hosts from the table and links the install repo constant — spelled once in the mirror", () => {
    expect(githubLineOffences(MCP_OTHER_AGENTS_TEXT, MCP_OTHER_AGENTS_LINE.href)).toEqual([]);
    expect(MCP_OTHER_AGENTS_TEXT).toBe("Using a different agent? Setup for Cursor, VS Code and other tools is on GitHub →");
    expect(`${MCP_OTHER_AGENTS_LINE.lead} ${MCP_OTHER_AGENTS_LINE.link}`).toBe(MCP_OTHER_AGENTS_TEXT);
    const cfg = strip(read("src/config/mcp-tools.ts"));
    expect(cfg.split(MCP_INSTALL_REPO_URL).length - 1, "the repo URL is typed more than once in the mirror").toBe(1);
    // The line's names are read off the table, never typed: no off-page host name sits inside a string literal in the mirror's derived-list block.
    const block = cfg.slice(cfg.indexOf("export const MCP_PAGE_HOSTS"), cfg.indexOf("export const MCP_CHOOSER_HOSTS"));
    for (const h of MCP_OFF_PAGE_HOSTS) expect(block, `${h.name} typed into the GitHub line`).not.toContain(h.name);
    // The prose fallback the page keeps is the long tail's own entry.
    expect(MCP_COPY_THE_PROMPT?.id).toBe("copy-the-prompt");
    expect(MCP_COPY_THE_PROMPT?.name).toBe("Copy the prompt");
  });
  it("a page that sends a seeker to /agents names the tiles off the mirror, never by typing them", () => {
    // /data-api's "connect X, Y and Z" once typed "Claude, ChatGPT, Cursor"
    // and went stale the day Cursor left the tiles. Now it reads
    // MCP_PAGE_HOSTS; a host name spelled in that file is a typed list again.
    for (const page of ["src/pages/DataApi.tsx"]) {
      const text = strip(read(page));
      expect(text, `${page} does not read the page hosts`).toMatch(/MCP_PAGE_HOSTS\.map\(\(h\) => h\.name\)/);
      for (const h of MCP_HOSTS) {
        // "cursor=" (pagination) is not the host; match the name as a word, capitalised as the table spells it.
        const typed = new RegExp(`(?<![A-Za-z_.])${h.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z_=])`);
        expect(text, `${page} types the host name ${h.name}`).not.toMatch(typed);
      }
    }
  });
  it("the chat hosts' off sentence sends the person to a TILE that carries a key, never to a host the page sends to GitHub", () => {
    for (const h of MCP_HOSTS.filter((x) => !x.header)) {
      const off = h.signIn("off");
      for (const k of MCP_PAGE_HOSTS.filter((x) => x.header)) expect(off, `${h.id} off`).toContain(k.name);
      for (const o of MCP_OFF_PAGE_HOSTS) expect(off, `${h.id} off names ${o.name}, which is not a tile`).not.toContain(o.name);
    }
  });
  it("no host's first step names the jargon a newcomer should never meet — walked over steps, not grepped over the file", () => {
    // Every host in the table (the README renders them all). Cline, in the
    // long tail, quotes its vendor's own transport label in its first step —
    // the word the person must pick.
    for (const h of MCP_HOSTS) {
      const first = h.steps({ url: URL })[0];
      expect(`${first.text} ${first.note ?? ""}`, `${h.id} step 1`).not.toMatch(JARGON);
    }
    // The address sentence rides with the first paste on every host panel.
    for (const h of MCP_HOSTS) {
      const notes = h.steps({ url: URL }).map((s) => s.note ?? "").join(" ");
      expect(notes, `${h.id} lacks the address sentence`).toMatch(/This address is on Supabase, the company that hosts our server; it is ours\. Paste it exactly as it is\./);
    }
  });
  it("every host has three sign-in sentences, a verify line, and named documents for its labels", () => {
    for (const h of MCP_HOSTS) {
      for (const s of ["on", "off", "unknown"] as const) expect(h.signIn(s).length, `${h.id} ${s}`).toBeGreaterThan(20);
      expect(h.verify.length).toBeGreaterThan(20);
      expect(h.verify, `${h.id} verify names the server's own answer`).toMatch(/board_stats|serverInfo|results with ids/);
      if (h.id !== "more") expect(h.docs.length, `${h.id} names no document`).toBeGreaterThan(0);
    }
  });
  /** The /agents block of the prerender, executed against the real mirrors (or a mutated copy of them). */
  const bake = async (mutate: (D: Record<string, unknown>) => Record<string, unknown> = (D) => D) => {
    const BAKE = read("scripts/prerender-seo.mjs");
    const start = BAKE.indexOf("      const envText3 = ");
    const end = BAKE.indexOf('      write({\n        path: "/mcp",');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = BAKE.slice(start, end);
    const D = mutate({ ...(await import("../config/mcp-tools")), SENDABLE_VENDOR_LABELS: ["a", "b"], SENDABLE_VENDOR_SENTENCE: "a and b" });
    const written: Array<{ path: string; content: string; title: string; description: string; robots?: string }> = [];
    const fn = new Function(
      "D", "write", "readFileSync", "join", "root", "process", "BOARD_TOTAL", "plusClaim", "breadcrumbLd", "breadcrumbNav", "FREE_KEY_RATE_SENTENCE",
      `${block}; return true;`,
    );
    fn(
      D,
      (p: { path: string; content: string; title: string; description: string }) => written.push(p),
      () => "", (...xs: string[]) => xs.join("/"), ROOT, { env: { VITE_SUPABASE_URL: "https://example.invalid" } },
      123456, (n: number) => `${n}+`, () => ({}), () => "", "the rate sentence",
    );
    expect(written.map((w) => w.path)).toEqual(["/agents"]);
    return written[0].content;
  };
  /** The tiles a baked page carries: the anchors of its "Which agent" grid, in order. */
  const bakedTiles = (html: string) => [...html.slice(html.indexOf("Which agent do you use?")).matchAll(/<a href="#([a-z-]+)" class="block p-3/g)].map((m) => m[1]);
  const plainStep = (h: { steps: (c: { url: string }) => McpStep[] }) =>
    h.steps({ url: "https://example.invalid/functions/v1/agent-mcp" })[0].text.replace(/\*\*|`/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  it("the prerender's /agents block, executed against the real mirrors, writes the three tiles and their step 1, the GitHub line, the prose fallback, no other host's panel, and the reach disclosure over the whole table", async () => {
    const html = await bake();
    // The words a crawler reads: tags off, entities as the bake escapes them.
    const text = html.replace(/<[^>]+>/g, "");
    expect(tileOffences(bakedTiles(html))).toEqual([]);
    for (const h of MCP_PAGE_HOSTS) {
      expect(text, `${h.id} step 1 missing from the bake`).toContain(plainStep(h));
      expect(html).toContain(`id="${h.id}"`);
      expect(html).toContain(`href="#${h.id}"`);
    }
    // The hosts the page sends to GitHub have no panel and no anchor in the bake — the crawler copy says what the page says.
    for (const h of MCP_OFF_PAGE_HOSTS) {
      expect(text, `${h.id} step 1 baked for a host the page has no tile for`).not.toContain(plainStep(h));
      expect(html).not.toContain(`id="${h.id}"`);
      expect(html).not.toContain(`href="#${h.id}"`);
    }
    expect(html).not.toContain('id="more"');
    // The GitHub line, as the page renders it: lead, then the link.
    const line = /<p class="text-sm text-muted-foreground text-center mb-6">([^<]*) <a href="([^"]+)">([^<]+)<\/a><\/p>/.exec(html);
    expect(line, "the GitHub line is not in the bake").not.toBeNull();
    expect(githubLineOffences(`${line![1]} ${line![3]}`, line![2])).toEqual([]);
    // The prose fallback is the one long-tail block the bake keeps.
    expect(html).toContain(`<h4 class="font-semibold mb-1">${MCP_COPY_THE_PROMPT!.name}`);
    for (const m of MCP_MORE_HOSTS.filter((x) => x.id !== "copy-the-prompt")) expect(html, `${m.id} baked though the page sends it to GitHub`).not.toContain(`<h4 class="font-semibold mb-1">${m.name}`);
    // The developer disclosure keeps the whole table: the server's reach, not a seeker's choice.
    for (const h of MCP_HOSTS) expect(html, `${h.id} missing from the reach disclosure`).toContain(`<strong class="text-foreground">${h.name}</strong> — `);
    expect(html).toMatch(/only while the server's sign-in service is switched on/);
    expect(html).not.toMatch(/Bearer rb_live_\.\.\./);
    expect(html).toContain("Which agent do you use?");
    // The bake holds no key: every keyed block shows the empty export line.
    expect(html).toContain(`export ${MCP_KEY_ENV}=</code>`);
    expect(html).not.toContain("undefined");
  });
  it("teeth: a bake handed a fourth page host renders a fourth tile and fails the property", async () => {
    const html = await bake((D) => {
      const hosts = (D.MCP_HOSTS as typeof MCP_HOSTS).map((h) => (h.id === "cursor" ? { ...h, page: true } : h));
      return { ...D, MCP_HOSTS: hosts, MCP_PAGE_HOSTS: hosts.filter((h) => h.page) };
    });
    const tiles = bakedTiles(html);
    expect(tiles).toEqual([...OWNER_TILES, "cursor"]);
    expect(tileOffences(tiles)).not.toEqual([]);
    expect(html).toContain('id="cursor"');
  });
  it("the prose fallback's section exists only when the long tail carries the entry — the bake and the page agree on an absent one", async () => {
    // The page's CopyThePrompt renders null without the entry; the bake once
    // wrapped an empty string in a section regardless. Same rule now.
    const withIt = await bake();
    expect(withIt).toContain(`<h4 class="font-semibold mb-1">${MCP_COPY_THE_PROMPT!.name}`);
    expect(withIt).not.toMatch(/<section class="mb-8">\s*<\/section>/);
    const without = await bake((D) => ({ ...D, MCP_COPY_THE_PROMPT: undefined }));
    expect(without).not.toContain(`<h4 class="font-semibold mb-1">${MCP_COPY_THE_PROMPT!.name}`);
    expect(without).not.toMatch(/<section class="mb-8">\s*<\/section>/);
    expect(without).not.toContain("undefined");
    // The bake still writes everything else: tiles, the GitHub line, the test section.
    expect(tileOffences(bakedTiles(without))).toEqual([]);
    expect(without).toContain("Test the server");
  });
});

// ───────────────────────── G9: clicks send what they name ───────────────────

type Body = Record<string, unknown>;
const tracked = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls
  .filter(([u]) => String(u).endsWith("/functions/v1/track-ab-event"))
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body)
  .filter((b) => b.testName === "agents");
const mcpCalls = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls
  .filter(([u]) => String(u) === MCP_URL)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { method: string; params?: { name?: string } });

function hookFetch(state: SignInState) {
  // BEFORE THE MOUNT, DEV off, production hostname (the file's environment
  // option) so postTrackEvent really serialises. The "server" answers the
  // four MCP messages with a fact of the given state.
  vi.stubEnv("DEV", false);
  const spy = vi.fn(async (u: string, init?: RequestInit) => {
    if (String(u) === MCP_URL) {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      const result =
        method === "initialize" ? { serverInfo: { name: "resumebooster-job-board", version: "test" }, _meta: { [MCP_SIGN_IN_META_KEY]: { state } } }
        : method === "tools/list" ? { tools: [{}, {}] }
        : method === "prompts/list" ? { prompts: [{}] }
        : { content: [{ type: "text", text: JSON.stringify({ jobs: Array.from({ length: MCP_ANON_CAPS.searchRows }, () => ({})), unkeyed: { callsLeftToday: 20, ipCap: MCP_ANON_CAPS.perAddressPerDay } }) }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "X-Unkeyed-Remaining": "20" } });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", spy);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
  return spy;
}
const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);

describe("G9: the switchboard's clicks, judged by the request body", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* blocked */ } window.history.replaceState(null, "", "/agents"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("opens with the question, the owner's three tiles, the GitHub line under them, the prose fallback, no panel, and nothing above the fold names the jargon", () => {
    hookFetch("off");
    mount();
    const group = screen.getByRole("group", { name: "Which agent do you use?" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(tileOffences(buttons.map((b) => b.getAttribute("data-host")))).toEqual([]);
    expect(buttons.map((b) => b.querySelector("span")!.textContent)).toEqual(["Claude", "ChatGPT", "Claude Code"]);
    // Not a tile anywhere on the page, under any control.
    for (const h of MCP_OFF_PAGE_HOSTS) expect(document.querySelector(`[data-host="${h.id}"]`), `${h.id} rendered as a tile`).toBeNull();
    expect(document.querySelector('[data-host="more"]')).toBeNull();
    const line = document.querySelector("[data-other-agents]")!;
    const a = line.querySelector("a")!;
    expect(githubLineOffences(line.textContent!.replace(/\s+/g, " ").trim(), a.getAttribute("href"))).toEqual([]);
    expect(a.textContent).toBe(MCP_OTHER_AGENTS_LINE.link);
    // The prose fallback stays, closed, with the prompt naming the address and no key.
    const fallback = document.querySelector("[data-copy-the-prompt]")!;
    expect(fallback.textContent).toContain(MCP_COPY_THE_PROMPT!.name);
    expect(fallback.querySelector("pre")!.textContent).toContain(MCP_URL);
    expect(fallback.querySelector("pre")!.textContent).not.toMatch(/rb_live_/);
    expect(document.querySelector("section[id]")).toBeNull();
    const aboveFold = document.querySelector("main")!.textContent!.split("Test the server")[0];
    expect(aboveFold).not.toMatch(JARGON);
    expect(aboveFold).not.toMatch(/rb_live_|Authorization/);
  });

  it("picking a host fires agents_host_pick {host}, opens only that host's panel, remembers the pick, and reads the fact off ONE free initialize", async () => {
    const spy = hookFetch("off");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^ChatGPT/ }));
    await waitFor(() => expect(tracked(spy).length).toBe(1), SLOW);
    const ev = tracked(spy)[0];
    expect(ev).toMatchObject({ testName: "agents", variant: "agents_host_pick", eventType: "view", metadata: { host: "chatgpt" } });
    expect(String(ev.visitorId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(document.querySelectorAll("section[id]").length).toBe(1);
    expect(document.querySelector("section[id]")!.id).toBe("chatgpt");
    expect(localStorage.getItem("rb_pass_host")).toBe("ChatGPT");
    expect(window.location.hash).toBe("#chatgpt");
    // The silent read: exactly one initialize, no tools/call.
    await waitFor(() => expect(mcpCalls(spy).map((c) => c.method)).toEqual(["initialize"]), SLOW);
    await waitFor(() => expect(document.querySelector("[data-sign-in]")!.getAttribute("data-sign-in")).toBe("off"), SLOW);
    // The off sentence, from the host's own builder, with the unkeyed names.
    const panel = document.querySelector("section#chatgpt")!.textContent!;
    expect(panel).toContain("Sign-in from ChatGPT is not switched on yet");
    for (const n of MCP_ANON_TOOL_NAMES) expect(panel).toContain(n);
    // Switching hosts does not re-probe.
    fireEvent.click(screen.getByRole("button", { name: /^Claude Code/ }));
    expect(document.querySelectorAll("section[id]").length).toBe(1);
    expect(document.querySelector("section[id]")!.id).toBe("claude-code");
    expect(mcpCalls(spy).map((c) => c.method)).toEqual(["initialize"]);
  });

  it("the hash selects a tile on load, a remembered tile opens its panel without a click, and a host the page sends to GitHub opens nothing either way", () => {
    hookFetch("on");
    const tile = MCP_PAGE_HOSTS[MCP_PAGE_HOSTS.length - 1];
    const off = MCP_OFF_PAGE_HOSTS[0];
    window.history.replaceState(null, "", `/agents#${tile.id}`);
    mount();
    expect(document.querySelector("section[id]")!.id).toBe(tile.id);
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/agents");
    localStorage.setItem("rb_pass_host", tile.name);
    mount();
    expect(document.querySelector("section[id]")!.id).toBe(tile.id);
    // A hash or a remembered pick for a host with no tile — the table still carries it for the README — opens no panel and presses no tile.
    document.body.innerHTML = "";
    window.history.replaceState(null, "", `/agents#${off.id}`);
    localStorage.setItem("rb_pass_host", off.name);
    mount();
    expect(document.querySelector("section[id]")).toBeNull();
    expect(document.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it("the key field fills the one line that takes the key, and the deep links never carry it", () => {
    hookFetch("off");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Claude Code/ }));
    const pres = () => Array.from(document.querySelectorAll("section#claude-code pre")).map((p) => p.textContent ?? "");
    expect(pres().join("\n")).toContain(`export ${MCP_KEY_ENV}=`);
    expect(pres().join("\n")).not.toContain(KEY);
    expect(screen.getByText("Paste your key above to fill this in.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Paste your key here/), { target: { value: KEY } });
    expect(pres().join("\n").split(KEY).length - 1).toBe(1);
    expect(pres().join("\n")).toContain(`export ${MCP_KEY_ENV}=${KEY}`);
    expect(pres().join("\n")).not.toMatch(/Bearer rb_live_/);
    // No link anywhere on the page carries the key — the GitHub line included.
    for (const a of Array.from(document.querySelectorAll("a[href]"))) expect(a.getAttribute("href")).not.toContain(KEY);
  });

  it("Test the server runs initialize, tools/list, prompts/list and ONE search, prints the answer in words, and fires agents_test_server {host, state}", async () => {
    const spy = hookFetch("on");
    localStorage.setItem("rb_pass_host", "Claude");
    mount();
    const before = tracked(spy).length;
    fireEvent.click(screen.getByRole("button", { name: /Test the server/ }));
    await waitFor(() => expect(tracked(spy).length).toBe(before + 1), SLOW);
    const ev = tracked(spy).at(-1)!;
    expect(ev).toMatchObject({ testName: "agents", variant: "agents_test_server", metadata: { host: "claude", state: "on" } });
    expect(String(ev.variant).length).toBeLessThanOrEqual(30);
    const calls = mcpCalls(spy);
    // One silent initialize for the remembered host's panel, then the four.
    expect(calls.map((c) => c.method)).toEqual(["initialize", "initialize", "tools/list", "prompts/list", "tools/call"]);
    expect(calls.filter((c) => c.method === "tools/call").length).toBe(1);
    // The one search asks for the unkeyed maximum, by the mirror's name, and the fixed query.
    expect(calls.at(-1)!.params).toEqual({ name: "search_jobs", arguments: { query: MCP_TEST_QUERY, limit: MCP_ANON_CAPS.searchRows } });
    const result = document.querySelector("[data-test-result]")!.textContent!;
    expect(result).toContain("resumebooster-job-board, version test — 2 tools, 1 prompts");
    expect(searchClauseOffences(result, MCP_ANON_CAPS.searchRows)).toEqual([]);
    expect(result).toContain(`20 of ${MCP_ANON_CAPS.perAddressPerDay} free calls left today`);
    expect(result).toMatch(/Sign-in for Claude and ChatGPT: switched on/);
    // The button rests for a minute after a run.
    expect((screen.getByRole("button", { name: /Test the server/ }) as HTMLButtonElement).disabled).toBe(true);
    // The panel's sentence followed the test's fact.
    expect(document.querySelector("[data-sign-in]")!.getAttribute("data-sign-in")).toBe("on");
  });

  it("the troubleshooting rows on the page follow the fact: off-state rows before a test, on-state rows after a test that says on", async () => {
    hookFetch("on");
    mount();
    const rows = () => Array.from(document.querySelectorAll("[data-trouble]")).map((r) => r.getAttribute("data-trouble"));
    expect(rows()).toContain("sign-in-off");
    expect(rows()).not.toContain("connect-card");
    fireEvent.click(screen.getByRole("button", { name: /Test the server/ }));
    await waitFor(() => expect(rows()).toContain("connect-card"), SLOW);
    expect(rows()).not.toContain("sign-in-off");
  });

  it("the pass card's gate sentence renders for a chat host while the fact is not on, and never for a key host", async () => {
    hookFetch("off");
    localStorage.setItem("rb_pass_host", "Claude");
    mount();
    await waitFor(() => expect(document.querySelector("[data-pass-gate]")).not.toBeNull(), SLOW);
    const gate = document.querySelector("[data-pass-gate]")!.textContent!;
    expect(gate).toMatch(/From Claude the pass can be used only once sign-in is switched on/);
    // "use it from …": the key-carrying TILE, never a host the page sends to GitHub.
    for (const h of MCP_PAGE_HOSTS.filter((x) => x.header)) expect(gate).toContain(h.name);
    for (const h of MCP_OFF_PAGE_HOSTS) expect(gate, `${h.name} is not a tile`).not.toContain(h.name);
    fireEvent.click(screen.getByRole("button", { name: /^Claude Code/ }));
    expect(document.querySelector("[data-pass-gate]")).toBeNull();
    // The Buy control itself is never gated on the fact (signed out here: the sign-in link stands).
    expect(screen.getByRole("link", { name: /sign in to buy/i })).toBeInTheDocument();
  });
});

// ───────────────────────── G10: the prompts open unkeyed ───────────────────

describe("G10: the hand-off prompts' first tool answers with no key", () => {
  const firstTool = (p: string) => [...p.matchAll(/\b([a-z]+_[a-z_]+|fetch|search)\b/g)].map((m) => m[1]).find((n) => MCP_TOOL_NAMES.includes(n))!;
  it("a job hands over fetch first, a search search_jobs first, and the keyed check waits on its clause", () => {
    for (const p of [agentPrompt({ id: "greenhouse:acme:1", sendable: false }), agentPrompt({ id: "greenhouse:acme:1", sendable: true })]) {
      expect(MCP_ANON_TOOL_NAMES).toContain(firstTool(p));
      expect(p).toMatch(/if this connection holds a key or is signed in, call check_apply_support/);
    }
    const s = searchPrompt({ query: "x" });
    expect(firstTool(s)).toBe("search_jobs");
    expect(s).toMatch(/if this connection holds a key or is signed in, check_apply_support/);
  });
  it("teeth: a prompt that opens with get_job fails the property", () => {
    const broken = agentPrompt({ id: "x", sendable: false }).replace("call fetch with", "call get_job with");
    expect(MCP_ANON_TOOL_NAMES).not.toContain(firstTool(broken));
  });
});

// ───────────────────────── G12: /mcp is not the server ──────────────────────

describe("G12: /mcp exists, says it is not the server address, is noindex and in no sitemap", () => {
  it("is a route, a noindex page with the not-the-server title, and a noindex prerender the sitemap skips", () => {
    const app = strip(read("src/App.tsx"));
    expect(app).toMatch(/<Route path="\/mcp" element=\{<McpNotHere \/>\} \/>/);
    const page = strip(read("src/pages/McpNotHere.tsx"));
    expect(page).toMatch(/<SEO[\s\S]*?noIndex[\s\S]*?\/>/);
    expect(page).toMatch(/MCP_NOT_HERE_TITLE = "This is not the server address"/);
    expect(page).toMatch(/MCP_SERVER_ADDRESS_NOTE/);
    expect(page).toMatch(/to="\/agents"/);
    // The page reads the address from the client module, never from the /agents page (which would pull the whole switchboard chunk into a twenty-line route).
    expect(page).toMatch(/import \{ MCP_URL \} from "@\/lib\/mcp-test"/);
    expect(page).not.toMatch(/from "\.\/AgentConnect"/);
    const bake = strip(read("scripts/prerender-seo.mjs"));
    const i = bake.indexOf('path: "/mcp",');
    expect(i).toBeGreaterThan(-1);
    expect(bake.slice(i, i + 200)).toMatch(/robots: "noindex, follow"/);
    expect(bake.slice(i, i + 400)).toMatch(/title: "This is not the server address"/);
    // Not in the static sitemap list, and not a redirect anywhere.
    const routes = bake.slice(bake.indexOf("const STATIC_ROUTES = ["), bake.indexOf("];", bake.indexOf("const STATIC_ROUTES = [")));
    expect(routes).not.toContain('"/mcp"');
    expect(bake).not.toMatch(/\/mcp[^\n]*(301|302|307|308|redirect)/i);
    const redirects = (() => { try { return read("public/_redirects"); } catch { return ""; } })();
    expect(redirects).not.toMatch(/^\/mcp\b/m);
  });
});

// ───────────────────────── teeth for the source-level properties ────────────

describe("teeth: each source property fails on a copy that breaks it", () => {
  it("a renamed key on either side breaks G3", () => {
    const probe = strip(read("supabase/functions/agent-mcp/as-probe.ts")).replace('SIGN_IN_META_KEY = "work.resumebooster/sign-in"', 'SIGN_IN_META_KEY = "work.resumebooster/signin"');
    const m = /export const SIGN_IN_META_KEY = "([^"]+)"/.exec(probe);
    expect(m![1]).not.toBe(MCP_SIGN_IN_META_KEY);
  });
  it("a placeholder inside an Authorization value breaks G4", () => {
    const host = MCP_HOSTS.find((h) => h.id === "claude-code")!;
    const mutated = allSteps(host.keyed!.steps({ url: URL })).join("\n").replace(`Bearer $${MCP_KEY_ENV}`, "Bearer rb_live_...your key...");
    expect(mutated).toMatch(/Bearer rb_live_/);
  });
  it("a host out of order breaks G8", () => {
    expect([...MCP_HOSTS].reverse().map((h) => h.id)).not.toEqual([...MCP_HOST_IDS]);
    expect(tileOffences([...MCP_PAGE_HOST_IDS].reverse())).not.toEqual([]);
  });
  it("a fourth tile, a missing tile, the old six, and a tile the table does not flag each break G8", () => {
    expect(tileOffences([...MCP_PAGE_HOST_IDS, "cursor"])).toEqual(["4 tiles, not 3", "cursor is a tile beyond the owner's three", "cursor is not flagged page in the table"]);
    expect(tileOffences(MCP_PAGE_HOST_IDS.slice(0, 2))).not.toEqual([]);
    expect(tileOffences(MCP_HOST_IDS)).not.toEqual([]);
    expect(tileOffences(["claude", "chatgpt", "vscode"])).toEqual(["tile 3 is vscode, not claude-code", "vscode is not flagged page in the table"]);
    // A table copy that flags a fourth host derives a fourth tile.
    const flagged = MCP_HOSTS.map((h) => (h.id === "vscode" ? { ...h, page: true } : h)).filter((h) => h.page).map((h) => h.id);
    expect(flagged.length).toBe(4);
    expect(tileOffences(flagged)).not.toEqual([]);
  });
  it("a GitHub line with a typed name, another host, another target or a key breaks G8", () => {
    const names = MCP_OFF_PAGE_HOSTS.map((h) => h.name).join(", ");
    expect(githubLineOffences(`Using a different agent? Setup for ${names} and other tools is on GitHub →`, MCP_INSTALL_REPO_URL)).toEqual([]);
    expect(githubLineOffences(`Using a different agent? Setup for ${names}, Zed and other tools is on GitHub →`, MCP_INSTALL_REPO_URL)).not.toEqual([]);
    expect(githubLineOffences(`Using a different agent? Setup for Cursor and other tools is on GitHub →`, MCP_INSTALL_REPO_URL)).not.toEqual([]);
    expect(githubLineOffences(`Using a different agent? Setup for ${names} and other tools is on GitHub →`, "https://github.com/someone-else/resumebooster-mcp")).not.toEqual([]);
    expect(githubLineOffences(`Using a different agent? Setup for ${names} and other tools is on GitHub →`, `${MCP_INSTALL_REPO_URL}?key=${KEY}`)).not.toEqual([]);
    expect(githubLineOffences(`Using a different agent? Setup for ${names} and other tools is on GitHub →`, null)).not.toEqual([]);
  });
  it("a first step naming the transport breaks G8", () => {
    const first = MCP_HOSTS[0].steps({ url: URL })[0];
    expect(`${first.text} (Streamable HTTP)`).toMatch(JARGON);
    expect(first.text).not.toMatch(JARGON);
  });
  it("the prerender executes cleanly under node — the block is real script, not template text", () => {
    expect(() => execSync("node --check scripts/prerender-seo.mjs", { cwd: ROOT, stdio: "pipe" })).not.toThrow();
  });
});
