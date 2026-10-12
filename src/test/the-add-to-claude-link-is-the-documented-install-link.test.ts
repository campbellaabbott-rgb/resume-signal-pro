/**
 * THE "ADD TO CLAUDE" LINK IS THE DOCUMENTED INSTALL LINK (connect spec D1).
 *
 * Claude documents one URL that opens its custom-connector dialog with the
 * name and the address filled in
 * (claude.com/docs/connectors/building/directory-vs-custom):
 *
 *   https://claude.ai/customize/connectors?modal=add-custom-connector
 *     &connectorName=NAME&connectorUrl=ENCODED_URL
 *
 * plus the same query on /admin-settings/connectors for a Team or Enterprise
 * Owner. It only prefills — the person confirms, and a signed-out person
 * signs in first. The button that carries it stays behind
 * MCP_ADD_TO_CLAUDE_LIVE, OFF until the owner's check of that dialog (owner
 * action 1), because Claude's authentication choice cannot be changed after a
 * connector is added. Pinned here, by behaviour: the exact link, no key in it
 * ever, the admin variant, the flag's default, the flag gating every surface
 * that would print it, and the first question naming a tool that answers with
 * no key and handing the place over as its own argument.
 */
import { describe, expect, it } from "vitest";
import {
  claudeInstallLink, claudeAdminInstallLink, MCP_ADD_TO_CLAUDE_LIVE, MCP_CONNECTOR_NAME, MCP_HOSTS, MCP_EXAMPLE_QUESTION,
  MCP_ANON_TOOL_NAMES, MCP_TEST_QUERY,
} from "../config/mcp-tools";
import { MCP_URL } from "../lib/mcp-test";
import { installLinkFor } from "../lib/agent-handoff";

const URL_UNDER_TEST = "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp";

describe("the install link", () => {
  it("is exactly the documented link, for the documented name and this server's address", () => {
    expect(claudeInstallLink(URL_UNDER_TEST)).toBe(
      "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Resume%20Booster&connectorUrl=https%3A%2F%2Fbwhdazbotpblihdxcmho.supabase.co%2Ffunctions%2Fv1%2Fagent-mcp",
    );
    expect(MCP_CONNECTOR_NAME).toBe("Resume Booster");
  });

  it("decodes to the name and MCP_URL, and carries nothing else — never a key", () => {
    const u = new URL(claudeInstallLink(MCP_URL));
    expect(`${u.origin}${u.pathname}`).toBe("https://claude.ai/customize/connectors");
    expect([...u.searchParams.keys()]).toEqual(["modal", "connectorName", "connectorUrl"]);
    expect(u.searchParams.get("modal")).toBe("add-custom-connector");
    expect(u.searchParams.get("connectorName")).toBe(MCP_CONNECTOR_NAME);
    expect(u.searchParams.get("connectorUrl")).toBe(MCP_URL);
    expect(u.href).not.toMatch(/rb_live_|key=|token=|authorization/i);
  });

  it("has the admin variant: the same query on the organization settings page", () => {
    const user = new URL(claudeInstallLink(MCP_URL));
    const admin = new URL(claudeAdminInstallLink(MCP_URL));
    expect(`${admin.origin}${admin.pathname}`).toBe("https://claude.ai/admin-settings/connectors");
    expect(admin.search).toBe(user.search);
  });
});

describe("the flag", () => {
  it("is off until the owner's check of the dialog", () => {
    expect(MCP_ADD_TO_CLAUDE_LIVE).toBe(false);
  });

  it("gates the Claude panel: no one-click links and the manual steps while off; both links and the one-click steps while on", () => {
    const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
    const off = { url: MCP_URL };
    expect(claude.deeplinks?.(off) ?? []).toEqual([]);
    expect(claude.steps(off)[0].text).toMatch(/open \*\*Customize\*\*/);
    const on = { url: MCP_URL, addToClaude: true };
    const links = claude.deeplinks!(on);
    expect(links.map((l) => l.href)).toEqual([claudeInstallLink(MCP_URL), claudeAdminInstallLink(MCP_URL)]);
    expect(links[0].label).toBe("Add to Claude");
    expect(links[1].secondary).toBe(true);
    expect(claude.steps(on)[0].text).toMatch(/Click \*\*Add to Claude\*\*/);
    // The manual route stays reachable beneath the one-click one.
    expect(claude.fallbackSteps!(on)[0].text).toMatch(/open \*\*Customize\*\*/);
  });

  it("gates the hand-off's install link, and only Claude has one", () => {
    expect(installLinkFor("Claude")).toBeNull();
    expect(installLinkFor("Claude", true)).toBe(claudeInstallLink(MCP_URL));
    for (const h of MCP_HOSTS.filter((x) => x.name !== "Claude")) expect(installLinkFor(h.name, true), h.name).toBeNull();
  });

  it("no other host's steps print a claude.ai install link", () => {
    for (const h of MCP_HOSTS.filter((x) => x.id !== "claude")) {
      const all = [...h.steps({ url: MCP_URL, addToClaude: true }), ...(h.keyed?.steps({ url: MCP_URL }) ?? [])].map((s) => `${s.text} ${s.copy ?? ""}`).join(" ");
      expect(all, h.id).not.toContain("modal=add-custom-connector");
    }
  });
});

describe("the first question every page suggests", () => {
  it("names a tool that answers with no key, and hands the place over as its own argument", () => {
    expect(MCP_EXAMPLE_QUESTION).toMatch(/call search_jobs/);
    expect(MCP_ANON_TOOL_NAMES).toContain("search_jobs");
    expect(MCP_EXAMPLE_QUESTION).toContain(`query "${MCP_TEST_QUERY}"`);
    expect(MCP_EXAMPLE_QUESTION).toContain('location "Texas"');
    // "nurse jobs in Texas" in the query found 107 of the 1,584 the location
    // filter finds (connect spec §1): the place never rides in the query.
    expect(MCP_EXAMPLE_QUESTION).not.toMatch(/\bin Texas\b/);
  });

  it("is what the Claude and ChatGPT steps both ask", () => {
    for (const id of ["claude", "chatgpt"]) {
      const h = MCP_HOSTS.find((x) => x.id === id)!;
      const copies = h.steps({ url: MCP_URL }).map((s) => s.copy);
      expect(copies, id).toContain(MCP_EXAMPLE_QUESTION);
    }
  });
});
