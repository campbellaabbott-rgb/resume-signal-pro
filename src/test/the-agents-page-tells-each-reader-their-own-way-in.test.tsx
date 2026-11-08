/**
 * THE /agents PAGE TELLS EACH READER THEIR OWN WAY IN (connect wave 2,
 * 2026-11-07).
 *
 *   - CJ-03: Claude's phone app has no add dialog; a phone user adds it once
 *     in the phone's browser at claude.ai and the app then has it (Anthropic:
 *     the mobile apps use servers "already added via claude.ai"). ChatGPT has
 *     no such source (custom MCP is on ChatGPT web; whether a plugin then
 *     works in the ChatGPT app is owner action 2), so its tile says nothing
 *     about phones (the fix round of 2026-11-08).
 *   - PLT-1107-11: Claude Code signed in with a claude.ai account already has
 *     every connector added in Claude.
 *   - CJ-02 (copy): Claude's dialog is "+ Add", "Add custom connector", name,
 *     URL, "Continue", the detected authentication settings, "Continue",
 *     "Add" (support.claude.com 11175166). The old step told people to pick
 *     "Sign in when needed" and also to leave the detected values, two
 *     instructions that part whenever No sign-in is detected; the detected
 *     setting is kept until the server's sign-in ships. The one-click flag
 *     stays off and MCP_STEPS_CHECKED stays where it is (owner checks).
 *   - CJ-10: the server answers with or without /mcp after its address, so no
 *     tile warns against it and no troubleshooting row names it as a cause.
 *   - PLT-1107-09: nothing promises ChatGPT will show a sign-in for a plugin
 *     made with No authentication; OpenAI does not document it.
 *   - APPLY-1107-12: the form reader's allowance is said per app, off the
 *     mirror the first-call guard pins to the server; the crawler copies of
 *     /agents and /agent carry the apply steps and the browser guidance.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bakeAgent, bakeAgents, bakedText } from "./helpers/agents-bake";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) }, rpc: async () => ({ data: null, error: null }) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

import { HostPanel } from "../pages/AgentConnect";
import { ApplyYourself } from "../components/agents/ApplyYourself";
import {
  MCP_ADD_TO_CLAUDE_LIVE, MCP_ANON_CAPS, MCP_CLAUDE_HELP_URL, MCP_CLAUDE_STEPS_CHECKED, MCP_CONNECTOR_NAME, MCP_FORMS_ALLOWANCE,
  MCP_HOSTS, MCP_MORE_HOSTS, MCP_STEPS_CHECKED, MCP_TROUBLESHOOTING, SIGN_IN_UNKNOWN, type McpHost,
} from "../config/mcp-tools";

vi.setConfig({ testTimeout: 30_000 });
const URL = "https://example.invalid/functions/v1/agent-mcp";
const host = (id: string) => MCP_HOSTS.find((h) => h.id === id)!;
const panel = (h: McpHost) => render(
  <MemoryRouter><HostPanel host={h} url={URL} fact={SIGN_IN_UNKNOWN} keyValue="" onKey={() => {}} /></MemoryRouter>,
).container;
const words = (h: McpHost, addToClaude = false) =>
  [...h.steps({ url: URL, addToClaude }), ...(h.fallbackSteps?.({ url: URL, addToClaude }) ?? [])].map((s) => `${s.text} ${s.note ?? ""}`).join(" ");
/** A baked host panel, by id. */
const bakedPanel = (html: string, id: string) => html.slice(html.indexOf(`<section id="${id}"`), html.indexOf("</section>", html.indexOf(`<section id="${id}"`)));

describe("a phone user is told to add it once in the phone's browser where that is documented (CJ-03)", () => {
  it("the Claude panel says where, and the app it then appears in; ChatGPT and Claude Code say nothing of phones", () => {
    expect(panel(host("claude")).querySelector('[data-phone-note="claude"]')!.textContent)
      .toBe("On a phone? Add it once in your phone's browser at claude.ai, not in the app; it then appears in the Claude app.");
    expect(panel(host("chatgpt")).querySelector("[data-phone-note]")).toBeNull();
    expect(panel(host("claude-code")).querySelector("[data-phone-note]")).toBeNull();
  });
  it("the bake's Claude panel carries it, and no baked panel says a plugin appears in the ChatGPT app", async () => {
    const html = (await bakeAgents()).content;
    expect(bakedText(bakedPanel(html, "claude"))).toContain("Add it once in your phone's browser at claude.ai, not in the app; it then appears in the Claude app.");
    expect(bakedText(html)).not.toMatch(/appears in the ChatGPT app/);
  });
});

