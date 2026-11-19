/**
 * THE ADD-TO-CLAUDE BUTTON SHOWS WITH THE FLAG, AND THE CLAUDE STEPS NAME
 * THE RECORDED CHOICE (HO-1).
 *
 * The one-click install link sat behind a flag that was off, and the Claude
 * steps told everyone to accept whatever authentication setting Claude
 * detected: a setting nobody had checked, which Claude cannot change after a
 * connector is added. The owner's five-minute check of the documented link
 * records the choice that saves and searches with no key; that choice is ONE
 * constant (MCP_CLAUDE_AUTH_CHOICE, marked TO-CONFIRM until the check is
 * recorded), and the button is on.
 *
 * Pinned on the rendered panel and the bake: the button renders only with
 * the flag, the page's default is on, the hand-off carries the link, every
 * Claude route (one-click, manual, the bake) names the recorded choice, and
 * none of them says to accept the detected settings.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

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

import AgentConnect, { HostPanel } from "../pages/AgentConnect";
import * as mcp from "../config/mcp-tools";
import { MCP_URL } from "../lib/mcp-test";
import { installLinkFor } from "../lib/agent-handoff";
import { bakeAgents, bakedText } from "./helpers/agents-bake";

vi.setConfig({ testTimeout: 30_000 });
afterEach(() => cleanup());

const CHOICE = (mcp as unknown as { MCP_CLAUDE_AUTH_CHOICE?: string }).MCP_CLAUDE_AUTH_CHOICE;
const claude = mcp.MCP_HOSTS.find((h) => h.id === "claude")!;
const words = (steps: Array<{ text: string; note?: string }>) => steps.map((s) => `${s.text} ${s.note ?? ""}`).join("\n");
const panel = (addToClaude: boolean) =>
  render(<MemoryRouter><HostPanel host={claude} url={MCP_URL} fact={mcp.SIGN_IN_UNKNOWN} keyValue="" onKey={() => {}} addToClaude={addToClaude} /></MemoryRouter>);

describe("the recorded choice", () => {
  it("is one of the two settings Claude's dialog offers", () => {
    expect(["Sign in when needed", "No sign in"]).toContain(CHOICE);
  });

  it("every Claude route names it, and none says to accept the detected settings", () => {
    for (const steps of [claude.steps({ url: MCP_URL, addToClaude: true }), claude.steps({ url: MCP_URL }), claude.fallbackSteps!({ url: MCP_URL })]) {
      const w = words(steps);
      expect(w).toContain(`**${CHOICE}**`);
      expect(w).not.toMatch(/Keep them as they are|settings it detected|leave them/i);
    }
    expect(claude.how).toContain(String(CHOICE));
    expect(claude.how).not.toMatch(/settings Claude detects/);
  });
});

describe("the button", () => {
  it("renders only with the flag on, with the admin variant beneath it", () => {
    panel(false);
    expect(document.querySelector('[data-deeplink="Add to Claude"]')).toBeNull();
    cleanup();
    panel(true);
    expect(document.querySelector('[data-deeplink="Add to Claude"]')!.getAttribute("href")).toBe(mcp.claudeInstallLink(MCP_URL));
    expect([...document.querySelectorAll("[data-deeplink]")].some((a) => a.getAttribute("href") === mcp.claudeAdminInstallLink(MCP_URL))).toBe(true);
    expect(document.body.textContent).toContain(String(CHOICE));
  });

  it("is on by default: /agents renders it in the Claude panel, and the hand-off carries the link", () => {
    expect(mcp.MCP_ADD_TO_CLAUDE_LIVE).toBe(true);
    render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-host="claude"]')!);
    expect(document.querySelector('[data-deeplink="Add to Claude"]')!.getAttribute("href")).toBe(mcp.claudeInstallLink(MCP_URL));
    expect(installLinkFor("Claude")).toBe(mcp.claudeInstallLink(MCP_URL));
  });
});

describe("the bake", () => {
  it("carries the manual steps with the recorded choice, as crawlers read them", async () => {
    const text = bakedText((await bakeAgents()).content);
    expect(text).toContain(String(CHOICE));
    expect(text).not.toMatch(/Keep them as they are/);
  });
});
