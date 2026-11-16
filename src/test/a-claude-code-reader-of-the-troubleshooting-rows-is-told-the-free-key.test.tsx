/**
 * A CLAUDE CODE READER OF THE TROUBLESHOOTING ROWS IS TOLD THE FREE KEY (the
 * fix round of 2026-11-08, on CJ-08).
 *
 * CJ-08 rewrote two rows every reader of /agents sees, "sign-in-off" and
 * "allowance-spent", as chat editions with no key and no Claude Code in them.
 * But the table is one list for the whole page (troubleRowsFor filters by
 * the sign-in state only), so a Claude Code reader was told "Scoring a CV
 * comes with sign-in, which is not on yet", when a free key opens fit_resume
 * today, and the allowance row dropped the key the server's own refusal
 * still offers.
 *
 * Each of the two rows now carries a keyed fix, scoped to Claude Code. A chat
 * tile's reader sees the chat edition alone (CJ-08 holds); a Claude Code
 * reader, a reader who has picked no app yet, and the crawler copy see both.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { bakeAgents, bakedText } from "./helpers/agents-bake";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stubTable(),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit", "in"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
  return th;
}

import AgentConnect from "../pages/AgentConnect";
import { MCP_HOSTS, MCP_KEY_ADDS, MCP_MORE_HOSTS, MCP_NEVER_LISTED, MCP_TROUBLESHOOTING, troubleFix } from "../config/mcp-tools";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const row = (id: string) => MCP_TROUBLESHOOTING.find((r) => r.id === id)!;
const KEY_ROWS = ["sign-in-off", "allowance-spent"] as const;

describe("the two rows every reader sees carry a fix for Claude Code", () => {
  it("each names a free key from /data-api, for Claude Code only", () => {
    expect(row("sign-in-off").keyedFix).toMatch(/^In Claude Code, a free key from \/data-api opens it today/);
    expect(row("allowance-spent").keyedFix).toMatch(/^In Claude Code, a free key from \/data-api lifts the allowance today/);
  });
  it("the chat edition names no key, and says whose scoring waits for sign-in", () => {
    for (const id of KEY_ROWS) {
      expect(troubleFix(row(id), "chat")).toBe(row(id).fix);
      expect(troubleFix(row(id), "chat"), id).not.toMatch(/\bkey\b|Claude Code/);
    }
    expect(row("sign-in-off").fix).toMatch(/In Claude and ChatGPT, scoring a CV comes with sign-in, which is not on yet/);
  });
  it("every other reader gets both, the chat edition first", () => {
    for (const id of KEY_ROWS) expect(troubleFix(row(id), "all")).toBe(`${row(id).fix} ${row(id).keyedFix}`);
    expect(troubleFix(row("rate"), "all")).toBe(row("rate").fix);
  });
});

describe("the page and the bake print the fix for the reader's app", () => {
  afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
  const troubleText = (id: string) => document.querySelector(`[data-trouble="${id}"]`)?.textContent ?? "";
  const mountAt = async (hash: string) => {
    window.history.replaceState(null, "", `/agents${hash}`);
    render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(document.querySelector('[data-trouble="allowance-spent"]')).not.toBeNull(), SLOW);
  };

  it("a Claude Code reader sees the key in both rows", async () => {
    await mountAt("#claude-code");
    expect(troubleText("sign-in-off")).toContain(row("sign-in-off").keyedFix!);
    expect(troubleText("allowance-spent")).toContain(row("allowance-spent").keyedFix!);
  });
  it("a ChatGPT or Claude reader sees the chat edition alone", async () => {
    for (const hash of ["#chatgpt", "#claude"]) {
      await mountAt(hash);
      for (const id of KEY_ROWS) expect(troubleText(id), `${hash} ${id}`).not.toMatch(/Claude Code|\/data-api/);
      cleanup();
    }
  });
  it("the crawler copy carries both", async () => {
    const text = bakedText((await bakeAgents()).content);
    for (const id of KEY_ROWS) expect(text).toContain(row(id).keyedFix!);
  });
});

/**
 * S14X-260 (2026-11-16): the keyed steps a Claude Code reader follows after
 * the keyless ones added the same name again, which Claude Code refuses
 * ("MCP server resumebooster already exists in user config", rc 1, on 2.1.42
 * and 2.1.319); each keyed title promised debug_search, which the server
 * lists to nobody, and never named fit_resume; and the spent-quota row said
 * the unkeyed tools still answer, while the server refuses a recognised
 * over-quota key on every tool.
 */
describe("the keyed steps work after the keyless ones, and promise only what a key is shown", () => {
  const URL = "https://example.invalid/functions/v1/agent-mcp";
  const texts = (steps: Array<{ text: string; copy?: string }>) => steps.map((x) => `${x.text} ${x.copy ?? ""}`);
  const NEVER = (() => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
    const m = /const NEVER_LISTED: readonly string\[\] = \[([^\]]*)\]/.exec(src);
    if (!m) throw new Error("agent-mcp NEVER_LISTED is no longer a literal array");
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  })();

  it("Claude Code removes the keyless entry before the keyed add", () => {
    const steps = texts(MCP_HOSTS.find((h) => h.id === "claude-code")!.keyed!.steps({ url: URL, key: "" }));
    const remove = steps.findIndex((x) => x.includes("claude mcp remove resumebooster -s user"));
    const add = steps.findIndex((x) => x.includes("claude mcp add") && x.includes("Authorization: Bearer"));
    expect(remove, "no remove step").toBeGreaterThanOrEqual(0);
    expect(remove).toBeLessThan(add);
  });

  it("Gemini CLI removes it with its own documented line, in the scope it was added in", () => {
    const steps = texts(MCP_MORE_HOSTS.find((h) => h.id === "gemini-cli")!.keyed!.steps({ url: URL, key: "" }));
    const remove = steps.findIndex((x) => x.includes("gemini mcp remove --scope user resumebooster"));
    expect(remove, "no remove step").toBeGreaterThanOrEqual(0);
    expect(remove).toBeLessThan(steps.findIndex((x) => x.includes("gemini mcp add")));
  });

  it("no keyed title names a tool the server never lists, and each names fit_resume", () => {
    expect(MCP_NEVER_LISTED).toEqual(NEVER);
    expect(MCP_KEY_ADDS).toContain("fit_resume");
    const titles = [...MCP_HOSTS, ...MCP_MORE_HOSTS].map((h) => h.keyed?.title).filter((t): t is string => !!t && /^With a free key \(optional/.test(t));
    expect(titles.length).toBeGreaterThanOrEqual(4);
    for (const t of titles) {
      for (const n of NEVER) expect(t, t).not.toContain(n);
      expect(t, t).toContain("fit_resume");
    }
  });

  it("the spent-quota row never says the unkeyed tools still answer", () => {
    const fix = MCP_TROUBLESHOOTING.find((r) => r.id === "quota-used")!.fix;
    expect(fix).not.toMatch(/unkeyed tools still answer/);
    expect(fix).toMatch(/Remove the key/);
  });
});
