// @vitest-environment node
/**
 * THE BAKED AGENTS PAGE AND THE LLMS FILES LINK ADD TO CLAUDE (SEO audit
 * 2026-11-18, GEO-12; owner yes).
 *
 * The /agents page a person sees has a one-step "Add to Claude" button, which
 * opens Claude's custom-connector dialog with the name and the address filled
 * in. The bytes a crawler or an answer engine reads (the baked /agents page,
 * llms.txt and llms-full.txt) gave only the manual steps, so an answer that
 * quoted them sent people through five steps for a one-step job. The link is
 * now in all three, while the switch is on; the manual steps stay below it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";
import { claudeInstallLink, MCP_ADD_TO_CLAUDE_LIVE, MCP_CONNECTOR_NAME } from "@/config/mcp-tools";
import { codeOf } from "./helpers/strip-comments";

const S = seo as unknown as {
  addToClaudeLinkHtml?: (o: { live: boolean; href: string | null; name: string; esc: (s: string) => string }) => string;
  addToClaudeLlms?: (href: string | null) => string;
  withAddToClaudeLine?: (lt: string, add: string) => string;
};
const MCP = "https://p.supabase.co/functions/v1/agent-mcp";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

describe("the link", () => {
  it("is Claude's documented install link for the server's address, as the page's button uses it", () => {
    expect(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8")).toMatch(/export \{[^}]*\bMCP_ADD_TO_CLAUDE_LIVE, claudeInstallLink \} from "\.\.\/src\/config\/mcp-tools";/);
    expect(typeof MCP_ADD_TO_CLAUDE_LIVE).toBe("boolean");
    expect(claudeInstallLink(MCP)).toMatch(/^https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector&connectorName=[^&]+&connectorUrl=https%3A%2F%2Fp\.supabase\.co/);
  });

  it("on the baked page, is a plain link that says the person confirms it in Claude", () => {
    expect(typeof S.addToClaudeLinkHtml).toBe("function");
    const html = S.addToClaudeLinkHtml!({ live: true, href: claudeInstallLink(MCP), name: MCP_CONNECTOR_NAME, esc });
    expect(html).toContain(`<a href="${esc(claudeInstallLink(MCP))}"`);
    expect(html).toMatch(/>Add to Claude<\/a>/);
    expect(html).toMatch(/you confirm it there/);
  });

  it("in the llms files, is the address and what it opens", () => {
    expect(S.addToClaudeLlms!(claudeInstallLink(MCP))).toBe(` Add to Claude in one step: ${claudeInstallLink(MCP)} opens Claude's custom-connector dialog with the name and the address filled in; you confirm it there.`);
  });

  it("is not printed while the switch is off or with no address", () => {
    expect(S.addToClaudeLinkHtml!({ live: false, href: claudeInstallLink(MCP), name: MCP_CONNECTOR_NAME, esc })).toBe("");
    expect(S.addToClaudeLinkHtml!({ live: true, href: null, name: MCP_CONNECTOR_NAME, esc })).toBe("");
    expect(S.addToClaudeLlms!(null)).toBe("");
  });
});

describe("the bake", () => {
  it("prints it at the top of the Claude panel on /agents, above the manual steps", () => {
    expect(code).toMatch(/host\.id === "claude" \? addToClaudeLinkHtml\(\{ live: D\.MCP_ADD_TO_CLAUDE_LIVE, href: mcpUrl \? D\.claudeInstallLink\(mcpUrl\) : null/);
    const panel = code.slice(code.indexOf("const hostPanel = (host) =>"), code.indexOf("const hostPanel = (host) =>") + 1200);
    expect(panel.indexOf("${addToClaudeHtml(host)}")).toBeGreaterThan(-1);
    expect(panel.indexOf("${addToClaudeHtml(host)}")).toBeLessThan(panel.indexOf("${stepsHtml(host.steps(ctx))}"));
  });

  it("adds it after the server address in llms-full.txt and in llms.txt", () => {
    expect(code).toMatch(/MCP server address \(Streamable HTTP\): \$\{MCP_URL\} — registry name \$\{MCP_REGISTRY_NAME\}\.\$\{addToClaudeLlms\(D\.MCP_ADD_TO_CLAUDE_LIVE && MCP_URL \? D\.claudeInstallLink\(MCP_URL\) : null\)\}/);
    expect(code).toMatch(/lt = withAddToClaudeLine\(lt, addToClaudeLlms\(D\.MCP_ADD_TO_CLAUDE_LIVE && MCP_URL \? D\.claudeInstallLink\(MCP_URL\) : null\)\);/);
  });

  it("the llms.txt rewrite carries the sentence once however many bakes run, and takes it out when the switch goes off", () => {
    expect(typeof S.withAddToClaudeLine).toBe("function");
    const lt0 = `Intro. MCP server address (Streamable HTTP): ${MCP} — registry name work.resumebooster/jobs. No key needed.`;
    const add = S.addToClaudeLlms!(claudeInstallLink(MCP));
    const once = S.withAddToClaudeLine!(lt0, add);
    const twice = S.withAddToClaudeLine!(once, add);
    expect(twice).toBe(once);
    expect(once.split("Add to Claude in one step").length - 1).toBe(1);
    expect(once).toContain(`registry name work.resumebooster/jobs. Add to Claude in one step: ${claudeInstallLink(MCP)}`);
    expect(once).toMatch(/you confirm it there\. No key needed\.$/);
    expect(S.withAddToClaudeLine!(once, "")).toBe(lt0);
  });
});
