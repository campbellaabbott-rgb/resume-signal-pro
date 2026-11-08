/**
 * A CHATGPT FREE READER IS POINTED TO CLAUDE (CJ-01, PLT-1107-01 copy part,
 * owner decision 2026-11-07).
 *
 * The ChatGPT tile sent everyone through seven steps that ChatGPT Free cannot
 * finish (OpenAI's pricing table: "Plan: Free, Feature: Create & share
 * Plugins, No"), and its only plan note was "your account or workspace does
 * not allow custom servers yet", with nowhere to go. Claude's free plan can
 * add one custom connector. Now the tile quotes OpenAI's own table with its
 * link and the day it was read, and says "On ChatGPT Free? Use Claude's free
 * plan" linking the Claude tile; the homepage's AI strip says the same.
 * Plus and Go are named nowhere until the owner's ChatGPT check.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bakeAgents } from "./helpers/agents-bake";
import { findInstallRepo, installRepoSkipReason } from "./helpers/install-repo";

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
import { HomeAiSection } from "../components/home/HomeAiSection";
import { MCP_CHATGPT_PLAN_RULE, MCP_HOSTS, MCP_PAGE_HOSTS, SIGN_IN_UNKNOWN } from "../config/mcp-tools";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const URL = "https://example.invalid/functions/v1/agent-mcp";
const chatgpt = MCP_HOSTS.find((h) => h.id === "chatgpt")!;
const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
const panel = (host: typeof chatgpt) => render(
  <MemoryRouter><HostPanel host={host} url={URL} fact={SIGN_IN_UNKNOWN} keyValue="" onKey={() => {}} /></MemoryRouter>,
);

describe("the ChatGPT tile quotes OpenAI's plan rule and points ChatGPT Free to Claude", () => {
  it("the rule is OpenAI's pricing table, quoted, linked and dated, on the ChatGPT tile only", () => {
    expect(chatgpt.planRule).toBe(MCP_CHATGPT_PLAN_RULE);
    expect(MCP_CHATGPT_PLAN_RULE.url).toBe("https://chatgpt.com/pricing");
    expect(MCP_CHATGPT_PLAN_RULE.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MCP_CHATGPT_PLAN_RULE.quote).toBe("Plan: Free, Feature: Create & share Plugins, No");
    for (const h of MCP_HOSTS.filter((x) => x.id !== "chatgpt")) expect(h.planRule, h.id).toBeUndefined();
  });

  it("the panel prints the quote, the link, the day, and a link to the Claude tile", () => {
    const { container } = panel(chatgpt);
    const rule = container.querySelector('[data-plan-rule="chatgpt"]')!;
    expect(rule, "the ChatGPT panel has no plan rule").not.toBeNull();
    expect(rule.textContent).toContain(`“${MCP_CHATGPT_PLAN_RULE.quote}”`);
    expect(rule.textContent).toContain("November 8, 2026");
    const links = Array.from(rule.querySelectorAll("a"));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["OpenAI's pricing page", MCP_CHATGPT_PLAN_RULE.url],
      ["On ChatGPT Free? Use Claude's free plan", "#claude"],
    ]);
    // It comes before the first step.
    const firstStep = container.querySelector("ol li")!;
    expect(rule.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the Claude panel carries no plan rule", () => {
    const { container } = panel(claude);
    expect(container.querySelector("[data-plan-rule]")).toBeNull();
  });

  it("every locale says it with both links, the quote and the day, and names no paid ChatGPT plan before the owner's check", () => {
    for (const l of LOCALES) {
      const v = (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as { agentConnect: Record<string, string> }).agentConnect.chatgptPlanRule;
      expect(v, l).toMatch(/<rule>[^<]+<\/rule>/);
      expect(v, l).toMatch(/<claude>[^<]*Claude[^<]*<\/claude>/);
      expect(v, l).toContain("{{quote}}");
      expect(v, l).toContain("{{date}}");
      expect(v, `${l} names a paid plan`).not.toMatch(/\bPlus\b|\bGo\b|\bPro\b|\bBusiness\b/);
    }
  });

  it("following the Claude link on the page opens the Claude tile", async () => {
    window.history.replaceState(null, "", "/agents#chatgpt");
    render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(document.querySelector('section#chatgpt')).not.toBeNull(), SLOW);
    expect(document.querySelector("section#claude")).toBeNull();
    // The link changes only the fragment; the page follows it to that tile.
    act(() => {
      window.history.replaceState(null, "", "/agents#claude");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(document.querySelector("section#claude")).not.toBeNull(), SLOW);
    expect(document.querySelector("section#chatgpt")).toBeNull();
  });

  it("the bake's ChatGPT panel carries the same sentence and links", async () => {
    const html = (await bakeAgents()).content;
    const section = html.slice(html.indexOf('<section id="chatgpt"'), html.indexOf("</section>", html.indexOf('<section id="chatgpt"')));
    expect(section).toContain(`<a href="${MCP_CHATGPT_PLAN_RULE.url}" class="text-primary underline">OpenAI's pricing page</a>, read November 8, 2026`);
    expect(section).toContain(`<a href="#claude" class="text-primary underline">On ChatGPT Free? Use Claude's free plan</a>`);
    expect(section).toContain("Plan: Free, Feature: Create &amp; share Plugins, No");
    expect(section.indexOf("OpenAI's pricing page")).toBeLessThan(section.indexOf("<ol"));
  });

  it("the install repository quotes the same rule, link and day, when its checkout is on this machine", () => {
    const found = findInstallRepo({ root: ROOT, env: process.env.RESUMEBOOSTER_MCP_DIR });
    const dir = found.dir;
    if (!dir) {
      console.warn(installRepoSkipReason(found, "the install repository's chatgptPlanRule"));
      return;
    }
    const cfg = JSON.parse(readFileSync(resolve(dir, "mcp.config.json"), "utf8")) as { chatgptPlanRule?: { url: string; read: string; quote: string } };
    if (!cfg.chatgptPlanRule) {
      console.warn(`SKIPPED: ${dir} carries no chatgptPlanRule yet (the W0 branch adds it)`);
      return;
    }
    const { url, read, quote } = cfg.chatgptPlanRule;
    expect({ url, read, quote }).toEqual({ ...MCP_CHATGPT_PLAN_RULE });
  });
});

describe("the homepage's AI strip says the same", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));
  it("links Claude's free plan for ChatGPT Free readers", () => {
    const { container } = render(<MemoryRouter><HomeAiSection counts={{}} openTotal={null} asOf={null} /></MemoryRouter>);
    const line = container.querySelector("[data-home-chatgpt-free]")!;
    expect(line.textContent).toBe("On ChatGPT Free? Use Claude's free plan, which can add one custom connector; ChatGPT Free cannot add one.");
    const a = line.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/agents#claude");
    expect(a.textContent).toBe("Use Claude's free plan");
    expect(MCP_PAGE_HOSTS.map((h) => h.id)).toContain("claude");
  });
  it("in every locale, with the Claude link, and in the homepage's crawler copy", () => {
    for (const l of LOCALES) {
      const v = (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/home/${l}.json`), "utf8")) as { home: { ai: Record<string, string> } }).home.ai.chatgptFree;
      expect(v, l).toMatch(/<claude>[^<]+<\/claude>/);
      expect(v, l).toContain("ChatGPT Free");
    }
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toContain('hpLinks(hp(H.ai.chatgptFree, {}, "home.ai.chatgptFree"), { claude: "/agents#claude" })');
  });
});

describe("the hero and the descriptions promise nothing the ChatGPT tile contradicts (the fix round of 2026-11-08)", () => {
  // The hero said "Connect Resume Booster to Claude or ChatGPT for free" and
  // the descriptions "from Claude or ChatGPT, free" and "Search free", on the
  // page whose ChatGPT tile quotes OpenAI saying ChatGPT Free cannot add the
  // server. The homepage's AI strip already said it honestly: free on our
  // side, and in ChatGPT the plan must allow custom connectors.
  const homeLede = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/home/${l}.json`), "utf8")) as { home: { ai: { lede: string } } }).home.ai.lede;
  /** The homepage lede's "free on our side" clause and its last sentence (the ChatGPT plan line), per language. */
  const framing = (l: string) => {
    const sentences = homeLede(l).split(/(?<=[.।])\s+/).filter(Boolean);
    const plan = sentences[sentences.length - 1];
    const free = sentences[sentences.length - 2].split(",")[0];
    return { free, plan };
  };
  it("every language's hero says free on our side and carries the homepage's ChatGPT plan line", () => {
    for (const l of LOCALES) {
      const a = (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as { agentConnect: Record<string, string> }).agentConnect;
      const { free, plan } = framing(l);
      for (const k of ["heroSubReach", "heroSubNoCount"]) {
        expect(a[k].toLowerCase(), `${l} ${k} lacks "${free}"`).toContain(free.toLowerCase());
        expect(a[k], `${l} ${k} lacks the ChatGPT plan line`).toContain(plan);
        expect(a[k], `${l} ${k} names a paid plan`).not.toMatch(/\bPlus\b|\bGo\b|\bPro\b|\bBusiness\b/);
      }
      expect(a.heroSubReach).toContain("{{n}}");
    }
    expect((JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")) as { agentConnect: Record<string, string> }).agentConnect.heroSubReach)
      .not.toMatch(/ChatGPT for free/);
  });
  it("React's description and the bake's say free on our side, never a bare free", async () => {
    const page = readFileSync(resolve(ROOT, "src/pages/AgentConnect.tsx"), "utf8");
    const desc = /description=\{`([^`]*)`\}\s*path="\/agents"/.exec(page)?.[1] ?? "";
    expect(desc).toMatch(/from Claude or ChatGPT, free on our side, and apply yourself/);
    const baked = await bakeAgents();
    expect(baked.description).toMatch(/free on our side/);
    expect(baked.description).not.toMatch(/Search free|, free\.$/);
    expect(baked.description.length).toBeLessThanOrEqual(160);
  });
});
