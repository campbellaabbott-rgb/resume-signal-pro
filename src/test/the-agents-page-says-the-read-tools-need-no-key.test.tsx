/**
 * THE /agents PAGE SAYS THE READ TOOLS NEED NO KEY (S13-105).
 *
 * The server answers every read tool in ANON_TOOLS with no credential at all
 * (mirrored as MCP_ANON_TOOL_NAMES), and llms.txt says so. The page's key
 * section was headed "Read tools — any free key" and said they "work with any
 * free API key", and each of those tools wore the badge "any free key" beside
 * its own "answers with no key" chip. The read tier's badge now makes no key
 * claim, the two read tools the server answers only with a credential say
 * they need one, and the key section says no key is needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MCP_ANON_TOOL_NAMES, MCP_KEYED_READ_BADGE, MCP_READ_TOOLS, MCP_TIER_BADGE } from "@/config/mcp-tools";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stub(),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }), safeNextPath: (s: string) => s }));
function stub() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import AgentConnect from "@/pages/AgentConnect";
vi.setConfig({ testTimeout: 30_000 });
afterEach(cleanup);

describe("the read tier's badge", () => {
  it("claims no key, and the keyed read tools say they need one", () => {
    expect(MCP_TIER_BADGE.read).not.toMatch(/key/i);
    expect(MCP_KEYED_READ_BADGE).toMatch(/free key/);
    // The premise: most read tools are unkeyed, and some are not.
    expect(MCP_READ_TOOLS.filter((t) => MCP_ANON_TOOL_NAMES.includes(t.name)).length).toBeGreaterThan(5);
    expect(MCP_READ_TOOLS.some((t) => !MCP_ANON_TOOL_NAMES.includes(t.name))).toBe(true);
  });
});

describe("/agents", () => {
  it("heads the key section 'no key needed' and badges each tool by what the server asks of it", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);
    await screen.findByRole("heading", { level: 1 });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Read tools — any free key/);
    expect(text).not.toMatch(/work with any free API key/);
    expect(text).toMatch(/Read tools — no key needed/);
    // search_jobs answers with no key: its row carries no "any free key" badge.
    const row = [...document.querySelectorAll("code")].find((c) => c.textContent === "search_jobs" && c.closest("div.p-4"))?.closest("div.p-4");
    expect(row?.textContent ?? "").not.toMatch(/any free key/);
    const keyed = [...document.querySelectorAll("code")].find((c) => c.textContent === "key_status" && c.closest("div.p-4"))?.closest("div.p-4");
    expect(keyed?.textContent ?? "").toContain(MCP_KEYED_READ_BADGE);
  });
});
