/**
 * THE /agents PAGE SELLS NOTHING AND SENDS NOTHING (the apply pivot, owner
 * decision 2026-10-11).
 *
 * The Agent plan, the Agent Pass and the Apply Assistant are retired and the
 * server-side apply agent is switched off. /agents is rewritten around one
 * offer: connect your own Claude or ChatGPT, search, and apply yourself with
 * your AI's help. What this file holds the rendered page to:
 *
 *   - THE APPLY SECTION is honest and scoped (connect spec §3.7): form reading
 *     is claimed only "when the employer uses" the systems whose form can be
 *     read, named from the mirror (MCP_FORM_VENDORS, pinned to the Deno
 *     real-question vendors by the-page-says-six), in the reader's language;
 *     model behaviour is said as Resume Booster's instruction to the AI,
 *     never as a guarantee; the person submits; we never submit.
 *   - NOTHING IS SOLD OR SENT: no price, no buy control, no retired product
 *     named as on offer, no sentence that says we or our agent send an
 *     application — in English and in a second locale.
 *   - THE SEEKER-FACING COPY names only Claude, ChatGPT and Claude Code; the
 *     other apps are sent to the install repo in one line (the owner's rule;
 *     the developer disclosure, collapsed, keeps the server's whole reach).
 *   - "ADD TO CLAUDE" is absent while its flag is off, and when on is the
 *     documented install link with the admin variant beneath it.
 */
// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/agents" }
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import i18n from "@/i18n";
import en from "../i18n/locales/en.json";
import de from "../i18n/locales/de.json";

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

import AgentConnect, { HostPanel } from "../pages/AgentConnect";
import { MCP_FORM_VENDORS, MCP_FORM_VENDORS_ON_CHATGPT, MCP_HOSTS, MCP_PAGE_HOSTS, MCP_OFF_PAGE_HOSTS, MCP_ADD_TO_CLAUDE_LIVE, SIGN_IN_UNKNOWN, claudeInstallLink, claudeAdminInstallLink, formVendorPhrase } from "../config/mcp-tools";
import { MCP_URL } from "../lib/mcp-test";
import { SENDABLE_VENDOR_LABELS } from "../config/sendable-vendors";

const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);

/** A sentence that says we, or an agent of ours, send an application. */
const SEND_CLAIM = /\b(?:we|our agent|the agent|resume booster)\b[^.]{0,40}\b(?:sends?|submits?|applies|will apply)\b[^.]{0,30}\b(?:for you|on your behalf|applications?)\b/i;
const NEGATED = /\b(?:never|not|does not|doesn't|no longer)\b/i;

// The test setup bundles English only; the German resources are added the
// way the app's loader adds them, so the page renders the real de.json.
i18n.addResourceBundle("de", "translation", de, true, true);
beforeEach(async () => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))); await i18n.changeLanguage("en"); });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