describe("Claude Code says a connector added in Claude is already there (PLT-1107-11)", () => {
  it("the Claude Code panel says so before its steps, and no other panel does", () => {
    const c = panel(host("claude-code"));
    const note = c.querySelector("[data-from-claude]")!;
    expect(note.textContent).toBe(`Already added ${MCP_CONNECTOR_NAME} in Claude? If you sign in to Claude Code with the same claude.ai account, it is already here: type /mcp and look for it. The steps below are for any other sign-in.`);
    expect(note.compareDocumentPosition(c.querySelector("ol li")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const id of ["claude", "chatgpt"]) expect(panel(host(id)).querySelector("[data-from-claude]"), id).toBeNull();
  });
  it("the bake's Claude Code panel carries it", async () => {
    expect(bakedText(bakedPanel((await bakeAgents()).content, "claude-code"))).toContain("it is already here: type /mcp and look for it.");
  });
});

describe("Claude's steps use the dialog's own labels and keep the detected setting (CJ-02 copy)", () => {
  const claude = host("claude");
  it("the manual route walks + Add, Add custom connector, the name, the URL, Continue, the detected settings, Continue, Add", () => {
    const texts = claude.steps({ url: URL }).map((s) => s.text);
    expect(texts.slice(0, 7)).toEqual([
      "In Claude, open **Customize**, then **Connectors**.",
      "Click **+ Add**, then **Add custom connector**.",
      "Enter the name:",
      expect.stringMatching(/server URL field/),
      "Click **Continue**.",
      "Claude shows the authentication settings it detected. Keep them as they are and click **Continue**.",
      "Click **Add**.",
    ]);
  });
  it("no route tells anyone to override what Claude detects, or says two things about it", () => {
    for (const on of [false, true]) {
      const w = words(claude, on);
      expect(w).not.toMatch(/Sign in when needed|Register automatically|leave them|Do not choose \*\*No sign-in\*\*/);
      expect(w).toMatch(/Keep them as they are/);
    }
    expect(claude.how).not.toMatch(/Sign in when needed/);
  });
  it("the labels are dated by the help article they are read from; the owner's flag and date stay as they were", () => {
    expect(claude.docs[0]).toBe(MCP_CLAUDE_HELP_URL);
    expect(claude.checked).toBe(MCP_CLAUDE_STEPS_CHECKED);
    expect(MCP_CLAUDE_STEPS_CHECKED).toBe("2026-11-08");
    expect(MCP_ADD_TO_CLAUDE_LIVE).toBe(false);
    expect(MCP_STEPS_CHECKED).toBe("2026-10-11");
  });
});

describe("the address works with or without /mcp after it (CJ-10)", () => {
  it("no step tells anyone not to add /mcp, and the ChatGPT step says either works", () => {
    for (const h of [...MCP_HOSTS, ...MCP_MORE_HOSTS]) {
      const all = [...h.steps({ url: URL }), ...(h.keyed?.steps({ url: URL }) ?? [])].map((s) => `${s.text} ${s.note ?? ""}`).join(" ");
      expect(all, h.id).not.toMatch(/do not add `?\/mcp`?|not add `\/mcp`|exactly as it is — do not/i);
    }
    expect(words(host("chatgpt"))).toMatch(/it works with or without `\/mcp` at the end/);
  });
  it("no troubleshooting row gives an added /mcp as a cause", () => {
    for (const r of MCP_TROUBLESHOOTING) expect(`${r.why}`, r.id).not.toMatch(/\/mcp`? (?:was )?(?:added|appended)/);
  });
});

describe("nothing promises ChatGPT will offer a sign-in later (PLT-1107-09)", () => {
  it("the ChatGPT row and its on-state sentence say it may need adding again", () => {
    const c = host("chatgpt");
    expect(c.how).toMatch(/OpenAI does not document whether a plugin created with No authentication can sign in later/);
    expect(c.how).not.toMatch(/shows ChatGPT's own OAuth sign-in/);
    expect(c.signIn("on")).toMatch(/may show its sign-in[\s\S]*may need the plugin removed and added again/);
  });
});

describe("the form reader's allowance is said per app (APPLY-1107-12)", () => {
  const F = MCP_ANON_CAPS.forms;
  it("the mirror's sentence names Claude's shared pool and its minute, ChatGPT's per-person day inside its share, and a connection's day", () => {
    // The fix round of 2026-11-08: "Claude's users share" read, beside a
    // Claude Code tile, as a Claude Code reader's allowance, and Claude Code
    // on the person's own machine is counted per connection (lookupBucket's
    // "other" partition); ChatGPT's 100 is a person's only when ChatGPT's
    // call names them, and calls that name nobody share ChatGPT's 2,000.
    expect(MCP_FORMS_ALLOWANCE).toContain(`claude.ai and Claude's apps share ${F.shares.claude.toLocaleString("en-US")} form reads a day (${F.perMinute.claude} a minute)`);
    expect(MCP_FORMS_ALLOWANCE).toContain(`from ChatGPT, ${F.perBucket} a day for each person ChatGPT's call names, within ${F.shares.chatgpt.toLocaleString("en-US")} a day for all of ChatGPT`);
    expect(MCP_FORMS_ALLOWANCE).toContain(`from Claude Code or any other app, ${F.perBucket} a day per internet connection`);
    expect(MCP_FORMS_ALLOWANCE).not.toMatch(/Claude's users share/);
  });
  it("every language says the same three audiences, with every figure placeholder", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const l of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const s: string = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${l}.json`), "utf8")).agentConnect.applyAllowance;
      for (const p of ["claude", "claudePerMinute", "perPerson", "chatgpt", "perConnection"]) expect(s, `${l} lacks {{${p}}}`).toContain(`{{${p}}}`);
      expect(s, `${l} names claude.ai`).toContain("claude.ai");
      expect(s, `${l} names Claude Code beside the per-connection figure`).toMatch(/Claude Code[^;]*\{\{perConnection\}\}/);
    }
  });
  it("the page's apply section prints it", () => {
    const { container } = render(<MemoryRouter><ApplyYourself /></MemoryRouter>);
    expect(container.querySelector("[data-forms-allowance]")!.textContent).toBe(MCP_FORMS_ALLOWANCE);
  });
  it("the bake gives apply_myself the form allowance, not a connection's lookup figure", async () => {
    const text = bakedText((await bakeAgents()).content);
    expect(text).toMatch(/apply_myself \(read-only; answers with no key, on the form-reading allowance below\)/);
    expect(text).not.toMatch(/apply_myself \([^)]*per network address/);
    expect(text).toContain(MCP_FORMS_ALLOWANCE);
  });
});

describe("the crawler copies carry the apply steps and the browser guidance (APPLY-1107-12)", () => {
  it("/agents carries Claude in Chrome, ChatGPT's browser, the steps and the allowance", async () => {
    const text = bakedText((await bakeAgents()).content);
    expect(text).toContain("Claude in Chrome (paid Claude plans, Chrome on a computer): choose manual approval for application forms.");
    expect(text).toContain("ChatGPT's browser asks before submitting and can't upload files, so attach your CV yourself.");
    expect(text).toContain("Give your AI your CV in the chat: paste it or attach it.");
    expect(text).toContain("Resume Booster never submits anything for you.");
  });
  it("/agent names the tool that reads the form and carries the same section", async () => {
    const page = await bakeAgent();
    expect(page.content).toContain("<code>apply_myself</code>");
    const text = bakedText(page.content);
    expect(text).toContain("Claude in Chrome (paid Claude plans, Chrome on a computer)");
    expect(text).toContain(MCP_FORMS_ALLOWANCE);
    expect(text).not.toMatch(/\/agents\/pass|Agent Pass|Agent plan/);
  });
});
