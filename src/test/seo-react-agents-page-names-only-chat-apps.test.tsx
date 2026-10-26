/**
 * /agents NAMES ONLY CLAUDE, CHATGPT AND CLAUDE CODE (R7b).
 *
 * Owner, 2026-09-18: seeker-facing pages name only Claude, ChatGPT and Claude
 * Code; every other app's setup lives on the GitHub install repo. The React
 * /agents still named Cursor, VS Code and Cline: the GitHub line ("Setup for
 * Cursor, VS Code and other tools"), the developer list of every host, the
 * reach sentence, the attach-menu lead ("Cursor's panel") and a
 * troubleshooting row ("Cursor / VS Code / Cline: server listed, zero tools").
 * The page now names the three and links the install repo for everything else.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MCP_INSTALL_REPO_URL, MCP_MORE_HOSTS, MCP_OFF_PAGE_HOSTS, MCP_OTHER_AGENTS_TEXT, MCP_TROUBLESHOOTING } from "@/config/mcp-tools";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";

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

/** Every app the page may not name, from the table itself (never typed here). */
const OTHER_APPS = [...MCP_OFF_PAGE_HOSTS.map((h) => h.name), ...MCP_MORE_HOSTS.filter((m) => m.id !== "copy-the-prompt" && m.id !== "any-client").map((m) => m.name)];

describe("/agents", () => {
  it("knows which apps it may not name (the guard is not vacuous)", () => {
    expect(OTHER_APPS).toEqual(expect.arrayContaining(["Cursor", "VS Code", "Cline"]));
  });

  it("renders no other app's name, opened or closed, and links the install repo", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);
    await screen.findByRole("heading", { level: 1 });
    // details elements render their bodies in the DOM whether open or not.
    const text = document.body.textContent ?? "";
    for (const name of OTHER_APPS) expect(text, `/agents names ${name}`).not.toContain(name);
    for (const name of ["Claude", "ChatGPT", "Claude Code"]) expect(text).toContain(name);
    expect([...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === MCP_INSTALL_REPO_URL)).toBe(true);
  });

  it("the shared line and the troubleshooting rows (which the bake prints too) name no other app", () => {
    for (const name of OTHER_APPS) {
      expect(MCP_OTHER_AGENTS_TEXT).not.toContain(name);
      for (const row of MCP_TROUBLESHOOTING) expect(`${row.see} ${row.why} ${row.fix}`, row.id).not.toContain(name);
    }
  });

  it.each(LOCALE_FILES)("%s: the attach-menu lead names no other app", (file) => {
    const lead = String((readMainLocale(file).agentConnect as Record<string, string>).attachLead);
    for (const name of OTHER_APPS) expect(lead).not.toContain(name);
  });
});