describe("the apply section", () => {
  it("scopes form reading to the readable systems, names them from the mirror, and says the person submits", () => {
    mount();
    const section = document.querySelector("[data-apply-yourself]")!;
    expect(section, "the apply section is on the page").not.toBeNull();
    const free = section.querySelector("[data-self-apply-free]")!.textContent!;
    expect(free).toContain(`when the employer uses ${formVendorPhrase("en")}, the application form too`);
    for (const v of MCP_FORM_VENDORS) expect(free).toContain(v.label);
    // Model behaviour is our instruction, never a guarantee.
    expect(free).toMatch(/Resume Booster tells it to ask you every factual question/);
    expect(section.textContent).toMatch(/Resume Booster tells your AI to ask you every factual question/);
    expect(section.textContent).toMatch(/You submit on the employer's own site/);
    expect(section.querySelector("[data-we-never-submit]")!.textContent).toMatch(/Resume Booster never submits anything for you\./);
    // The systems the retired agent could send on are not presented as a separate capability.
    expect(section.textContent).not.toMatch(/can (?:submit|send) (?:it|them|for you)/i);
  });

  it("says the same in German, with the vendor list joined in German", async () => {
    await i18n.changeLanguage("de");
    mount();
    const free = document.querySelector("[data-self-apply-free]")!.textContent!;
    expect(free.startsWith(de.agentConnect.selfApplyFree.replace("{{vendors}}", formVendorPhrase("de")))).toBe(true);
    expect(formVendorPhrase("de")).toMatch(/ oder Pinpoint$/);
    expect(document.querySelector("[data-self-apply-chatgpt]")!.textContent).toBe(
      de.agentConnect.selfApplyChatgpt.replace("{{vendors}}", formVendorPhrase("de", MCP_FORM_VENDORS_ON_CHATGPT)));
    expect(document.querySelector("[data-we-never-submit]")!.textContent!.trim()).toBe(de.agentConnect.applyNever);
  });

  // The review of 9fe3bc0d: the five-vendor sentence read to every visitor,
  // while inside ChatGPT the server reads only the public-API pair (R2).
  it("says that inside ChatGPT only the public-API vendors' forms are read, named from the mirror", () => {
    mount();
    const clause = document.querySelector("[data-apply-yourself] [data-self-apply-chatgpt]")!.textContent!;
    expect(clause).toMatch(/^Inside ChatGPT, your AI reads the application form only when the employer uses /);
    const onChatgpt = MCP_FORM_VENDORS.filter((v) => MCP_FORM_VENDORS_ON_CHATGPT.includes(v.key));
    for (const v of onChatgpt) expect(clause).toContain(v.label);
    for (const v of MCP_FORM_VENDORS.filter((x) => !MCP_FORM_VENDORS_ON_CHATGPT.includes(x.key))) expect(clause).not.toContain(v.label);
    expect(clause).toContain(formVendorPhrase("en", MCP_FORM_VENDORS_ON_CHATGPT));
  });

  it("points a past buyer at the retirement notice, and nowhere at a purchase", () => {
    mount();
    expect(screen.getByRole("link", { name: en.agentConnect.retiredLink }).getAttribute("href")).toBe("/agents/pass");
  });
});

describe("nothing is sold or sent", () => {
  for (const lang of ["en", "de"]) {
    it(`no price, no buy control, no retired product on offer, no send claim (${lang})`, async () => {
      await i18n.changeLanguage(lang);
      mount();
      const text = document.querySelector("main")!.textContent ?? "";
      expect(text).not.toMatch(/\$\d/);
      expect(screen.queryByRole("button", { name: /buy|checkout|kaufen/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /buy|checkout|kaufen/i })).toBeNull();
      expect(text).not.toMatch(/\bAgent (?:Pass|plan)\b|\bApply Assistant\b|Agent-Plan/);
      const sentences = text.split(/(?<=[.!?])\s+/);
      const claims = sentences.filter((s) => SEND_CLAIM.test(s) && !NEGATED.test(s));
      expect(claims, "a sentence that says we send applications").toEqual([]);
      // The retired agent's sendable list is not on the page under any name.
      expect(text).not.toMatch(new RegExp(`${SENDABLE_VENDOR_LABELS.filter((l) => !MCP_FORM_VENDORS.some((v) => v.label === l)).join("|")}`));
    });
  }

  it("the hero says connect, search and apply yourself", () => {
    mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(en.agentConnect.heroTitle);
    expect(document.querySelector("[data-agents-hero-sub]")!.textContent).toMatch(/apply on the employer's own site with your AI's help/);
  });
});

describe("the seeker-facing copy names only the owner's three hosts", () => {
  it("outside the developer disclosure and the one GitHub line, no other app is named", () => {
    mount();
    const main = document.querySelector("main")!.cloneNode(true) as HTMLElement;
    main.querySelectorAll("details, [data-other-agents]").forEach((d) => d.remove());
    const text = main.textContent ?? "";
    for (const h of MCP_PAGE_HOSTS) expect(text, `${h.name} is a tile`).toContain(h.name);
    const others = [...MCP_OFF_PAGE_HOSTS.map((h) => h.name), "Cline", "Windsurf", "Zed", "Gemini CLI", "Codex", "Cursor", "VS Code"];
    for (const n of others) expect(text, `${n} named on the seeker-facing page`).not.toContain(n);
    // The one line that does name them sends them to the install repo.
    expect(document.querySelector("[data-other-agents] a")!.getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
  });
});

describe("Add to Claude", () => {
  it("is absent while the flag is off", () => {
    expect(MCP_ADD_TO_CLAUDE_LIVE).toBe(false);
    mount();
    document.querySelector<HTMLButtonElement>('[data-host="claude"]')!.click();
    expect(document.querySelector('[data-deeplink="Add to Claude"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("modal=add-custom-connector");
  });

  it("when on, the Claude panel leads with the documented link, the admin variant beneath it, and the manual steps collapsed", () => {
    const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
    render(<MemoryRouter><HostPanel host={claude} url={MCP_URL} fact={SIGN_IN_UNKNOWN} keyValue="" onKey={() => {}} addToClaude /></MemoryRouter>);
    expect(document.querySelector('[data-deeplink="Add to Claude"]')!.getAttribute("href")).toBe(claudeInstallLink(MCP_URL));
    const admin = [...document.querySelectorAll("[data-deeplink]")].find((a) => a.getAttribute("href") === claudeAdminInstallLink(MCP_URL));
    expect(admin, "the admin variant").toBeTruthy();
    expect(document.querySelector("[data-manual-steps]"), "the manual route beneath the one-click one").not.toBeNull();
    expect(document.querySelector("[data-steps-checked]")!.textContent).toMatch(/checked against the vendor's own page/);
  });
});
