/**
 * THE MCP SERVER'S sameAs NAMES ITS REGISTRY ENTRY, NOT A SEARCH (GEO-1107-07).
 *
 * The SoftwareApplication on /agents named
 * "https://registry.modelcontextprotocol.io/v0/servers?search=work.resumebooster/jobs",
 * a search over the registry, as the same thing as the server. It now names
 * the registry's canonical page for the server (its latest version's entry,
 * which answered 200 on 2026-11-07) beside the install repository. The #org
 * node stays without sameAs: those links describe the software, and an
 * Organization sameAs waits for the owner (SEO-045).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_INSTALL_REPO_URL, MCP_REGISTRY_ENTRY_URL, MCP_REGISTRY_SERVER_NAME } from "@/config/mcp-tools";
import { codeOf } from "./helpers/strip-comments";

const SRC = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

describe("the registry entry's address", () => {
  it("is the server's latest-version page, its name's slash encoded", () => {
    expect(MCP_REGISTRY_SERVER_NAME).toBe("work.resumebooster/jobs");
    expect(MCP_REGISTRY_ENTRY_URL).toBe("https://registry.modelcontextprotocol.io/v0/servers/work.resumebooster%2Fjobs/versions/latest");
  });
});

describe("the /agents SoftwareApplication", () => {
  it("names the install repository and the registry entry, and no registry search", () => {
    expect(SRC).toMatch(/sameAs: \[D\.MCP_INSTALL_REPO_URL, D\.MCP_REGISTRY_ENTRY_URL\]/);
    expect(SRC).not.toMatch(/servers\?search=/);
    expect(MCP_INSTALL_REPO_URL).toMatch(/^https:\/\/github\.com\//);
  });
});
